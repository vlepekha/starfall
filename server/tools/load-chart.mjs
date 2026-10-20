/**
 * Графік навантаження: SVG із чисел, які дали bench-step і load-test.
 *
 * Малюємо SVG руками, без бібліотек: це 60 рядків коду, а залежність
 * у проєкті лишилася б назавжди.
 *
 * Запуск: node tools/load-chart.mjs > ../docs/load-chart.svg
 */

/** Вартість кроку симуляції, мс (p99), заміряна tools/bench-step.mjs. */
const SERIES = [
  {
    label: "повний перебір",
    color: "#ff9f6e",
    points: [
      [8, 0.0855],
      [32, 0.211],
      [64, 0.4754],
      [128, 1.4065],
    ],
  },
  {
    label: "сітка 128×128",
    color: "#7ee0ff",
    points: [
      [8, 0.1397],
      [32, 0.2625],
      [64, 0.5755],
      [128, 0.9533],
    ],
  },
];

const W = 760;
const H = 420;
const PAD = { left: 70, right: 180, top: 48, bottom: 56 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const MAX_Y = 1.5;
const XS = [8, 32, 64, 128];

const x = (ships) => PAD.left + (XS.indexOf(ships) / (XS.length - 1)) * plotW;
const y = (ms) => PAD.top + plotH - (ms / MAX_Y) * plotH;

const parts = [];
parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, sans-serif">`,
);
parts.push(`<rect width="${W}" height="${H}" fill="#070b14"/>`);
parts.push(
  `<text x="${PAD.left}" y="28" fill="#e8eefc" font-size="16">Вартість кроку симуляції, p99 (мс)</text>`,
);

// Сітка по Y і підписи
for (let i = 0; i <= 3; i += 1) {
  const value = (MAX_Y / 3) * i;
  const yy = y(value);
  parts.push(
    `<line x1="${PAD.left}" y1="${yy}" x2="${PAD.left + plotW}" y2="${yy}" stroke="#1d2740"/>`,
  );
  parts.push(
    `<text x="${PAD.left - 10}" y="${yy + 4}" fill="#8395b8" font-size="12" text-anchor="end">${value.toFixed(1)}</text>`,
  );
}

// Підписи по X
for (const ships of XS) {
  parts.push(
    `<text x="${x(ships)}" y="${PAD.top + plotH + 24}" fill="#8395b8" font-size="12" text-anchor="middle">${ships}</text>`,
  );
}
parts.push(
  `<text x="${PAD.left + plotW / 2}" y="${H - 14}" fill="#8395b8" font-size="12" text-anchor="middle">кораблів у світі</text>`,
);

// Бюджет такту 30 Гц — 33 мс, тут не вміщається, тому підписуємо словами
parts.push(
  `<text x="${PAD.left}" y="${PAD.top - 12}" fill="#5c6b8a" font-size="11">бюджет такту 33 мс — за межами графіка, обидві криві в нього вкладаються</text>`,
);

SERIES.forEach((series, index) => {
  const d = series.points.map(([s, ms], i) => `${i === 0 ? "M" : "L"}${x(s)} ${y(ms)}`).join(" ");
  parts.push(`<path d="${d}" fill="none" stroke="${series.color}" stroke-width="2.5"/>`);
  for (const [s, ms] of series.points) {
    parts.push(`<circle cx="${x(s)}" cy="${y(ms)}" r="4" fill="${series.color}"/>`);
  }
  const ly = PAD.top + 8 + index * 26;
  parts.push(
    `<rect x="${PAD.left + plotW + 24}" y="${ly - 9}" width="12" height="12" fill="${series.color}"/>`,
  );
  parts.push(
    `<text x="${PAD.left + plotW + 42}" y="${ly + 1}" fill="#e8eefc" font-size="13">${series.label}</text>`,
  );
});

// Точка перетину — головний висновок графіка
const cross = x(64);
parts.push(
  `<line x1="${cross}" y1="${PAD.top}" x2="${cross}" y2="${PAD.top + plotH}" stroke="#3a4866" stroke-dasharray="4 4"/>`,
);
parts.push(
  `<text x="${cross + 8}" y="${PAD.top + 18}" fill="#8395b8" font-size="11">тут сітка починає вигравати</text>`,
);

parts.push("</svg>");
process.stdout.write(`${parts.join("\n")}\n`);
