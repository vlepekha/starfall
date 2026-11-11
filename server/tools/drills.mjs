/**
 * Проганяння збоїв (лаба 8).
 *
 * Три сценарії, кожен із яких колись ламав сервер по-справжньому:
 *   1. клієнт зник посеред матчу — без close-кадру, як при втраті Wi-Fi;
 *   2. сервер отримав SIGTERM — гравці мають дізнатися про це, а не
 *      просто побачити «з'єднання розірвано»;
 *   3. зламаний клієнт шле ~1000 битих кадрів на секунду — його треба
 *      відключити, і при цьому СУСІДНІЙ кімнаті не має стати гірше.
 *
 * Запуск: node tools/drills.mjs [ws://host:port]
 * Сервер має бути вже піднятий (скрипт нічого не запускає сам).
 */

import { millis, seq } from "@starfall/shared";
import { encodeInput } from "@starfall/shared/protocol";
import { WebSocket } from "ws";

const WS_URL = process.argv[2] ?? "ws://127.0.0.1:8080/ws";
const HTTP_URL = WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stats() {
  const response = await fetch(`${HTTP_URL}/api/stats`);
  return response.json();
}

async function health() {
  const response = await fetch(`${HTTP_URL}/health`);
  return response.json();
}

/** Гравець, який справді грає: шле input 30 разів на секунду. */
function connect(room, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    const events = { closeCode: null, closeReason: "", shutdown: null, joined: false };
    let n = 0;
    let timer = null;

    ws.on("open", () => ws.send(JSON.stringify({ type: "join", room, name })));

    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.type === "shutdown") events.shutdown = message;
      if (message.type !== "joined") return;
      events.joined = true;
      timer = setInterval(() => {
        n += 1;
        const phase = n % 180;
        ws.send(
          encodeInput({
            seq: seq(n),
            clientTimeMs: millis(Date.now() % 4294967295),
            input: {
              left: phase > 120,
              right: phase <= 60,
              thrust: true,
              brake: false,
              fire: phase % 12 === 0,
            },
          }),
        );
      }, 1000 / 30);
      resolve({ ws, events, stop: () => clearInterval(timer) });
    });

    ws.on("close", (code, reason) => {
      clearInterval(timer);
      events.closeCode = code;
      events.closeReason = String(reason);
    });
    ws.on("error", () => {});
    setTimeout(() => reject(new Error(`${name}: не дочекався joined`)), 5000);
  });
}

const results = [];
const record = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "OK  " : "ЗБІЙ"} ${name} — ${detail}`);
};

/* ------------------------------------------------------------------ */
/*  1. Клієнт зник посеред матчу                                       */
/* ------------------------------------------------------------------ */

async function drillClientVanishes() {
  const a = await connect("drill-vanish", "залишається");
  const b = await connect("drill-vanish", "зникає");
  await sleep(1000);

  const before = await health();

  /**
   * terminate(), а не close(): саме так виглядає втрата зв'язку.
   * close() надсилає кадр закриття — сервер дізнається про вихід
   * одразу. При terminate() сокет просто обривається, і сервер
   * мусить сам зрозуміти це за ping/pong.
   */
  b.ws.terminate();
  b.stop();

  // Чекаємо не фіксовану паузу, а подію: сервер має прибрати з'єднання.
  let after = before;
  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    after = await health();
    if (after.connections < before.connections) break;
  }

  const stillPlaying = a.events.closeCode === null;
  record(
    "клієнт зник посеред матчу",
    after.connections < before.connections && stillPlaying,
    `з'єднань ${before.connections} → ${after.connections}, сусід ${stillPlaying ? "грає далі" : "теж відвалився"}`,
  );

  a.ws.close();
  a.stop();
  await sleep(300);
}

/* ------------------------------------------------------------------ */
/*  2. Потік битих кадрів                                             */
/* ------------------------------------------------------------------ */

async function drillGarbageFlood() {
  // Сусідня кімната — та, якій НЕ має стати гірше.
  const neighbours = await Promise.all([
    connect("drill-neighbour", "сусід-1"),
    connect("drill-neighbour", "сусід-2"),
  ]);
  await sleep(2000);

  const beforeStats = await stats();
  const neighbourBefore = beforeStats.matches.find((m) => m.room === "drill-neighbour");

  /**
   * Зламаний клієнт. Шле биті бінарні кадри якнайшвидше — близько
   * тисячі на секунду, якщо сервер дозволить.
   */
  const flooder = new WebSocket(WS_URL);
  let sent = 0;
  let closeCode = null;
  const startedAt = Date.now();

  await new Promise((resolve) => {
    flooder.on("open", () => {
      flooder.send(JSON.stringify({ type: "join", room: "drill-flood", name: "зламаний" }));
      const timer = setInterval(() => {
        for (let i = 0; i < 50; i += 1) {
          if (flooder.readyState !== WebSocket.OPEN) break;
          // Биті байти: версія протоколу не та, довжина не та.
          flooder.send(Buffer.from([0xff, 0xff, 0xff, 0xff]));
          sent += 1;
        }
      }, 50);
      flooder.on("close", (code) => {
        clearInterval(timer);
        closeCode = code;
        resolve();
      });
      // Якщо сервер так і не відключив — теж результат, і поганий.
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 4000);
    });
    flooder.on("error", () => {});
  });

  const elapsed = (Date.now() - startedAt) / 1000;
  await sleep(1500);

  const afterStats = await stats();
  const neighbourAfter = afterStats.matches.find((m) => m.room === "drill-neighbour");

  const beforeP95 = neighbourBefore?.tickMsP95 ?? 0;
  const afterP95 = neighbourAfter?.tickMsP95 ?? 0;
  const neighbourOk = afterP95 <= Math.max(beforeP95 * 2, beforeP95 + 2);

  record(
    "биті кадри: зламаного відключено",
    closeCode !== null,
    closeCode === null
      ? `НЕ відключений, надіслано ${sent} кадрів`
      : `код ${closeCode} після ${sent} кадрів (~${Math.round(sent / elapsed)}/с)`,
  );
  record(
    "биті кадри: сусідній кімнаті не гірше",
    neighbourOk,
    `крок p95 ${beforeP95} → ${afterP95} мс`,
  );

  for (const n of neighbours) {
    n.ws.close();
    n.stop();
  }
  await sleep(300);
}

/* ------------------------------------------------------------------ */
/*  3. Сервер зупиняють                                               */
/* ------------------------------------------------------------------ */

async function drillShutdown() {
  const players = await Promise.all([
    connect("drill-shutdown", "гравець-1"),
    connect("drill-shutdown", "гравець-2"),
  ]);
  await sleep(1000);

  console.log("\n  Надішліть серверу SIGTERM (kill -TERM <pid> або docker stop).");
  const { pid } = await health();
  console.log(`  pid процесу: ${pid}\n`);

  // Чекаємо до 15 с: нас цікавить, ЩО отримають гравці.
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    if (players.every((p) => p.events.closeCode !== null)) break;
  }

  const warned = players.filter((p) => p.events.shutdown !== null).length;
  const codes = players.map((p) => p.events.closeCode);
  const allGoingAway = codes.every((code) => code === 1001);

  record(
    "зупинка: гравців попереджено",
    warned === players.length,
    `попереджено ${warned} з ${players.length}`,
  );
  record(
    "зупинка: код закриття 1001",
    allGoingAway,
    `коди ${codes.map((c) => c ?? "немає").join(", ")}`,
  );

  for (const p of players) p.stop();
}

/* ------------------------------------------------------------------ */

const only = process.argv[3];

try {
  if (!only || only === "vanish") await drillClientVanishes();
  if (!only || only === "flood") await drillGarbageFlood();
  if (only === "shutdown") await drillShutdown();

  console.log("\n| Сценарій | Результат | Деталі |");
  console.log("| --- | --- | --- |");
  for (const r of results) {
    console.log(`| ${r.name} | ${r.passed ? "пройдено" : "**ЗБІЙ**"} | ${r.detail} |`);
  }

  const failed = results.filter((r) => !r.passed).length;
  process.exit(failed === 0 ? 0 : 1);
} catch (error) {
  console.error(`не вдалося прогнати: ${error.message}`);
  process.exit(2);
}
