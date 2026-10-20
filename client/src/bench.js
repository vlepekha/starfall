/**
 * Автоматичний прогін усіх чотирьох режимів по 5 секунд.
 * Друкує готову markdown-таблицю в консоль і кладе її в буфер обміну,
 * щоб результати не переписувати руками в README.
 */
import { EXPERIMENTS } from "./experiments.js";

const SAMPLE_MS = 5000;
const WARMUP_MS = 1200;

export async function runBenchmark({ setMode, getStats, onProgress }) {
  const rows = [];
  for (const mode of Object.keys(EXPERIMENTS)) {
    setMode(mode);
    onProgress?.(`${EXPERIMENTS[mode].label} …`);
    await wait(WARMUP_MS);
    await wait(SAMPLE_MS);
    const s = getStats();
    rows.push({
      mode,
      label: EXPERIMENTS[mode].label,
      steps: s.stepsPerSecond,
      frames: s.framesPerSecond,
      frame: s.frameTimeMs,
      worst: s.longestFrameMs,
      acc: s.accumulatorMs,
      panics: s.panics,
    });
  }
  setMode("none");

  const table = toMarkdown(rows);
  console.log(table);
  navigator.clipboard?.writeText(table).catch(() => {});
  onProgress?.("готово — таблиця в консолі та в буфері обміну");
  return { rows, table };
}

function toMarkdown(rows) {
  const head =
    "| Режим | steps/s | frames/s | frame time, мс | worst frame, мс | accumulator, мс |";
  const sep = "| --- | ---: | ---: | ---: | ---: | ---: |";
  const body = rows.map(
    (r) =>
      `| ${r.label} | ${r.steps} | ${r.frames} | ${r.frame.toFixed(2)} | ${r.worst.toFixed(2)} | ${r.acc.toFixed(2)} |`,
  );
  return [
    `<!-- ${navigator.userAgent} · devicePixelRatio ${window.devicePixelRatio} -->`,
    head,
    sep,
    ...body,
  ].join("\n");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
