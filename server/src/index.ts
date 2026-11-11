import { World } from "@starfall/shared";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { createHttpServer } from "./http-server.ts";
import { createLogger } from "./log.ts";
import { createMatchLog } from "./match-log.ts";
import { createEventLoopProbe } from "./metrics.ts";
import { RoomRegistry } from "./room.ts";
import { attachWebSocket } from "./ws-server.ts";

let config: Config;
try {
  config = loadConfig();
} catch (error: unknown) {
  // unknown, а не any: щоб прочитати .message, треба спершу довести тип.
  if (error instanceof ConfigError) {
    console.error(`Помилка конфігурації: ${error.message}`);
    process.exit(2); // падаємо одразу, а не через годину роботи
  }
  throw error;
}

/**
 * Перемикач широкої фази — лише для замірів лаби 7. За замовчуванням
 * працює сітка; brute дає повний перебір, щоб таблиця «до/після»
 * порівнювала однакове залізо й однаковий код.
 */
if (process.env.STARFALL_BROADPHASE === "brute") {
  World.useBruteForce();
  console.log("широка фаза: повний перебір (режим заміру)"); // до створення логера
}

const startedAt = Date.now();
const rooms = new RoomRegistry();
const serverLog = createMatchLog(config.logDir, "server");
const log = createLogger(config);
const loopProbe = createEventLoopProbe();

/**
 * Готовність — окремий прапорець, а не похідна від «чи живий».
 * Його знімає зупинка; доки він знятий, /ready віддає 503.
 */
let ready = true;

const httpServer = createHttpServer({
  config,
  rooms,
  startedAt,
  getConnections: () => ws.connections,
  getMatches: () => ws.matches,
  getMatchStats: () => ws.matchStats,
  isReady: () => ready,
  loopProbe,
  metrics: {
    players: () => ws.players,
    rooms: () => rooms.size,
    connections: () => ws.connections,
    messagesIn: () => ws.counters.messagesIn,
    messagesOut: () => ws.counters.messagesOut,
    bytesIn: () => ws.counters.bytesIn,
    bytesOut: () => ws.counters.bytesOut,
    tickMs: () => ws.tickMs,
    droppedInputs: () => ws.droppedInputs,
    closedByRateLimit: () => ws.counters.closedByRateLimit,
    closedByOrigin: () => ws.counters.closedByOrigin,
    ready: () => ready,
  },
});

const ws = attachWebSocket(httpServer, {
  config,
  rooms,
  log,
  logEvent: (event) => serverLog.write(event),
});

/**
 * Стартові кімнати створюються ПІСЛЯ attachWebSocket — і це не дрібниця.
 * Підписка на rooms.on("created") живе всередині ws-шару; якби кімнати
 * з'явилися раніше, вони лишилися б без логу й без розсилки повідомлень,
 * і чат у них мовчки не працював би.
 */
/**
 * Типізований кортеж замість «просто масиву».
 *
 * Без нього `noUncheckedIndexedAccess` вважає обидва елементи
 * `string | undefined` — і має рацію: для звичайного масиву компілятор
 * не знає, що в кожному рядку рівно два елементи.
 */
const SEED_ROOMS: ReadonlyArray<readonly [string, string]> = [
  ["alpha", "classic"],
  ["dust", "dense"],
  ["quiet", "sparse"],
];

for (const [id, arena] of SEED_ROOMS) {
  const room = rooms.ensure(id, { arena, capacity: config.roomCapacity });
  // Кімнати-«заготовки» не зникають, щойно з них вийде останній гравець.
  room.removeAllListeners("empty");
  room.on("empty", () => log.info({ event: "room-empty-kept", room: id }));
}

httpServer.listen(config.port, config.host, () => {
  log.info({
    event: "listen",
    port: config.port,
    host: config.host,
    env: config.nodeEnv,
    allowedOrigins: config.allowedOrigins,
    maxPlayers: config.maxPlayers,
    maxRooms: config.maxRooms,
    maxConnectionsPerIp: config.maxConnectionsPerIp,
    clientDir: config.clientDir,
    logDir: config.logDir,
  });
  serverLog.write({ event: "start", port: config.port, pid: process.pid });
});

/**
 * Акуратне завершення.
 *
 * На хостингу це не зручність, а вимога: платформа надсилає SIGTERM
 * і дає обмежений час (у Docker типово 10 с), після чого вбиває
 * процес SIGKILL. Усе, що не встигло — обірвані сокети в гравців і
 * загублені останні рядки логу, які ще лежали в буфері потоку.
 *
 * Порядок кроків не випадковий:
 *   1. знімаємо готовність — балансувальник перестає давати нових;
 *   2. попереджаємо тих, хто грає (повідомлення shutdown);
 *   3. даємо їм мить побачити попередження;
 *   4. закриваємо сокети кодом 1001 і перестаємо слухати порт;
 *   5. дописуємо логи й виходимо з кодом 0.
 */
const SHUTDOWN_NOTICE_MS = 300;
/** Запас до межі Docker: краще вийти самим, ніж дістати SIGKILL. */
const SHUTDOWN_DEADLINE_MS = 8000;

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const startedShutdownAt = Date.now();

  ready = false;
  log.info({ event: "shutdown-start", signal });
  serverLog.write({ event: "shutdown", signal });

  /**
   * Страхувальний таймер.
   *
   * Якщо щось у закритті зависне (сокет, який не закривається,
   * потік, який не дописується), ми однаково виходимо самі — і в
   * логах лишається причина. Без цього процес дочекався б SIGKILL,
   * і в логах не було б нічого.
   *
   * unref(), щоб цей таймер сам не тримав процес живим.
   */
  const deadline = setTimeout(() => {
    log.error({ event: "shutdown-timeout", ms: Date.now() - startedShutdownAt });
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  deadline.unref();

  const warned = ws.stopAccepting(`сервер зупиняється (${signal})`);
  if (warned > 0) await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_NOTICE_MS));

  await ws.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await serverLog.close();

  const ms = Date.now() - startedShutdownAt;
  log.info({ event: "shutdown-done", signal, ms, warnedPlayers: warned });
  clearTimeout(deadline);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

/**
 * Необроблені помилки: записати й вийти.
 *
 * Спокуса повісити порожній обробник і «працювати далі» — найгірше
 * з можливого: після необробленого винятку процес у невідомому стані,
 * і далі він обслуговує гравців уже навмання. Правильно — вийти з
 * ненульовим кодом і дати платформі підняти свіжий процес.
 *
 * Код 1, а не 0: інакше хостинг вважатиме, що ми завершилися штатно,
 * і може не перезапустити.
 */
process.on("uncaughtException", (error: Error) => {
  log.fatal({ event: "uncaughtException", err: error.message, stack: error.stack });
  // Логи pino пишуться синхронно в stdout, тож рядок уже назовні.
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  log.fatal({ event: "unhandledRejection", err: message, stack });
  process.exit(1);
});
