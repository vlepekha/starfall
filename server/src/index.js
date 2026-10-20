import { ConfigError, loadConfig } from "./config.js";
import { createHttpServer } from "./http-server.js";
import { createMatchLog } from "./match-log.js";
import { RoomRegistry } from "./room.js";
import { attachWebSocket } from "./ws-server.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Помилка конфігурації: ${error.message}`);
    process.exit(2); // падаємо одразу, а не через годину роботи
  }
  throw error;
}

const startedAt = Date.now();
const rooms = new RoomRegistry();
const serverLog = createMatchLog(config.logDir, "server");

const httpServer = createHttpServer({
  config,
  rooms,
  startedAt,
  getConnections: () => ws.connections,
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
for (const [id, arena] of [
  ["alpha", "classic"],
  ["dust", "dense"],
  ["quiet", "sparse"],
]) {
  const room = rooms.ensure(id, { arena });
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
async function shutdown(signal) {
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

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Остання мережа безпеки: краще залогувати й вийти, ніж працювати далі
// в невідомому стані.
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
