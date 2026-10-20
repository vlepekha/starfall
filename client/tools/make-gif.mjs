/**
 * Складає GIF із кадрів, знятих у двох вікнах гри.
 *
 * Кадри знімаються в браузері (canvas.toDataURL) і складаються сюди
 * у вигляді PNG: p1-000.png, p2-000.png і так далі. Далі два кадри
 * з однаковим номером кладуться поруч, зверху підписуються, і все
 * це перетворюється на GIF.
 *
 * Запуск: node tools/make-gif.mjs <каталог-з-кадрами> <вихідний.gif>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPalette, encodeGif, toIndexed } from "./gif.mjs";
import { decodePng } from "./png-decode.mjs";

const [, , inputDir, outputPath] = process.argv;
if (!inputDir || !outputPath) {
  console.error("використання: node tools/make-gif.mjs <каталог> <вихід.gif>");
  process.exit(1);
}

const GAP = 10;
const LABEL_HEIGHT = 18;

const files = readdirSync(inputDir).filter((f) => f.endsWith(".png"));
const left = files.filter((f) => f.startsWith("p1-")).sort();
const right = files.filter((f) => f.startsWith("p2-")).sort();
const count = Math.min(left.length, right.length);
if (count === 0) throw new Error("кадрів не знайдено");

const first = decodePng(readFileSync(join(inputDir, left[0])));
const frameWidth = first.width * 2 + GAP;
const frameHeight = first.height + LABEL_HEIGHT;

/** Крихітний растровий шрифт 5x7 — підписати два вікна. */
const FONT = {
  1: ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  Г: ["11111", "10000", "10000", "10000", "10000", "10000", "10000"],
  Р: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  А: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  В: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  Е: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  Ц: ["10001", "10001", "10001", "10001", "10001", "11111", "00001"],
  Ь: ["10000", "10000", "10000", "11110", "10001", "10001", "11110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawText(pixels, width, text, x0, y0, colour) {
  let cursor = x0;
  for (const char of text) {
    const glyph = FONT[char] ?? FONT[" "];
    glyph.forEach((row, gy) => {
      [...row].forEach((bit, gx) => {
        if (bit !== "1") return;
        const x = cursor + gx;
        const y = y0 + gy;
        const i = (y * width + x) * 4;
        pixels[i] = colour[0];
        pixels[i + 1] = colour[1];
        pixels[i + 2] = colour[2];
        pixels[i + 3] = 255;
      });
    });
    cursor += 6;
  }
}

const composed = [];
for (let i = 0; i < count; i += 1) {
  const a = decodePng(readFileSync(join(inputDir, left[i])));
  const b = decodePng(readFileSync(join(inputDir, right[i])));

  const pixels = new Uint8Array(frameWidth * frameHeight * 4);
  // Тло смужки з підписами.
  for (let p = 0; p < pixels.length; p += 4) {
    pixels[p] = 10;
    pixels[p + 1] = 15;
    pixels[p + 2] = 31;
    pixels[p + 3] = 255;
  }

  const blit = (src, offsetX) => {
    for (let y = 0; y < src.height; y += 1) {
      for (let x = 0; x < src.width; x += 1) {
        const from = (y * src.width + x) * 4;
        const to = ((y + LABEL_HEIGHT) * frameWidth + x + offsetX) * 4;
        pixels[to] = src.pixels[from];
        pixels[to + 1] = src.pixels[from + 1];
        pixels[to + 2] = src.pixels[from + 2];
        pixels[to + 3] = 255;
      }
    }
  };

  blit(a, 0);
  blit(b, a.width + GAP);
  drawText(pixels, frameWidth, "ГРАВЕЦЬ 1", 6, 5, [126, 224, 255]);
  drawText(pixels, frameWidth, "ГРАВЕЦЬ 2", a.width + GAP + 6, 5, [169, 140, 255]);

  composed.push(pixels);
}

// Палітра спільна на всі кадри: інакше між кадрами «пливли» б кольори.
const sample = Buffer.concat(composed.map((f) => Buffer.from(f.buffer, f.byteOffset, f.length)));
const palette = buildPalette(sample, 256);
const frames = composed.map((pixels) => toIndexed(pixels, palette));

const gif = encodeGif({
  width: frameWidth,
  height: frameHeight,
  frames,
  palette,
  delayMs: 110,
});

writeFileSync(outputPath, gif);
console.log(
  `${outputPath}: ${frameWidth}x${frameHeight}, ${frames.length} кадрів, ${(gif.length / 1024).toFixed(0)} КБ`,
);
