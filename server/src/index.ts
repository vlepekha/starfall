import { World } from "@starfall/shared";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { createHttpServer } from "./http-server.ts";
import { createMatchLog } from "./match-log.ts";
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
  console.log("широка фаза: повний перебір (режим заміру)");
}

const startedAt = Date.now();
const rooms = new RoomRegistry();
const serverLog = createMatchLog(config.logDir, "server");

const httpServer = createHttpServer({
  config,
  rooms,
  startedAt,
  getConnections: () => ws.connections,
  getMatches: () => ws.matches,
  getMatchStats: () => ws.matchStats,
});

const ws = attachWebSocket(httpServer, {
  config,
  rooms,
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
  room.on("empty", () => console.log(`[room ${id}] порожня, лишається як заготовка`));
}

httpServer.listen(config.port, config.host, () => {
  console.log(`Starfall server → http://${config.host}:${config.port}`);
  console.log(`  логи:   ${config.logDir}`);
  console.log(`  клієнт: ${config.clientDir}`);
  serverLog.write({ event: "start", port: config.port, pid: process.pid });
});

/**
 * Акуратне завершення.
 *
 * Без нього Ctrl+C просто вбиває процес: сокети лишаються напіввідкритими,
 * а останні рядки логу гинуть у буфері потоку. Тут ми закриваємо сокети,
 * чекаємо, доки потік допише файл, і лише тоді виходимо з кодом 0.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal}: зупиняюся…`);

  serverLog.write({ event: "shutdown", signal });
  await ws.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await serverLog.close();

  console.log("усе закрито, вихід 0");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Остання мережа безпеки: краще залогувати й вийти, ніж працювати далі
// в невідомому стані.
process.on("unhandledRejection", (reason: unknown) => {
  console.error("unhandledRejection:", reason);
});
