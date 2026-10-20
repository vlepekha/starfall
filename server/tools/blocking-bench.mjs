/**
 * Що буде, якщо обробник HTTP на 300 мс займе цикл подій.
 *
 * Node однопотоковий: поки синхронний код не завершиться, не виконається
 * НІЩО — ні інші запити, ні таймери, ні обробка WebSocket-повідомлень.
 * Цей скрипт міряє, як це виглядає в цифрах.
 *
 * Запуск: npm run bench:blocking -w @starfall/server
 */
import { createServer } from "node:http";

const PORT = 8098;
const BLOCK_MS = 300;

/** Синхронний цикл: рівно те, що робить важка обробка без await. */
function blockFor(ms) {
  const end = Date.now() + ms;
  let sink = 0;
  while (Date.now() < end) sink += Math.sqrt(sink + 1);
  return sink;
}

const server = createServer((req, res) => {
  if (req.url === "/block") {
    blockFor(BLOCK_MS);
    res.end("blocked");
    return;
  }
  res.end("fast");
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const timeRequest = async (path) => {
  const started = performance.now();
  await fetch(`http://127.0.0.1:${PORT}${path}`).then((r) => r.text());
  return performance.now() - started;
};

/** Затримка циклу подій: наскільки таймер на 20 мс спрацював пізніше. */
function startLagMeter() {
  const lags = [];
  let expected = performance.now() + 20;
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + 20;
  }, 20);
  return {
    stop() {
      clearInterval(timer);
      return lags;
    },
  };
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
const ms = (value) => `${value.toFixed(1)} мс`;

// 1. Базова лінія: лише швидкі запити.
const idleMeter = startLagMeter();
const baseline = [];
for (let i = 0; i < 40; i += 1) baseline.push(await timeRequest("/fast"));
const idleLag = idleMeter.stop();

// 2. Те саме, але паралельно працює один обробник на 300 мс.
const busyMeter = startLagMeter();
const blocked = fetch(`http://127.0.0.1:${PORT}/block`).then((r) => r.text());
const during = [];
for (let i = 0; i < 40; i += 1) during.push(await timeRequest("/fast"));
await blocked;
const busyLag = busyMeter.stop();

server.close();

console.log(`Блокуючий обробник: ${BLOCK_MS} мс синхронного коду\n`);
console.log("| Що міряємо | без блокування | під час блокування |");
console.log("| --- | ---: | ---: |");
console.log(
  `| /fast, медіана | ${ms(percentile(baseline, 0.5))} | **${ms(percentile(during, 0.5))}** |`,
);
console.log(
  `| /fast, p95 | ${ms(percentile(baseline, 0.95))} | **${ms(percentile(during, 0.95))}** |`,
);
console.log(`| /fast, найгірший | ${ms(Math.max(...baseline))} | **${ms(Math.max(...during))}** |`);
console.log(
  `| затримка таймера, максимум | ${ms(Math.max(...idleLag))} | **${ms(Math.max(...busyLag))}** |`,
);
