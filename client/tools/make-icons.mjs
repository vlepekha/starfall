/**
 * Іконки для PWA.
 *
 * Малюємо тим самим растеризатором, що й спрайти (лаба 3): так іконка
 * на домашньому екрані збігається з кораблем у грі, і в репозиторії
 * не з'являються бінарники «з інтернету», походження яких невідоме.
 *
 * Потрібні три розміри:
 *   192 і 512 — вимога манифесту PWA (менший для списку, більший для
 *               сплеш-екрана, який Android генерує сам);
 *   512 maskable — Android обрізає іконку під форму теми, тому вся
 *               графіка має вміститися в центральні 80% («safe zone»).
 *
 * Запуск: node tools/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { encodePng } from "./png.mjs";
import { hex, insidePolygon, Raster } from "./raster.mjs";

const OUT_DIR = resolve(import.meta.dirname, "../public/icons");

const SPACE = hex("#070b14");
const HULL = hex("#cfe3ff");
const HULL_DARK = hex("#5f7fb5");
const GLOW = hex("#7ee0ff");
const FLAME = hex("#ffb648");

/**
 * Силует корабля в нормованих координатах -1..1 (нос угору).
 *
 * Многокутником, а не нерівностями: нерівності легко написати так,
 * що фігура «тече» за межі — перша версія цієї іконки саме так і
 * вивела ніс за край полотна.
 */
const HULL_SHAPE = [
  [0, -1], // ніс
  [0.62, 0.62], // праве крило
  [0.26, 0.4],
  [0, 0.56], // виїмка в хвості
  [-0.26, 0.4],
  [-0.62, 0.62], // ліве крило
];

const FLAME_SHAPE = [
  [-0.2, 0.5],
  [0.2, 0.5],
  [0, 1.02],
];

function shipAt(nx, ny, scale) {
  const x = nx / scale;
  const y = ny / scale;

  if (insidePolygon(HULL_SHAPE, x, y)) {
    // Світло падає зліва: лівий борт світліший за правий.
    const t = Math.min(1, Math.max(0, (x + 0.6) / 1.2));
    return [
      HULL[0] * (1 - t * 0.5) + HULL_DARK[0] * t * 0.5,
      HULL[1] * (1 - t * 0.5) + HULL_DARK[1] * t * 0.5,
      HULL[2] * (1 - t * 0.5) + HULL_DARK[2] * t * 0.5,
      1,
    ];
  }

  if (insidePolygon(FLAME_SHAPE, x, y)) {
    // Полум'я згасає до кінчика.
    const t = Math.min(1, Math.max(0, (y - 0.5) / 0.52));
    return [FLAME[0], FLAME[1] * (1 - t * 0.25), FLAME[2] * (1 - t * 0.6), 1 - t * 0.65];
  }

  return null;
}

function drawIcon(size, { maskable = false } = {}) {
  const raster = new Raster(size, size);
  const center = size / 2;
  // Для maskable графіка займає 60% замість 78%: решта — поля, які
  // система має право обрізати.
  const scale = size * (maskable ? 0.29 : 0.38);

  raster.paint(0, 0, size, size, (px, py) => {
    const nx = px - center;
    const ny = py - center;
    const radius = Math.hypot(nx, ny) / center;

    const ship = shipAt(nx, ny, scale);
    if (ship) return ship;

    // Фон: темне небо з м'яким сяйвом у центрі.
    const glow = Math.max(0, 1 - radius * 1.45) ** 2 * 0.5;
    return [SPACE[0] + GLOW[0] * glow, SPACE[1] + GLOW[1] * glow, SPACE[2] + GLOW[2] * glow, 1];
  });

  return encodePng(size, size, raster.data);
}

const files = [
  ["icon-192.png", drawIcon(192)],
  ["icon-512.png", drawIcon(512)],
  ["icon-maskable-512.png", drawIcon(512, { maskable: true })],
];

for (const [name, bytes] of files) {
  const target = resolve(OUT_DIR, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`${name} — ${(bytes.length / 1024).toFixed(1)} КБ`);
}
