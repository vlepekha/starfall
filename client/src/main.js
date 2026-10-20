import "./style.css";
import { createGame } from "@starfall/shared";
import { activeFailure, FAILURES } from "./assets/failures.js";
import { loadAll } from "./assets/load-all.js";
import { loadJson } from "./assets/loaders.js";
import { createAudio } from "./audio/audio.js";
import { runBenchmark } from "./bench.js";
import { GameBus } from "./bus.js";
import { burnMilliseconds, EXPERIMENTS } from "./experiments.js";
import { createInput } from "./input.js";
import { createChatView } from "./lobby/chat.js";
import { Lobby } from "./lobby/lobby.js";
import { createLobbyView } from "./lobby/lobby-dom.js";
import { createLoop } from "./loop.js";
import { createIntervalLoop, createVariableLoop } from "./loop-variants.js";
import { createLink } from "./net/link.js";
import { createNetcode } from "./net/netcode.js";
import { GameSocket } from "./net/socket.js";
import { runPuzzles } from "./puzzles.js";
import { createRenderer } from "./render/draw.js";
import { createHud } from "./render/hud.js";
import { createLoadingScreen } from "./render/loading.js";
import { createNetgraph } from "./render/netgraph.js";
import { demonstrateThisBug } from "./this-demo.js";

const canvas = document.querySelector("#arena");
const hudRoot = document.querySelector("#hud");
const modeSelect = document.querySelector("#mode");
const blockInput = document.querySelector("#block-ms");
const noteEl = document.querySelector("#note");
const logEl = document.querySelector("#log");
const lobbyRoot = document.querySelector("#lobby");
const chatRoot = document.querySelector("#chat");
const retryButton = document.querySelector("#retry");
const soundButton = document.querySelector("#sound");
const stageEl = document.querySelector(".stage");
const netgraphRoot = document.querySelector("#netgraph");
const netControls = document.querySelector("#net-controls");

const bus = new GameBus();
const socket = new GameSocket();
const chat = createChatView(chatRoot, socket);

/**
 * Поточна сесія гравця. Потрібна саме для перепідключення: сокет може
 * відкритися заново будь-коли, і щоразу треба відрекомендуватися знову —
 * сервер після розриву про нас нічого не пам'ятає.
 */
let session = null;

/* ------------------------------------------------------------------ */
/*  Мережа: канал з умовами, netcode, netgraph                          */
/* ------------------------------------------------------------------ */

const link = createLink({
  send: (frame) => socket.sendRaw(frame),
  onMessage: ({ data, isBinary }) => netcode.onFrame(data, { isBinary }),
});

const netcode = createNetcode({ link, getInput: () => input.snapshot() });
const netgraph = createNetgraph(netgraphRoot);

// Сирі кадри (бінарні знімки) не проходять через JSON-розбір у GameSocket —
// вони одразу йдуть у канал із затримкою, а звідти в netcode.
socket.addEventListener("raw", (event) => link.receive(event.detail));

socket.addEventListener("state", (event) => {
  if (event.detail.state === "open" && session) socket.send("join", session);
});

// Сервер надіслав підтвердження входу — звідси беремо seed і id корабля.
socket.addEventListener("joined", (event) => {
  const { you, net } = event.detail;
  netcode.reset(net?.seed ?? 1, you.shipId);
  netcode.stats.proto = net?.proto ?? "binary";
});
const input = createInput();
const audio = createAudio({ bus });
const loading = createLoadingScreen(canvas);

let assets = null;
let renderer = null;
let hud = null;
let game = null;
let loop = null;
let mode = "none";

/* ------------------------------------------------------------------ */
/*  Крок 1. Завантаження ассетів                                        */
/* ------------------------------------------------------------------ */

let loadController = null;

async function loadAssets() {
  loadController?.abort();
  loadController = new AbortController();
  const signal = loadController.signal;
  const failure = activeFailure();

  const items = new Map();
  const draw = (extra = {}) =>
    loading.draw({
      items: [...items.entries()].map(([id, value]) => ({ id, value })),
      ...extra,
    });

  retryButton.hidden = true;
  draw({
    ratio: 0,
    label: failure === "none" ? "завантаження…" : `режим збою: ${FAILURES[failure]}`,
  });

  try {
    const manifest = await loadJson("/assets/manifest.json", { signal, timeout: 2500 });
    for (const entry of [...manifest.images, ...manifest.audio, ...manifest.data]) {
      items.set(entry.id, 0);
    }
    draw({ ratio: 0, label: "завантаження…" });

    // Збій «гравець пішов»: обриваємо завантаження посеред процесу.
    if (failure === "abort") {
      setTimeout(
        () => loadController.abort(new DOMException("Користувач вийшов", "AbortError")),
        350,
      );
    }

    assets = await loadAll(manifest, {
      signal,
      onProgress: ({ id, value, ratio, done, total }) => {
        items.set(id, value);
        draw({ ratio, label: `${done}/${total} файлів` });
      },
      onRetry: ({ id, attempt, delay }) => {
        draw({ ratio: 0, label: `повтор ${id}: спроба ${attempt} через ${delay} мс` });
        logEvent("load-retry", { text: `${id}: спроба ${attempt} через ${delay} мс` });
      },
    });

    for (const [id, value] of assets.audio) audio.register(id, value);
    draw({ ratio: 1, label: "готово" });
    return true;
  } catch (error) {
    // Жоден збій не має вбивати сторінку: показуємо причину й кнопку Retry.
    const reason =
      error.name === "AbortError"
        ? "завантаження перервано"
        : error.name === "TimeoutError"
          ? "сервер не відповів"
          : error.message;
    draw({ ratio: 0, error: reason });
    logEvent("load-error", { text: reason });
    retryButton.hidden = false;
    // Усе, що ще летить після першої помилки, більше не потрібне.
    loadController.abort();
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Крок 2. Лобі                                                        */
/* ------------------------------------------------------------------ */

const lobby = new Lobby();
const lobbyView = createLobbyView(lobbyRoot, lobby, { onJoin: startGame });

function showLobby() {
  stageEl.hidden = true;
  lobbyView.show();
  lobby.start();
}

/* ------------------------------------------------------------------ */
/*  Крок 3. Гра                                                         */
/* ------------------------------------------------------------------ */

const ARENA_PRESETS = {
  classic: {},
  dense: { asteroidLimit: 18, asteroidInterval: [1.2, 2.4] },
  sparse: { asteroidLimit: 6, asteroidInterval: [4, 7], pickupInterval: [6, 10] },
};

async function startGame({ name, room }) {
  lobbyView.hide();
  stageEl.hidden = false;
  chat.show();

  // Мережа. join НЕ надсилається тут напряму: ним займається обробник
  // відкриття нижче. Інакше після перепідключення сокет був би відкритий,
  // але сервер не знав би, хто ми, і через 5 с закрив би з'єднання
  // з кодом 4004 (join timeout) — рівно це й сталося при першій перевірці.
  session = { room: room?.id ?? "local", name };
  socket.connect();
  if (socket.state === "open") socket.send("join", session);

  // Клік по Join — це жест користувача, єдиний момент, коли браузер
  // дозволить запустити AudioContext. Пізніше такої нагоди не буде.
  await audio.unlock();
  soundButton.hidden = false;
  soundButton.textContent = audio.muted ? "Sound off" : "Sound on";

  const config = { ...assets.data.get("arena"), ...(ARENA_PRESETS[room?.arena] ?? {}) };
  // Локальний game лишається лише як джерело HUD-статистики: саму гру
  // тепер рахує сервер.
  game = createGame({ bus, config, onEvent: logEvent });
  netControls.hidden = false;
  netgraphRoot.hidden = false;

  renderer = createRenderer(canvas, { assets });
  hud = createHud(hudRoot);
  logEvent("joined", { text: `${name} → ${room?.name ?? "локальна арена"}` });

  applyMode("none");
  demonstrateThisBug(game.ship, game.world);
}

function update(dt) {
  if (input.justPressed("debug")) {
    const on = renderer.toggleVelocity();
    logEvent("debug", { text: `вектор швидкості ${on ? "увімкнено" : "вимкнено"}` });
  }

  // Світ рахує сервер. Локально ми лише передбачаємо свій корабель
  // і свої кулі — решта приходить знімками.
  netcode.update(dt);
  input.endStep();
}

function render(alpha) {
  if (mode === "block") burnMilliseconds(Number(blockInput.value) || 0);
  const view = netcode.buildView();
  renderer.render(view, mode === "variable" ? 1 : alpha);
  hud.update(loop.stats, game, EXPERIMENTS[mode].label, performance.now());
  netgraph.update(netcode.stats, performance.now());
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

/* ------------------------------------------------------------------ */
/*  Інтерфейс                                                           */
/* ------------------------------------------------------------------ */

for (const [value, meta] of Object.entries(EXPERIMENTS)) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = meta.label;
  modeSelect.appendChild(option);
}
modeSelect.value = "none";
modeSelect.addEventListener("change", (event) => applyMode(event.target.value));

const fireButton = document.querySelector("#fire");
const brokenToggle = document.querySelector("#broken-this");

/**
 * НАВМИСНО зламаний варіант — рівно те, що хочеться написати першим:
 *     fireButton.addEventListener("click", game.ship.fire);
 * Метод відривається від об'єкта, і this стає кнопкою. Деталі — у README.
 */
fireButton.addEventListener("click", (event) => {
  if (!game) return;
  if (!brokenToggle.checked) {
    game.ship.fire(game.world);
    return;
  }
  try {
    const brokenFire = game.ship.fire;
    brokenFire.call(event.currentTarget, game.world);
    logEvent("this", { text: "несподівано спрацювало" });
  } catch (error) {
    logEvent("this-error", { text: `${error.constructor.name}: ${error.message}` });
  }
});

retryButton.addEventListener("click", async () => {
  if (await loadAssets()) showLobby();
});

soundButton.addEventListener("click", () => {
  soundButton.textContent = audio.toggleMute() ? "Sound off" : "Sound on";
});

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

if (new URLSearchParams(window.location.search).has("bench")) {
  window.addEventListener("load", () => {
    startBenchmark().then(() => {
      document.title = `BENCH DONE — ${document.title}`;
    });
  });
}

document.querySelector("#reset").addEventListener("click", () => game?.reset());

/* ------------------------------------------------------------------ */
/*  Керування умовами мережі                                            */
/* ------------------------------------------------------------------ */

const sliders = [
  ["#net-latency", "#net-latency-out", "latencyMs", (v) => `${v} мс`],
  ["#net-jitter", "#net-jitter-out", "jitterMs", (v) => `${v} мс`],
  ["#net-loss", "#net-loss-out", "lossPercent", (v) => `${v} %`],
];

for (const [inputSelector, outputSelector, key, format] of sliders) {
  const el = document.querySelector(inputSelector);
  const out = document.querySelector(outputSelector);
  const apply = () => {
    link.settings[key] = Number(el.value);
    out.textContent = format(el.value);
  };
  el.addEventListener("input", apply);
  apply();
}

document.querySelector("#net-predict").addEventListener("change", (event) => {
  netcode.options.predict = event.target.checked;
  logEvent("net", {
    text: event.target.checked
      ? "передбачення увімкнено — корабель рухається одразу"
      : "передбачення вимкнено — корабель рухається лише після знімка",
  });
});

document.querySelector("#net-desync").addEventListener("change", (event) => {
  netcode.options.desync = event.target.checked;
  logEvent("net", {
    text: event.target.checked
      ? "у крок додано Math.random() — дивіться, як росте поправка"
      : "випадковість прибрано, поправка має впасти",
  });
});

document.querySelector("#net-cheat").addEventListener("click", () => {
  const decoded = netcode.tryCheat();
  logEvent("net", {
    text: `надіслано input seq=${decoded.seq} — сервер приймає лише наміри, координат у протоколі немає`,
  });
});

// Вихід із кімнати: закриваємо сокет і повертаємось у лобі.
document.querySelector("#leave").addEventListener("click", () => {
  session = null;
  socket.close(1000, "leave");
  chat.hide();
  loop?.stop();
  stageEl.hidden = true;
  showLobby();
});

/** Стрічка подій під ареною. */
function logEvent(type, payload = {}) {
  const text =
    {
      hit: () => `влучання, лишилось HP: ${payload.hp}`,
      death: () => "корабель знищено, респаун через 2 с",
      respawn: () => "респаун, 2 с невразливості",
      score: () => `+${payload.amount} очок`,
      pickup: () => `підібрано ${payload.label}`,
      joined: () => payload.text,
      debug: () => payload.text,
      this: () => `this: ${payload.text}`,
      "this-error": () => `this зламався — ${payload.text}`,
      "load-error": () => `завантаження: ${payload.text}`,
      "load-retry": () => `повтор ${payload.text}`,
      net: () => payload.text,
      fired: () => null,
      exploded: () => null,
    }[type]?.() ?? null;

  if (!text || !logEl) return;
  const line = document.createElement("li");
  line.textContent = text;
  if (type === "this-error" || type === "load-error") line.className = "is-bad";
  logEl.prepend(line);
  while (logEl.children.length > 6) logEl.lastChild.remove();
}

/* ------------------------------------------------------------------ */
/*  Старт                                                               */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(window.location.search);

if (params.has("puzzles")) {
  runPuzzles();
} else {
  // Гра стартує ЛИШЕ після того, як усе завантажено.
  stageEl.hidden = false;
  lobbyView.hide();
  loadAssets().then((ok) => {
    if (ok) showLobby();
  });
}

// Дебаг-хук для замірів із консолі.
window.starfall = {
  get stats() {
    return loop?.stats;
  },
  get ship() {
    return game?.ship;
  },
  get world() {
    return game?.world;
  },
  get assets() {
    return assets;
  },
  bus,
  audio,
  lobby,
  netcode,
  link,
  get game() {
    return game;
  },
  setMode(next) {
    modeSelect.value = next;
    applyMode(next);
  },
  /**
   * Намалювати один кадр уручну. Потрібно для запису GIF: у фоновій
   * вкладці браузер тротлить requestAnimationFrame, і цикл стоїть.
   */
  renderFrame() {
    if (!renderer || !game) return false;
    render(1);
    return true;
  },
};
