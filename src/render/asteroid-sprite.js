/**
 * Процедурні спрайти астероїдів.
 *
 * Малювати всі деталі (кратери, крап, тіні) щокадру для 12 каменів —
 * це сотні шляхів на кадр. Замість цього кожен астероїд один раз
 * малюється в офскрін-канвас, а далі кадр лише повертає й виводить
 * готову картинку. Детальність перестає коштувати часу кадру.
 *
 * Кеш — Map за ключем «id:радіус:вид». Форма детермінована від id,
 * тому камінь виглядає однаково від появи до розпаду.
 */

const cache = new Map();
const MAX_CACHE = 64;

/** Той самий детермінований шум, що й у фоні: без Math.random. */
function noise(i, seed) {
  const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Світло завжди згори-зліва — від цього залежать усі тіні на камені. */
const LIGHT = { x: -0.55, y: -0.68 };

/**
 * `tint` — тільки для освітленого краю силуету.
 * `surface` — для кратерів, крапу й мікрорельєфу. Розділені навмисно:
 * якщо фарбувати поверхню кольором підсвітки, камінь стає рівномірно
 * забарвленим і втрачає матеріальність (особливо помітно на мисливці).
 */
const PALETTES = [
  {
    name: "basalt",
    high: "#6b7794",
    mid: "#3c4766",
    low: "#141a2c",
    tint: "#8aa0c8",
    surface: "#9fb2d4",
  },
  {
    name: "iron",
    high: "#7d7486",
    mid: "#443d52",
    low: "#171320",
    tint: "#b4a0c0",
    surface: "#c0b2cb",
  },
  {
    name: "ice",
    high: "#7f98ac",
    mid: "#3e5468",
    low: "#101b26",
    tint: "#a8d4ea",
    surface: "#c3e0f0",
  },
  {
    name: "ochre",
    high: "#8a7d6a",
    mid: "#4f4536",
    low: "#1d1811",
    tint: "#d8bb8a",
    surface: "#e0c79c",
  },
];

const HUNTER_PALETTE = {
  name: "hunter",
  high: "#6f4152",
  mid: "#3a1f2d",
  low: "#140a12",
  tint: "#ff9ec0",
  surface: "#b58a98", // приглушений, щоб кратери не світилися рожевим
};

/** Контур: дві «октави» шуму — великі горби плюс дрібна нерівність. */
function buildOutline(seed, radius, vertices = 22) {
  const points = [];
  for (let i = 0; i < vertices; i += 1) {
    const angle = (Math.PI * 2 * i) / vertices;
    const coarse = 0.78 + 0.26 * noise(seed + i * 1.7, 3);
    const fine = 0.96 + 0.08 * noise(seed + i * 9.3, 17);
    const r = radius * coarse * fine;
    points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, angle, r });
  }
  return points;
}

/** Замкнутий шлях через точки контуру, згладжений квадратичними кривими. */
function tracePath(ctx, points) {
  ctx.beginPath();
  const first = points[0];
  const last = points[points.length - 1];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  ctx.closePath();
}

function drawCraters(ctx, seed, radius, palette) {
  const count = 4 + Math.floor(noise(seed, 23) * 5);
  for (let i = 0; i < count; i += 1) {
    const angle = noise(seed + i * 13, 5) * Math.PI * 2;
    const distance = radius * (0.1 + 0.55 * noise(seed + i * 29, 7));
    const cr = radius * (0.1 + 0.16 * noise(seed + i * 41, 11));
    const cx = Math.cos(angle) * distance;
    const cy = Math.sin(angle) * distance;

    // Чаша: темніша в бік світла, світліша на протилежному краю —
    // саме так виглядає заглиблення, а не горб.
    const bowl = ctx.createLinearGradient(
      cx + LIGHT.x * cr,
      cy + LIGHT.y * cr,
      cx - LIGHT.x * cr,
      cy - LIGHT.y * cr,
    );
    bowl.addColorStop(0, "rgba(0, 0, 0, 0.62)");
    bowl.addColorStop(0.55, "rgba(0, 0, 0, 0.24)");
    bowl.addColorStop(1, `${palette.surface}3a`);
    ctx.beginPath();
    ctx.ellipse(cx, cy, cr, cr * (0.78 + 0.2 * noise(seed + i, 31)), angle, 0, Math.PI * 2);
    ctx.fillStyle = bowl;
    ctx.fill();

    // Вал по краю кратера з боку світла.
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 1.02, Math.PI * 0.95, Math.PI * 2.05);
    ctx.strokeStyle = `${palette.surface}40`;
    ctx.lineWidth = Math.max(1, cr * 0.18);
    ctx.stroke();
  }
}

/**
 * Мікрорельєф: десятки дрібних горбків. Кожен — пара дуг: темна з боку
 * тіні, світла з боку світла. Разом це дає відчуття шорсткої поверхні,
 * якого не дають ні кратери, ні крап окремо.
 */
function drawMicroRelief(ctx, seed, radius, palette) {
  const count = Math.round(radius * 0.5);
  for (let i = 0; i < count; i += 1) {
    const angle = noise(seed + i * 2.7, 107) * Math.PI * 2;
    const distance = radius * Math.sqrt(noise(seed + i * 4.1, 109)) * 0.93;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    // Розкид розмірів важливіший за кількість: однакові горбки читаються
    // як регулярний візерунок, а не як камінь.
    const scale = noise(seed + i, 113);
    const r = radius * (0.012 + 0.05 * scale * scale);
    const tilt = noise(seed + i * 6.3, 127) * Math.PI * 2;

    // Тільки дуги з боку світла й тіні, без замкнутих кілець.
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.68, tilt, Math.PI * 1.08, Math.PI * 1.72);
    ctx.strokeStyle = `${palette.surface}22`;
    ctx.lineWidth = Math.max(0.5, r * 0.22);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.68, tilt, Math.PI * 0.12, Math.PI * 0.76);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.26)";
    ctx.lineWidth = Math.max(0.5, r * 0.22);
    ctx.stroke();
  }
}

/** Дрібний крап — без нього поверхня виглядає «пластиковою». */
function drawSpeckles(ctx, seed, radius, palette) {
  const count = Math.round(radius * 1.6);
  for (let i = 0; i < count; i += 1) {
    const angle = noise(seed + i * 3.1, 37) * Math.PI * 2;
    const distance = radius * Math.sqrt(noise(seed + i * 5.7, 41)) * 0.95;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const size = 0.4 + noise(seed + i, 47) * 1.5;
    const light = noise(seed + i * 2.3, 53);
    ctx.fillStyle =
      light > 0.62 ? `${palette.surface}3a` : light > 0.3 ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Кілька тріщин — ламані лінії від краю всередину. */
function drawCracks(ctx, seed, radius, palette) {
  const count = 1 + Math.floor(noise(seed, 59) * 3);
  ctx.lineCap = "round";
  for (let i = 0; i < count; i += 1) {
    let angle = noise(seed + i * 17, 61) * Math.PI * 2;
    let x = Math.cos(angle) * radius * 0.9;
    let y = Math.sin(angle) * radius * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 3 + Math.floor(noise(seed + i, 67) * 3);
    for (let s = 0; s < segments; s += 1) {
      angle += (noise(seed + i * 7 + s, 71) - 0.5) * 1.1 + Math.PI;
      const step = radius * (0.14 + 0.2 * noise(seed + s, 73));
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(0, 0, 0, 0.38)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = `${palette.surface}18`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
}

/**
 * @returns {{canvas: HTMLCanvasElement, half: number, scale: number}}
 *   canvas із готовим каменем; half — половина сторони в СВІТОВИХ одиницях.
 */
export function getAsteroidSprite(asteroid, superSample = 3) {
  const radius = asteroid.radius;
  const key = `${asteroid.id}:${Math.round(radius)}:${asteroid.hunting ? "h" : "n"}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const seed = asteroid.id * 7 + 1;
  const palette = asteroid.hunting
    ? HUNTER_PALETTE
    : PALETTES[Math.floor(noise(seed, 83) * PALETTES.length) % PALETTES.length];

  const pad = radius * 0.35; // місце під світіння й тінь
  const half = radius + pad;
  const size = Math.ceil(half * 2 * superSample);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.translate(size / 2, size / 2);
  ctx.scale(superSample, superSample);

  const outline = buildOutline(seed, radius);

  // 1. Силует і базове освітлення.
  tracePath(ctx, outline);
  ctx.save();
  ctx.clip();

  const body = ctx.createLinearGradient(
    LIGHT.x * radius,
    LIGHT.y * radius,
    -LIGHT.x * radius * 1.3,
    -LIGHT.y * radius * 1.3,
  );
  body.addColorStop(0, palette.high);
  body.addColorStop(0.45, palette.mid);
  body.addColorStop(1, palette.low);
  ctx.fillStyle = body;
  ctx.fillRect(-half, -half, half * 2, half * 2);

  // 2. Поверхня: великі плями, кратери, тріщини, крап.
  for (let i = 0; i < 5; i += 1) {
    const a = noise(seed + i * 19, 89) * Math.PI * 2;
    const d = radius * noise(seed + i * 23, 97) * 0.7;
    const r = radius * (0.3 + 0.4 * noise(seed + i, 101));
    const blob = ctx.createRadialGradient(
      Math.cos(a) * d,
      Math.sin(a) * d,
      0,
      Math.cos(a) * d,
      Math.sin(a) * d,
      r,
    );
    blob.addColorStop(
      0,
      noise(seed + i, 103) > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.18)",
    );
    blob.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = blob;
    ctx.fillRect(-half, -half, half * 2, half * 2);
  }

  drawMicroRelief(ctx, seed, radius, palette);
  drawCraters(ctx, seed, radius, palette);
  drawCracks(ctx, seed, radius, palette);
  drawSpeckles(ctx, seed, radius, palette);

  // 3. Термінатор: затемнення тіньової півсфери поверх усього.
  const shade = ctx.createRadialGradient(
    LIGHT.x * radius * 0.7,
    LIGHT.y * radius * 0.7,
    radius * 0.2,
    0,
    0,
    radius * 1.25,
  );
  shade.addColorStop(0, "rgba(0, 0, 0, 0)");
  shade.addColorStop(0.62, "rgba(0, 0, 0, 0.22)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.72)");
  ctx.fillStyle = shade;
  ctx.fillRect(-half, -half, half * 2, half * 2);

  ctx.restore();

  // 4. Освітлений край — тонка смужка з боку світла.
  ctx.save();
  tracePath(ctx, outline);
  ctx.clip();
  tracePath(ctx, outline);
  const rim = ctx.createLinearGradient(
    LIGHT.x * radius,
    LIGHT.y * radius,
    -LIGHT.x * radius,
    -LIGHT.y * radius,
  );
  rim.addColorStop(0, `${palette.tint}d0`);
  rim.addColorStop(0.35, `${palette.tint}30`);
  rim.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.restore();

  // 5. Мисливець світиться зсередини — попередження для гравця.
  if (asteroid.hunting) {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.9);
    glow.addColorStop(0, "rgba(255, 140, 175, 0.22)");
    glow.addColorStop(0.5, "rgba(255, 110, 150, 0.07)");
    glow.addColorStop(1, "rgba(255, 110, 150, 0)");
    ctx.save();
    tracePath(ctx, outline);
    ctx.clip();
    ctx.fillStyle = glow;
    ctx.fillRect(-half, -half, half * 2, half * 2);
    ctx.restore();
  }

  const sprite = { canvas, half };

  // Простий ліміт кеша: астероїди живуть недовго, ключів накопичується мало.
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, sprite);
  return sprite;
}

export function clearAsteroidSpriteCache() {
  cache.clear();
}
