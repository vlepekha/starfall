/**
 * Мінімальний кодувальник GIF89a: палітра, LZW і цикл відтворення.
 *
 * Залежностей не додаємо — це той самий принцип, що й зі спрайтами:
 * усе, що потрапляє в репозиторій, має відтворюватися однією командою.
 */

/* ------------------------------------------------------------------ */
/*  Палітра: GIF вміє максимум 256 кольорів на кадр                     */
/* ------------------------------------------------------------------ */

/**
 * Квантування «популярністю»: згортаємо кольори до 5 біт на канал,
 * рахуємо частоти й беремо найчастіші. Для темного інтерфейсу з
 * невеликою кількістю відтінків цього достатньо; медіанний розріз
 * дав би краще, але й коду було б утричі більше.
 */
export function buildPalette(pixels, maxColours = 256) {
  const counts = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const key = ((pixels[i] >> 3) << 10) | ((pixels[i + 1] >> 3) << 5) | (pixels[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColours)
    .map(([key]) => [((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4]);

  while (top.length < 2) top.push([0, 0, 0]);
  return top;
}

/** Найближчий колір палітри — простий перебір, палітра маленька. */
function nearest(palette, r, g, b, cache) {
  const key = (r << 16) | (g << 8) | b;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    const [pr, pg, pb] = palette[i];
    // Ваги під сприйняття яскравості: око чутливіше до зеленого.
    const distance = 3 * (r - pr) ** 2 + 6 * (g - pg) ** 2 + (b - pb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  cache.set(key, best);
  return best;
}

export function toIndexed(pixels, palette) {
  const cache = new Map();
  const out = new Uint8Array(pixels.length / 4);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    out[p] = nearest(palette, pixels[i], pixels[i + 1], pixels[i + 2], cache);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  LZW — той самий алгоритм, що в GIF із 1987 року                     */
/* ------------------------------------------------------------------ */

function lzwEncode(indexed, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dictionary = new Map();

  const bytes = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  const resetDictionary = () => {
    dictionary = new Map();
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };

  emit(clearCode);
  resetDictionary();

  let current = String(indexed[0]);
  for (let i = 1; i < indexed.length; i += 1) {
    const symbol = indexed[i];
    const candidate = `${current},${symbol}`;
    if (dictionary.has(candidate)) {
      current = candidate;
      continue;
    }

    emit(current.includes(",") ? dictionary.get(current) : Number(current));
    dictionary.set(candidate, nextCode);
    nextCode += 1;

    if (nextCode > 1 << codeSize) {
      if (codeSize < 12) {
        codeSize += 1;
      } else {
        // Словник переповнився — чистимо його, інакше коди не влізуть.
        emit(clearCode);
        resetDictionary();
      }
    }
    current = String(symbol);
  }

  emit(current.includes(",") ? dictionary.get(current) : Number(current));
  emit(eoiCode);
  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return bytes;
}

/* ------------------------------------------------------------------ */
/*  Складання файлу                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {{width:number,height:number,frames:Uint8Array[],palette:number[][],delayMs:number}} spec
 *   frames — індекси палітри, по одному байту на піксель.
 */
export function encodeGif({ width, height, frames, palette, delayMs = 100 }) {
  const out = [];
  const push = (...values) => out.push(...values);
  const pushShort = (value) => push(value & 0xff, (value >> 8) & 0xff);

  // Таблиця кольорів має бути степенем двійки.
  let bits = 1;
  while (1 << bits < palette.length) bits += 1;
  const tableSize = 1 << bits;

  push(...[..."GIF89a"].map((c) => c.charCodeAt(0)));
  pushShort(width);
  pushShort(height);
  push(0x80 | (bits - 1), 0, 0); // є глобальна таблиця кольорів

  for (let i = 0; i < tableSize; i += 1) {
    const [r, g, b] = palette[i] ?? [0, 0, 0];
    push(r, g, b);
  }

  // Netscape-розширення: нескінченний цикл.
  push(0x21, 0xff, 11);
  push(...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)));
  push(3, 1, 0, 0, 0);

  const delay = Math.round(delayMs / 10); // GIF рахує у сотих секунди
  for (const frame of frames) {
    push(0x21, 0xf9, 4, 0);
    pushShort(delay);
    push(0, 0);

    push(0x2c);
    pushShort(0);
    pushShort(0);
    pushShort(width);
    pushShort(height);
    push(0);

    const minCodeSize = Math.max(2, bits);
    push(minCodeSize);

    const data = lzwEncode(frame, minCodeSize);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255);
      push(block.length, ...block);
    }
    push(0);
  }

  push(0x3b);
  return Buffer.from(out);
}
