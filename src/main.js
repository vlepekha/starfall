import "./style.css";
import { runBenchmark } from "./bench.js";
import { burnMilliseconds, EXPERIMENTS } from "./experiments.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createIntervalLoop, createVariableLoop } from "./loop-variants.js";
import { createRenderer } from "./render/draw.js";
import { createHud } from "./render/hud.js";
import { createShip, integrate, interpolate } from "./sim/ship.js";

const canvas = document.querySelector("#arena");
const hudRoot = document.querySelector("#hud");
const modeSelect = document.querySelector("#mode");
const blockInput = document.querySelector("#block-ms");
const noteEl = document.querySelector("#note");

const input = createInput();
const renderer = createRenderer(canvas);
const hud = createHud(hudRoot);

// Два стани: попередній крок і поточний. Рендер малює щось між ними.
let previousState = createShip();
let currentState = previousState;
let loop = null;
let mode = "none";

function update(dt) {
  // Дія-подія: одне спрацювання на натискання, скільки б кроків клавішу
  // не тримали. Саме для цього в createInput є justPressed.
  if (input.justPressed("debug")) renderer.toggleVelocity();

  previousState = currentState;
  currentState = integrate(currentState, input.snapshot(), dt);

  // «Свіжі» натискання живуть рівно один крок симуляції.
  input.endStep();
}

function render(alpha) {
  // Експеримент 1: синхронна робота всередині кадру, один раз на кадр.
  if (mode === "block") {
    burnMilliseconds(Number(blockInput.value) || 0);
  }
  const view = mode === "variable" ? currentState : interpolate(previousState, currentState, alpha);
  renderer.render(view);
  hud.update(loop.stats, currentState, EXPERIMENTS[mode].label, performance.now());
}

function buildLoop() {
  if (mode === "interval")
    return createIntervalLoop({ update, render, stepHz: 60, intervalMs: 16 });
  if (mode === "variable") return createVariableLoop({ update, render });
  return createLoop({ update, render, stepHz: 60 });
}

function applyMode(next) {
  mode = next;
  loop?.stop();
  previousState = currentState;
  loop = buildLoop();
  loop.start();
  noteEl.textContent = EXPERIMENTS[mode].description;
  blockInput.disabled = mode !== "block";
}

for (const [value, meta] of Object.entries(EXPERIMENTS)) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = meta.label;
  modeSelect.appendChild(option);
}
modeSelect.value = "none";
modeSelect.addEventListener("change", (event) => applyMode(event.target.value));

const benchButton = document.querySelector("#bench");

async function startBenchmark() {
  benchButton.disabled = true;
  modeSelect.disabled = true;
  const result = await runBenchmark({
    setMode: (next) => {
      modeSelect.value = next;
      applyMode(next);
    },
    getStats: () => loop.stats,
    onProgress: (text) => {
      noteEl.textContent = `Benchmark: ${text}`;
    },
  });
  benchButton.disabled = false;
  modeSelect.disabled = false;
  return result;
}

benchButton.addEventListener("click", startBenchmark);

// ?bench=1 — автопрогін одразу після завантаження (зручно для скриптів і CI).
if (new URLSearchParams(window.location.search).has("bench")) {
  window.addEventListener("load", () => {
    startBenchmark().then(() => {
      document.title = `BENCH DONE — ${document.title}`;
    });
  });
}

document.querySelector("#reset").addEventListener("click", () => {
  currentState = createShip();
  previousState = currentState;
});

applyMode("none");

// Демонстрація порядку черг у консолі: див. розділ Reflection у README.
console.log("1 sync");
setTimeout(() => console.log("4 macrotask (setTimeout)"), 0);
queueMicrotask(() => console.log("3 microtask (queueMicrotask)"));
requestAnimationFrame(() => console.log("5 rAF (before paint)"));
Promise.resolve().then(() => console.log("3.1 microtask (Promise)"));
console.log("2 sync");

// Дебаг-хук: дозволяє знімати цифри для README прямо з консолі.
window.starfall = {
  get stats() {
    return loop.stats;
  },
  get ship() {
    return currentState;
  },
  setMode(next) {
    modeSelect.value = next;
    applyMode(next);
  },
};
