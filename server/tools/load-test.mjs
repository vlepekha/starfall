/**
 * Навантажувальний тест: N ботів без браузера.
 *
 * Боти шлють РІВНО той самий input, що й людина — той самий бінарний
 * кадр, та сама частота. Різниця лише в тому, звідки береться намір:
 * у людини з клавіатури, тут із псевдовипадкового автомата.
 *
 * Запуск: node tools/load-test.mjs [8,32,64,128]
 */

import { millis, seq } from "@starfall/shared";
import { encodeInput } from "@starfall/shared/protocol";
import { WebSocket } from "ws";

const URL_BASE = process.env.WS_URL ?? "ws://127.0.0.1:8080/ws";
const STATS_URL = process.env.STATS_URL ?? "http://127.0.0.1:8080/api/stats";
const COUNTS = (process.argv[2] ?? "8,32,64,128").split(",").map(Number);
const SECONDS = Number(process.env.SECONDS ?? 12);
const WARMUP_MS = 3000;

/** Детермінований «гравець»: тримає газ і крутиться, іноді стріляє. */
function botInput(tick, offset) {
  const phase = (tick + offset) % 180;
  return {
    left: phase > 120,
    right: phase <= 60,
    thrust: phase % 7 !== 0,
    brake: false,
    fire: phase % 12 === 0,
  };
}

function spawnBot(room, index) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL_BASE);
    ws.binaryType = "arraybuffer";
    let sequence = 0;
    let timer = null;
    let bytesIn = 0;

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", room, name: `bot${index}` }));
    });

    ws.on("message", (raw, isBinary) => {
      bytesIn += raw.length ?? raw.byteLength ?? 0;
      if (isBinary || timer) return;
      if (!String(raw).includes('"joined"')) return;
      // Той самий темп, що й у клієнта: 30 кадрів input на секунду.
      timer = setInterval(() => {
        sequence += 1;
        ws.send(
          encodeInput({
            seq: seq(sequence),
            input: botInput(sequence, index),
            clientTimeMs: millis(Date.now() % 4294967295),
          }),
        );
      }, 1000 / 30);
      resolve({
        ws,
        stop: () => {
          clearInterval(timer);
          ws.close();
        },
        stats: () => ({ bytesIn, sequence }),
      });
    });

    const give_up = (reason) => {
      // Сокет закрили (кімната повна, ліміт) або сталася помилка —
      // бот не має зависати назавжди, інакше Promise.all не завершиться.
      resolve({
        ws,
        failed: reason,
        stop: () => {
          if (timer) clearInterval(timer);
          ws.close();
        },
        stats: () => ({ bytesIn, sequence }),
      });
    };

    ws.on("error", () => give_up("error"));
    ws.on("close", (code, why) => give_up(`close ${code} ${why}`));
    setTimeout(() => give_up("timeout"), 8000);
  });
}

async function measure(count) {
  const room = `load-${count}`;
  const bots = await Promise.all(Array.from({ length: count }, (_, i) => spawnBot(room, i)));

  const failed = bots.filter((b) => b.failed);
  if (failed.length) {
    console.log(`\n  (не підключилося ${failed.length}: ${failed[0].failed})`);
  }

  await new Promise((r) => setTimeout(r, WARMUP_MS));

  const samples = [];
  const started = Date.now();
  while (Date.now() - started < SECONDS * 1000) {
    const stats = await fetch(STATS_URL)
      .then((r) => r.json())
      .catch(() => null);
    const match = stats?.matches?.find((m) => m.room === room);
    if (match) samples.push(match);
    await new Promise((r) => setTimeout(r, 500));
  }

  for (const bot of bots) bot.stop();
  await new Promise((r) => setTimeout(r, 500));

  const tickMs = samples.map((s) => s.tickMsAvg);
  const p95 = samples.map((s) => s.tickMsP95);
  const jitter = samples.map((s) => s.jitterMs);
  const dropped = samples.at(-1)?.droppedInputs ?? 0;
  const bytes = bots.reduce((sum, b) => sum + b.stats().bytesIn, 0);

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const max = (xs) => (xs.length ? Math.max(...xs) : 0);

  return {
    count,
    tickAvg: +avg(tickMs).toFixed(2),
    tickP95: +max(p95).toFixed(2),
    jitter: +avg(jitter).toFixed(2),
    droppedInputs: dropped,
    kbPerSecondTotal: +(bytes / 1024 / (SECONDS + WARMUP_MS / 1000)).toFixed(0),
  };
}

const results = [];
for (const count of COUNTS) {
  process.stdout.write(`  ${count} ботів… `);
  const result = await measure(count);
  results.push(result);
  console.log(`крок ${result.tickAvg} мс (p95 ${result.tickP95})`);
}

console.log("\n| Клієнтів | крок, середнє | крок p95 | джитер | втрачено input | трафік |");
console.log("| ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of results) {
  const over = r.tickP95 > 33 ? " ⚠" : "";
  console.log(
    `| ${r.count} | ${r.tickAvg} мс | **${r.tickP95} мс**${over} | ${r.jitter} мс | ${r.droppedInputs} | ${r.kbPerSecondTotal} КБ/с |`,
  );
}

const limit = results.find((r) => r.tickP95 > 33);
console.log(
  limit
    ? `\nБюджет 33 мс перевищено на ${limit.count} клієнтах.`
    : `\nБюджет 33 мс витримано до ${results.at(-1)?.count} клієнтів включно.`,
);
process.exit(0);
