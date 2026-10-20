/**
 * Генератор ассетів: спрайтшити (PNG) і звуки (WAV) у public/assets.
 *
 * Навіщо генерувати, а не класти готові файли: так у репозиторії немає
 * бінарників невідомого походження, а будь-який спрайт відтворюється
 * командою `npm run assets`. Усі форми детерміновані — перегенерація
 * дає байт у байт той самий файл.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { encodePng } from "./png.mjs";
import { distanceToPolygon, hex, insidePolygon, mix, noise, Raster } from "./raster.mjs";
import { encodeWav } from "./wav.mjs";

const OUT = new URL("../public/assets/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const LIGHT = { x: -0.55, y: -0.68 };

/** Корабель зміщений праворуч у кадрі, щоб ліворуч лишилося місце під полум'я. */
const SHIP_ORIGIN_X = 58;

/* ------------------------------------------------------------------ */
/*  Кораблі: 4 кадри 64x64 — без тяги, тяга мала, тяга повна, влучання   */
/* ------------------------------------------------------------------ */

const HULL = [
  [25, 0],
  [4, -9],
  [-15, -8],
  [-11, 0],
  [-15, 8],
  [4, 9],
];
const WING_TOP = [
  [2, -5],
  [-10, -17],
  [-17, -15],
  [-12, -5],
];
const WING_BOTTOM = WING_TOP.map(([x, y]) => [x, -y]);
const COCKPIT = [
  [13, 0],
  [4, -4.5],
  [-3, 0],
  [4, 4.5],
];

/**
 * Кадр корабля НЕ квадратний: полум'я тягнеться назад далеко за силует,
 * і в квадраті 64x64 його просто обрізало б. Тому кадр 96x64, а корабель
 * зміщений праворуч; точка прив'язки (origin) їде в маніфест.
 */
function drawShipFrame(width, height, { flame = 0, hit = false }) {
  const r = new Raster(width, height);
  const cx = SHIP_ORIGIN_X;
  const cy = height / 2;

  const hullHigh = hex("#e8f4ff");
  const hullMid = hex("#8fb0d8");
  const hullLow = hex("#243352");
  const wing = hex("#16203c");
  const glassHigh = hex("#bff3ff");
  const glassLow = hex("#1d6fa8");

  r.paint(0, 0, width, height, (px, py) => {
    const x = px - cx;
    const y = py - cy;

    // Полум'я двигуна. Окремі кадри, тому інтенсивність — параметр, а не час.
    // Профіль ширини спадає степенево, а не лінійно: так смолоскип виходить
    // гострим на кінці, а не схожим на прямокутну смугу.
    if (flame > 0) {
      const nozzle = -13;
      const length = 18 + flame * 26;
      const d = (nozzle - x) / length;
      if (d >= 0 && d <= 1) {
        const width = (3 + flame * 5.5) * (1 - d) ** 0.75 + 0.8;
        const across = Math.abs(y) / width;
        if (across <= 1) {
          const core = (1 - across) ** 1.6;
          const colour = mix(hex("#ff4d1a"), hex("#fff8e0"), core * (1 - d * 0.55));
          return [...colour, Math.min(1, (1 - d) ** 1.3 * (0.25 + core * 0.85))];
        }
      }
    }

    if (insidePolygon(COCKPIT, x, y)) {
      return [...mix(glassHigh, glassLow, (x + 3) / -16 + 1), 1];
    }

    if (insidePolygon(HULL, x, y)) {
      const t = Math.min(1, Math.max(0, (25 - x) / 43));
      const base = t < 0.45 ? mix(hullHigh, hullMid, t / 0.45) : mix(hullMid, hullLow, (t - 0.45) / 0.55);
      // Світло згори-зліва: верхня половина трохи яскравіша.
      const lit = 1 + (-y / 12) * 0.28;
      const colour = base.map((c) => Math.min(1, c * lit));
      return [...(hit ? mix(colour, hex("#ff6b7d"), 0.55) : colour), 1];
    }

    if (insidePolygon(WING_TOP, x, y) || insidePolygon(WING_BOTTOM, x, y)) {
      return [...(hit ? mix(wing, hex("#ff6b7d"), 0.4) : wing), 1];
    }

    // Світний контур: рівна смужка завтовшки 1.4 пікселя назовні від силуету.
    // Через відстань до ребра, а не через масштабування точки, — інакше
    // товщина залежала б від відстані до центру й на кормі була б удвічі більшою.
    let edge = Number.POSITIVE_INFINITY;
    for (const poly of [HULL, WING_TOP, WING_BOTTOM]) {
      edge = Math.min(edge, distanceToPolygon(poly, x, y));
    }
    if (edge < 1.4) return [...hex("#9fe6ff"), 0.9 * (1 - edge / 1.4) + 0.25];
    return null;
  });

  return r;
}

/* ------------------------------------------------------------------ */
/*  Астероїди: 6 варіантів 128x128 (4 звичайні + 2 мисливці)            */
/* ------------------------------------------------------------------ */

const ROCK_PALETTES = [
  { high: "#6b7794", mid: "#3c4766", low: "#141a2c", surface: "#9fb2d4" },
  { high: "#7d7486", mid: "#443d52", low: "#171320", surface: "#c0b2cb" },
  { high: "#7f98ac", mid: "#3e5468", low: "#101b26", surface: "#c3e0f0" },
  { high: "#8a7d6a", mid: "#4f4536", low: "#1d1811", surface: "#e0c79c" },
];
const HUNTER_PALETTE = { high: "#6f4152", mid: "#3a1f2d", low: "#140a12", surface: "#b58a98" };

function drawAsteroidFrame(size, seed, hunting) {
  const r = new Raster(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;
  const palette = hunting ? HUNTER_PALETTE : ROCK_PALETTES[seed % ROCK_PALETTES.length];
  const high = hex(palette.high);
  const mid = hex(palette.mid);
  const low = hex(palette.low);
  const surface = hex(palette.surface);

  // Межа каменя: дві «октави» шуму по куту.
  const boundary = (angle) => {
    const i = (angle / (Math.PI * 2)) * 22;
    const coarse = 0.78 + 0.26 * noise(seed * 7 + Math.floor(i) * 1.7, 3);
    const next = 0.78 + 0.26 * noise(seed * 7 + (Math.floor(i) + 1) * 1.7, 3);
    const t = i - Math.floor(i);
    const smooth = coarse + (next - coarse) * (t * t * (3 - 2 * t));
    return radius * smooth;
  };

  // Кратери: позиція/розмір детерміновані від seed.
  const craters = Array.from({ length: 4 + (seed % 4) }, (_, i) => {
    const a = noise(seed * 13 + i * 13, 5) * Math.PI * 2;
    const d = radius * (0.1 + 0.55 * noise(seed * 13 + i * 29, 7));
    return {
      x: Math.cos(a) * d,
      y: Math.sin(a) * d,
      r: radius * (0.1 + 0.16 * noise(seed * 13 + i * 41, 11)),
    };
  });

  r.paint(0, 0, size, size, (px, py) => {
    const x = px - cx;
    const y = py - cy;
    const dist = Math.hypot(x, y);
    const edge = boundary(Math.atan2(y, x) + Math.PI);
    if (dist > edge) return null;

    // Освітлення: наскільки точка «дивиться» на джерело світла.
    const nx = x / edge;
    const ny = y / edge;
    const facing = Math.max(0, -(nx * LIGHT.x + ny * LIGHT.y) * -1);
    const t = Math.min(1, Math.max(0, (nx * LIGHT.x + ny * LIGHT.y + 1) / 2));
    let colour = t > 0.5 ? mix(mid, high, (t - 0.5) * 2) : mix(low, mid, t * 2);

    // Крап і дрібний рельєф.
    const grain = noise(px * 3.1 + py * 7.7, seed + 17);
    colour = mix(colour, grain > 0.62 ? surface : [0, 0, 0], grain > 0.62 ? 0.12 : 0.08);

    // Кратери: темна чаша, світлий вал з боку світла.
    for (const c of craters) {
      const cd = Math.hypot(x - c.x, y - c.y);
      if (cd > c.r * 1.15) continue;
      if (cd > c.r) {
        const rimLight = -((x - c.x) * LIGHT.x + (y - c.y) * LIGHT.y) / c.r;
        colour = mix(colour, surface, Math.max(0, rimLight) * 0.35);
        continue;
      }
      const bowl = ((x - c.x) * LIGHT.x + (y - c.y) * LIGHT.y) / c.r;
      colour = mix(colour, [0, 0, 0], 0.45 - bowl * 0.25);
    }

    // Термінатор: затемнення до краю тіні.
    colour = mix(colour, [0, 0, 0], Math.min(0.7, Math.max(0, (1 - t) * 0.75)));

    // Освітлений край силуету.
    const rim = 1 - dist / edge;
    if (rim < 0.08 && t > 0.5) colour = mix(colour, surface, (0.08 - rim) * 9 * facing);

    if (hunting) colour = mix(colour, hex("#ff8fb0"), Math.max(0, 0.22 - dist / edge * 0.22));

    return [...colour, 1];
  });

  return r;
}

/* ------------------------------------------------------------------ */
/*  Кулі: 2 кадри 24x24 — звичайна і самонавідна                        */
/* ------------------------------------------------------------------ */

function drawBulletFrame(size, colourHex) {
  const r = new Raster(size, size);
  const c = size / 2;
  const colour = hex(colourHex);
  r.paint(0, 0, size, size, (px, py) => {
    const x = px - c;
    const y = py - c;
    const d = Math.hypot(x * 0.55, y); // витягнута вздовж польоту
    if (d > c) return null;
    const core = Math.max(0, 1 - d / (c * 0.45));
    const glow = Math.max(0, 1 - d / c);
    return [...mix(colour, [1, 1, 1], core * 0.8), Math.min(1, core + glow * glow * 0.55)];
  });
  return r;
}

/* ------------------------------------------------------------------ */
/*  Звуки                                                              */
/* ------------------------------------------------------------------ */

const RATE = 44100;

function makeSamples(seconds, fn) {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = fn(i / RATE, i / n);
  return out;
}

/** Детермінований «шум» — щоб файли перегенерувалися однаково. */
let rngState = 12345;
const rnd = () => {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 2147483648 - 1;
};

const sounds = {
  // Постріл: спадний свіп плюс короткий клац.
  "sfx-fire": makeSamples(0.18, (t, p) => {
    const freq = 880 - 620 * p;
    const env = Math.exp(-14 * t);
    return (Math.sin(2 * Math.PI * freq * t) * 0.6 + rnd() * 0.15) * env * 0.6;
  }),
  // Влучання: глухий удар.
  "sfx-hit": makeSamples(0.14, (t, p) => {
    const env = Math.exp(-26 * t);
    return (Math.sin(2 * Math.PI * (180 - 90 * p) * t) * 0.8 + rnd() * 0.3) * env * 0.7;
  }),
  // Вибух: шумовий сплеск із довгим хвостом.
  "sfx-explode": makeSamples(0.6, (t) => {
    const env = Math.exp(-6 * t);
    const rumble = Math.sin(2 * Math.PI * 70 * t) * 0.4;
    return (rnd() * 0.9 + rumble) * env * 0.55;
  }),
};

/* ------------------------------------------------------------------ */

function sheetWide(frames, frameWidth, frameHeight) {
  const out = new Raster(frameWidth * frames.length, frameHeight);
  frames.forEach((frame, i) => out.blit(frame, i * frameWidth, 0));
  return out;
}

function sheet(frames, frameSize) {
  const out = new Raster(frameSize * frames.length, frameSize);
  frames.forEach((frame, i) => out.blit(frame, i * frameSize, 0));
  return out;
}

const SHIP_W = 96;
const SHIP_H = 64;
const ROCK_SIZE = 128;
const BULLET_SIZE = 24;

const ships = sheetWide(
  [
    drawShipFrame(SHIP_W, SHIP_H, { flame: 0 }),
    drawShipFrame(SHIP_W, SHIP_H, { flame: 0.55 }),
    drawShipFrame(SHIP_W, SHIP_H, { flame: 1 }),
    drawShipFrame(SHIP_W, SHIP_H, { flame: 0, hit: true }),
  ],
  SHIP_W,
  SHIP_H,
);

const asteroids = sheet(
  [
    drawAsteroidFrame(ROCK_SIZE, 1, false),
    drawAsteroidFrame(ROCK_SIZE, 2, false),
    drawAsteroidFrame(ROCK_SIZE, 3, false),
    drawAsteroidFrame(ROCK_SIZE, 4, false),
    drawAsteroidFrame(ROCK_SIZE, 5, true),
    drawAsteroidFrame(ROCK_SIZE, 6, true),
  ],
  ROCK_SIZE,
);

const bullets = sheet(
  [drawBulletFrame(BULLET_SIZE, "#9fe6ff"), drawBulletFrame(BULLET_SIZE, "#b388ff")],
  BULLET_SIZE,
);

const images = {
  "ships.png": {
    raster: ships,
    frameWidth: SHIP_W,
    frameHeight: SHIP_H,
    frames: 4,
    originX: SHIP_ORIGIN_X,
    originY: SHIP_H / 2,
  },
  "asteroids.png": { raster: asteroids, frameWidth: ROCK_SIZE, frameHeight: ROCK_SIZE, frames: 6 },
  "bullets.png": {
    raster: bullets,
    frameWidth: BULLET_SIZE,
    frameHeight: BULLET_SIZE,
    frames: 2,
  },
};

for (const [name, { raster }] of Object.entries(images)) {
  writeFileSync(new URL(name, OUT), encodePng(raster.width, raster.height, raster.data));
  console.log(`${name}: ${raster.width}x${raster.height}`);
}

for (const [name, samples] of Object.entries(sounds)) {
  writeFileSync(new URL(`${name}.wav`, OUT), encodeWav(samples, RATE));
  console.log(`${name}.wav: ${(samples.length / RATE).toFixed(2)} с`);
}

const manifest = {
  version: 1,
  images: Object.entries(images).map(([name, meta]) => ({
    id: name.replace(".png", ""),
    url: `/assets/${name}`,
    frameWidth: meta.frameWidth,
    frameHeight: meta.frameHeight,
    frames: meta.frames,
    // Точка прив'язки у пікселях кадру: навколо неї обертається спрайт.
    originX: meta.originX ?? meta.frameWidth / 2,
    originY: meta.originY ?? meta.frameHeight / 2,
  })),
  audio: Object.keys(sounds).map((name) => ({
    id: name.replace("sfx-", ""),
    url: `/assets/${name}.wav`,
  })),
  data: [{ id: "arena", url: "/assets/arena.json" }],
};

writeFileSync(new URL("manifest.json", OUT), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  new URL("arena.json", OUT),
  `${JSON.stringify(
    {
      asteroidLimit: 12,
      pickupLimit: 2,
      asteroidInterval: [2.5, 4.5],
      pickupInterval: [9, 15],
    },
    null,
    2,
  )}\n`,
);
console.log("manifest.json, arena.json");
