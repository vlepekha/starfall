/**
 * Розбір .cpuprofile: де насправді минає час.
 *
 * Chrome DevTools показує те саме у вигляді flame chart, але скриншот
 * не перевіриш і не покладеш у CI. Тут ті самі дані у двох формах:
 * таблиця найгарячіших функцій і flame graph у SVG.
 *
 * Запуск: node tools/profile-report.mjs <файл.cpuprofile> [вихід.svg]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , profilePath, svgPath] = process.argv;
if (!profilePath) {
  console.error("використання: node tools/profile-report.mjs <файл.cpuprofile> [вихід.svg]");
  process.exit(1);
}

const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const byId = new Map(profile.nodes.map((node) => [node.id, node]));

/** Власний час вузла — скільки семплів припало саме на нього. */
const selfTicks = new Map();
for (const id of profile.samples) selfTicks.set(id, (selfTicks.get(id) ?? 0) + 1);

const totalTicks = profile.samples.length;
const totalMs = (profile.endTime - profile.startTime) / 1000;
const msPerTick = totalMs / totalTicks;

const label = (node) => {
  const f = node.callFrame;
  const name = f.functionName || "(анонімна)";
  const file = (f.url || "").split("/").slice(-1)[0] || "";
  return file ? `${name} · ${file}:${f.lineNumber + 1}` : name;
};

// Таблиця: найгарячіші за ВЛАСНИМ часом.
const rows = [...selfTicks.entries()]
  .map(([id, ticks]) => ({ id, ticks, node: byId.get(id) }))
  .filter((row) => row.node)
  .sort((a, b) => b.ticks - a.ticks)
  .slice(0, 12);

console.log(`Профіль: ${totalMs.toFixed(0)} мс, ${totalTicks} семплів\n`);
console.log("| Функція | власний час | частка |");
console.log("| --- | ---: | ---: |");
for (const row of rows) {
  const ms = row.ticks * msPerTick;
  console.log(
    `| \`${label(row.node)}\` | ${ms.toFixed(1)} мс | ${((row.ticks / totalTicks) * 100).toFixed(1)}% |`,
  );
}

if (!svgPath) process.exit(0);

/* ------------------------------------------------------------------ */
/*  Flame graph: той самий профіль, але видно вкладеність викликів      */
/* ------------------------------------------------------------------ */

const children = new Map();
for (const node of profile.nodes) children.set(node.id, node.children ?? []);

const totalOf = new Map();
function computeTotal(id) {
  const cached = totalOf.get(id);
  if (cached !== undefined) return cached;
  let sum = selfTicks.get(id) ?? 0;
  for (const child of children.get(id) ?? []) sum += computeTotal(child);
  totalOf.set(id, sum);
  return sum;
}

const root = profile.nodes[0];
computeTotal(root.id);

const WIDTH = 1100;
const ROW = 18;
const boxes = [];

function layout(id, depth, x, width) {
  const node = byId.get(id);
  if (!node || width < 0.6) return;
  boxes.push({ depth, x, width, text: label(node), ticks: totalOf.get(id) ?? 0 });

  let cursor = x;
  for (const child of children.get(id) ?? []) {
    const childWidth = ((totalOf.get(child) ?? 0) / (totalOf.get(id) || 1)) * width;
    layout(child, depth + 1, cursor, childWidth);
    cursor += childWidth;
  }
}

layout(root.id, 0, 0, WIDTH);
const depth = Math.max(...boxes.map((b) => b.depth)) + 1;
const height = depth * ROW + 40;

/** Колір за іменем — щоб однакові функції мали однаковий відтінок. */
const colour = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  const hue = 12 + (Math.abs(hash) % 40);
  const light = 45 + (Math.abs(hash >> 5) % 18);
  return `hsl(${hue}, 78%, ${light}%)`;
};

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="ui-monospace, Menlo, monospace" font-size="10">`,
  `<rect width="${WIDTH}" height="${height}" fill="#0a0f1f"/>`,
  `<text x="8" y="16" fill="#e6efff" font-size="12">flame chart · ${escapeXml(profilePath.split("/").pop())} · ${totalMs.toFixed(0)} мс</text>`,
];

for (const box of boxes) {
  const y = 26 + box.depth * ROW;
  const w = Math.max(0.6, box.width - 1);
  svg.push(
    `<g><title>${escapeXml(box.text)} — ${(box.ticks * msPerTick).toFixed(1)} мс</title>`,
    `<rect x="${box.x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${ROW - 2}" fill="${colour(box.text)}" stroke="#0a0f1f"/>`,
  );
  if (w > 60) {
    svg.push(
      `<text x="${(box.x + 3).toFixed(1)}" y="${y + 11}" fill="#1a1008">${escapeXml(box.text.slice(0, Math.floor(w / 6)))}</text>`,
    );
  }
  svg.push("</g>");
}

svg.push("</svg>");
writeFileSync(svgPath, svg.join("\n"));
console.log(`\nflame chart: ${svgPath}`);
