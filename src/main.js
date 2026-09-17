import "./style.css";
import { runBenchmark } from "./bench.js";
import { burnMilliseconds, EXPERIMENTS } from "./experiments.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createIntervalLoop, createVariableLoop } from "./loop-variants.js";
import { createRenderer } from "./render/draw.js";
import { createHud } from "./render/hud.js";
import { createGame } from "./sim/rules.js";
import { demonstrateThisBug } from "./this-demo.js";

const canvas = document.querySelector("#arena");
const hudRoot = document.querySelector("#hud");
const modeSelect = document.querySelector("#mode");
const blockInput = document.querySelector("#block-ms");
const noteEl = document.querySelector("#note");
const logEl = document.querySelector("#log");

const input = createInput();
const renderer = createRenderer(canvas);
const hud = createHud(hudRoot);
const game = createGame({ onEvent: logEvent });

/**
 * Корабель не знає про клавіатуру — йому підсовують функцію-джерело вводу.
 * Стрілка тут не випадкова: вона не має власного this, тому всередині
 * залишається this із цього модуля, а не з об'єкта, який її викликав.
 */
game.ship.controller = () => input.snapshot();

let loop = null;
let mode = "none";

function update(dt) {
  // Дія-подія: одне спрацювання на натискання, скільки б кроків клавішу
  // не тримали. Саме для цього в createInput є justPressed.
  if (input.justPressed("debug")) {
    const on = renderer.toggleVelocity();
    logEvent("debug", { text: `вектор швидкості ${on ? "увімкнено" : "вимкнено"}` });
  }

  game.step(dt);

  // «Свіжі» натискання живуть рівно один крок симуляції.
  input.endStep();
}

function render(alpha) {
  // Експеримент 1 з лаби 1: синхронна робота всередині кадру.
  if (mode === "block") {
    burnMilliseconds(Number(blockInput.value) || 0);
  }
  renderer.render(game.world, mode === "variable" ? 1 : alpha);
  hud.update(loop.stats, game, EXPERIMENTS[mode].label, performance.now());
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

/* ------------------------------------------------------------------ */
/*  Баг із this: кнопка «Fire» у шапці                                  */
/* ------------------------------------------------------------------ */

const fireButton = document.querySelector("#fire");
const brokenToggle = document.querySelector("#broken-this");

/**
 * НАВМИСНО зламаний варіант — рівно те, що хочеться написати першим:
 *
 *     fireButton.addEventListener("click", game.ship.fire);
 *
 * Метод відривається від об'єкта. При виклику слухача this буде кнопкою
 * (для addEventListener — currentTarget), а в модулях діє strict mode,
 * тож ніякої підміни на window не станеться. Звернення до приватного #hp
 * або до this.pos кине TypeError.
 */
const brokenFire = game.ship.fire;

/** Правильний варіант: стрілка бере this із замикання. */
const workingFire = () => game.ship.fire(game.world);

fireButton.addEventListener("click", (event) => {
  if (!brokenToggle.checked) {
    workingFire();
    return;
  }
  try {
    // Імітуємо саме той випадок: виклик без прив'язки до корабля.
    brokenFire.call(event.currentTarget, game.world);
    logEvent("this", { text: "несподівано спрацювало" });
  } catch (error) {
    logEvent("this-error", { text: `${error.constructor.name}: ${error.message}` });
  }
});

/* ------------------------------------------------------------------ */

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

document.querySelector("#reset").addEventListener("click", () => game.reset());

/** Стрічка подій під ареною: влучання, смерті, бонуси. */
function logEvent(type, payload = {}) {
  const text =
    {
      hit: () => `влучання, лишилось HP: ${payload.hp}`,
      death: () => "корабель знищено, респаун через 2 с",
      respawn: () => "респаун, 2 с невразливості",
      score: () => `+${payload.amount} очок`,
      pickup: () => `підібрано ${payload.label}`,
      shot: () => null,
      debug: () => payload.text,
      this: () => `this: ${payload.text}`,
      "this-error": () => `this зламався — ${payload.text}`,
    }[type]?.() ?? null;

  if (!text || !logEl) return;
  const line = document.createElement("li");
  line.textContent = text;
  if (type === "this-error") line.className = "is-bad";
  logEl.prepend(line);
  while (logEl.children.length > 6) logEl.lastChild.remove();
}

applyMode("none");

// Експеримент із this і ланцюжком прототипів — друкується в консоль при старті.
demonstrateThisBug(game.ship, game.world);

// Демонстрація порядку черг із лаби 1.
console.log("1 sync");
setTimeout(() => console.log("4 macrotask (setTimeout)"), 0);
queueMicrotask(() => console.log("3 microtask (queueMicrotask)"));
requestAnimationFrame(() => console.log("5 rAF (before paint)"));
Promise.resolve().then(() => console.log("3.1 microtask (Promise)"));
console.log("2 sync");

// Дебаг-хук: дозволяє знімати цифри й колупати світ прямо з консолі.
window.starfall = {
  get stats() {
    return loop.stats;
  },
  get ship() {
    return game.ship;
  },
  get world() {
    return game.world;
  },
  game,
  setMode(next) {
    modeSelect.value = next;
    applyMode(next);
  },
};
