/**
 * Замір пам'яті: великий лог матчу качає повільний клієнт.
 *
 * Порівнюються два способи віддати файл:
 *   stream — createReadStream + pipeline (як у бойовому коді);
 *   buffer — readFile у пам'ять, а потім res.end (як «простіше написати»).
 *
 * Очікування: у stream крива rss пласка, бо в пам'яті живе лише
 * highWaterMark (64 КБ); у buffer — сходинка на розмір файлу, яка
 * тримається доти, доки повільний клієнт не дочитає.
 *
 * Запуск: npm run bench:rss -w @starfall/server
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

const FILE = join(tmpdir(), "starfall-rss-bench.ndjson");
/** Розмір логу можна змінити: SIZE_MB=96 npm run bench:rss -w @starfall/server */
const TARGET_BYTES = Number(process.env.SIZE_MB ?? 48) * 1024 * 1024;
const CLIENT_BYTES_PER_SECOND = 12 * 1024 * 1024; // «повільний канал»
const SAMPLE_MS = 150;
const PORT = 8099;

const mb = (bytes) => +(bytes / 1024 / 1024).toFixed(1);

async function makeLog() {
  const existing = await stat(FILE).catch(() => null);
  if (existing && Math.abs(existing.size - TARGET_BYTES) < 1024 * 1024) return existing.size;

  const out = createWriteStream(FILE, { flags: "w" });
  let written = 0;
  let i = 0;
  while (written < TARGET_BYTES) {
    const line = `${JSON.stringify({
      t: Date.now(),
      room: "bench",
      event: "state",
      seq: i,
      payload: "x".repeat(200),
    })}\n`;
    written += Buffer.byteLength(line);
    i += 1;
    // Поважаємо backpressure навіть тут: без цього генерація
    // 48 МБ з'їла б пам'ять, яку ми ж і міряємо.
    if (!out.write(line)) await new Promise((resolve) => out.once("drain", resolve));
  }
  await new Promise((resolve) => out.end(resolve));
  return written;
}

function startServer() {
  const server = createServer(async (req, res) => {
    if (req.url === "/stream") {
      const info = await stat(FILE);
      res.writeHead(200, { "content-length": info.size, "content-type": "application/x-ndjson" });
      await pipeline(createReadStream(FILE), res);
      return;
    }
    if (req.url === "/buffer") {
      // Навмисно «як простіше»: увесь файл у пам'ять одним шматком.
      const data = await readFile(FILE);
      res.writeHead(200, { "content-length": data.length, "content-type": "application/x-ndjson" });
      res.end(data);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

/**
 * Клієнт, який читає повільно, живе в ОКРЕМОМУ процесі.
 *
 * Це принципово: якби він читав у цьому ж процесі, його власні буфери
 * потрапили б у rss, який ми міряємо, і обидва способи виглядали б
 * однаково погано. Перша версія цього заміру саме так і збрехала.
 */
function slowDownload(path) {
  const script = `
    const res = await fetch("http://127.0.0.1:${PORT}${path}");
    const reader = res.body.getReader();
    let received = 0;
    const startedAt = Date.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      const shouldHaveTaken = (received / ${CLIENT_BYTES_PER_SECOND}) * 1000;
      const elapsed = Date.now() - startedAt;
      if (shouldHaveTaken > elapsed) {
        await new Promise((r) => setTimeout(r, shouldHaveTaken - elapsed));
      }
    }
    process.stdout.write(String(received));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script]);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(Number(out)) : reject(new Error(`клієнт вийшов із кодом ${code}`)),
    );
  });
}

async function measure(path) {
  if (global.gc) global.gc();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const samples = [];
  const baseline = process.memoryUsage().rss;

  /**
   * Перед кожним відліком примусово збираємо сміття.
   *
   * Без цього крива міряє не «скільки пам'яті тримається», а «скільки
   * її встигло назбиратися до наступного GC»: потокове читання весь час
   * створює буфери по 64 КБ, і вони лежать мертвим вантажем, поки V8
   * не вирішить прибрати. Нас цікавить саме утримувана пам'ять —
   * те, що неможливо звільнити, поки клієнт не дочитає.
   */
  const timer = setInterval(() => {
    global.gc?.();
    samples.push({ t: samples.length * SAMPLE_MS, rss: process.memoryUsage().rss });
  }, SAMPLE_MS);

  const startedAt = Date.now();
  const received = await slowDownload(path);
  const durationMs = Date.now() - startedAt;

  clearInterval(timer);
  const peak = Math.max(...samples.map((s) => s.rss));
  return { path, baseline, peak, delta: peak - baseline, durationMs, received, samples };
}

if (!global.gc) {
  console.error("Запускайте через npm run bench:rss (потрібен прапорець --expose-gc)");
  process.exit(1);
}

const size = await makeLog();
const server = await startServer();
console.log(`файл логу: ${mb(size)} МБ, клієнт читає ~${mb(CLIENT_BYTES_PER_SECOND)} МБ/с\n`);

const stream = await measure("/stream");
const buffer = await measure("/buffer");
server.close();

const rows = [
  ["createReadStream + pipeline", stream],
  ["readFile у пам'ять", buffer],
];
console.log("| Спосіб | rss до | пік rss | приріст | час |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const [name, r] of rows) {
  console.log(
    `| ${name} | ${mb(r.baseline)} МБ | ${mb(r.peak)} МБ | **+${mb(r.delta)} МБ** | ${(r.durationMs / 1000).toFixed(1)} с |`,
  );
}

await writeChart(stream, buffer, size);
await rm(FILE, { force: true });

/** Графік у SVG: без залежностей, відкривається будь-чим. */
async function writeChart(a, b, fileSize) {
  const width = 880;
  const height = 360;
  const pad = { left: 64, right: 24, top: 36, bottom: 44 };
  const all = [...a.samples, ...b.samples];
  const maxRss = Math.max(...all.map((s) => s.rss)) * 1.08;
  const maxT = Math.max(...all.map((s) => s.t));

  const x = (t) => pad.left + (t / maxT) * (width - pad.left - pad.right);
  const y = (rss) => height - pad.bottom - (rss / maxRss) * (height - pad.top - pad.bottom);
  const path = (samples) =>
    samples.map((s, i) => `${i ? "L" : "M"}${x(s.t).toFixed(1)},${y(s.rss).toFixed(1)}`).join(" ");

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const value = maxRss * f;
    return `<line x1="${pad.left}" y1="${y(value)}" x2="${width - pad.right}" y2="${y(value)}" stroke="#1e2b4c"/>
    <text x="${pad.left - 10}" y="${y(value) + 4}" fill="#8ba0c8" font-size="11" text-anchor="end">${mb(value)} МБ</text>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, Menlo, monospace">
  <rect width="${width}" height="${height}" fill="#0a0f1f"/>
  <text x="${pad.left}" y="22" fill="#e6efff" font-size="13">rss під час віддачі логу ${mb(fileSize)} МБ повільному клієнту</text>
  ${ticks.join("\n  ")}
  <path d="${path(b.samples)}" fill="none" stroke="#ff6b7d" stroke-width="2"/>
  <path d="${path(a.samples)}" fill="none" stroke="#7ee0ff" stroke-width="2"/>
  <g font-size="12">
    <rect x="${width - 250}" y="${pad.top}" width="12" height="3" fill="#7ee0ff"/>
    <text x="${width - 232}" y="${pad.top + 5}" fill="#dce6ff">stream (pipeline)</text>
    <rect x="${width - 250}" y="${pad.top + 20}" width="12" height="3" fill="#ff6b7d"/>
    <text x="${width - 232}" y="${pad.top + 25}" fill="#dce6ff">readFile у пам'ять</text>
  </g>
  <text x="${pad.left}" y="${height - 14}" fill="#8ba0c8" font-size="11">0 с</text>
  <text x="${width - pad.right}" y="${height - 14}" fill="#8ba0c8" font-size="11" text-anchor="end">${(maxT / 1000).toFixed(1)} с</text>
</svg>
`;
  const out = new URL("../../docs/rss-bench.svg", import.meta.url);
  await import("node:fs/promises").then((fs) =>
    fs
      .mkdir(new URL("../../docs/", import.meta.url), { recursive: true })
      .then(() => fs.writeFile(out, svg)),
  );
  console.log(`\nграфік: docs/rss-bench.svg`);
}
