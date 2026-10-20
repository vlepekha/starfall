/**
 * Крихітний програмний растеризатор: все, що потрібно для спрайтів.
 * Працює з RGBA-буфером напряму; згладжування — суперсемплінг,
 * тобто кожен піксель рахується кілька разів у підточках і усереднюється.
 */
export class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /** Накладання «source-over» — так само, як це робить canvas. */
  blend(x, y, [r, g, b, a]) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const dstA = this.data[i + 3] / 255;
    const srcA = a;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    this.data[i] = (r * 255 * srcA + this.data[i] * dstA * (1 - srcA)) / outA;
    this.data[i + 1] = (g * 255 * srcA + this.data[i + 1] * dstA * (1 - srcA)) / outA;
    this.data[i + 2] = (b * 255 * srcA + this.data[i + 2] * dstA * (1 - srcA)) / outA;
    this.data[i + 3] = outA * 255;
  }

  /**
   * Головний примітив: для кожного пікселя викликає shade(x, y) у локальних
   * координатах і отримує [r, g, b, a] у діапазоні 0..1 (або null — пропуск).
   * Суперсемплінг 3x3 дає рівні краї без окремого коду згладжування.
   */
  paint(x0, y0, w, h, shade, samples = 3) {
    const step = 1 / samples;
    for (let py = y0; py < y0 + h; py += 1) {
      for (let px = x0; px < x0 + w; px += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let hits = 0;
        for (let sy = 0; sy < samples; sy += 1) {
          for (let sx = 0; sx < samples; sx += 1) {
            const colour = shade(px + (sx + 0.5) * step - x0, py + (sy + 0.5) * step - y0);
            if (!colour) continue;
            r += colour[0] * colour[3];
            g += colour[1] * colour[3];
            b += colour[2] * colour[3];
            a += colour[3];
            hits += 1;
          }
        }
        if (!hits || a === 0) continue;
        const total = samples * samples;
        this.blend(px, py, [r / a, g / a, b / a, a / total]);
      }
    }
  }

  /** Копіювання одного растра в інший — складання кадрів у спрайтшит. */
  blit(source, x0, y0) {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const i = (y * source.width + x) * 4;
        const a = source.data[i + 3] / 255;
        if (a <= 0) continue;
        this.blend(x0 + x, y0 + y, [
          source.data[i] / 255,
          source.data[i + 1] / 255,
          source.data[i + 2] / 255,
          a,
        ]);
      }
    }
  }
}

/** Детермінований шум — той самий, що й у рендері, щоб стиль збігався. */
export function noise(i, seed) {
  const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export const hex = (value) => {
  const n = Number.parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Точка всередині многокутника — класичний ray casting. */
export function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Відстань від точки до найближчого ребра многокутника. */
export function distanceToPolygon(points, x, y) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (xi + dx * t), y - (yi + dy * t)));
  }
  return best;
}
