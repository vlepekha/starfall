import "./style.css";
import { type ArenaConfig, createGame, type Game } from "@starfall/shared";
import { activeFailure, FAILURES } from "./assets/failures.ts";
import { type Assets, loadAll, type Manifest } from "./assets/load-all.ts";
import { loadJson } from "./assets/loaders.ts";
import { createAudio } from "./audio/audio.ts";
import { runBenchmark } from "./bench.ts";
import { GameBus } from "./bus.ts";
import { button, canvas as canvasEl, el, input as inputEl, select } from "./dom.ts";
import { onCustom } from "./events.ts";
import {
  burnMilliseconds,
  EXPERIMENT_MODES,
  EXPERIMENTS,
  type ExperimentMode,
} from "./experiments.ts";
import { createInput } from "./input.ts";
import { createChatView } from "./lobby/chat.ts";
import { Lobby, type RoomInfo } from "./lobby/lobby.ts";
import { createLobbyView } from "./lobby/lobby-dom.ts";
import { createLoop, type Loop, type LoopStats } from "./loop.ts";
import { createIntervalLoop, createVariableLoop } from "./loop-variants.ts";
import { createLink, type LinkSettings } from "./net/link.ts";
import { createNetcode } from "./net/netcode.ts";
import { GameSocket } from "./net/socket.ts";
import { runPuzzles } from "./puzzles.ts";
import { createRenderer } from "./render/draw.ts";
import { createHud } from "./render/hud.ts";
import { createLoadingScreen, type LoadingState } from "./render/loading.ts";
import { createNetgraph } from "./render/netgraph.ts";
import { demonstrateThisBug } from "./this-demo.ts";

const canvas = canvasEl("#arena");
const hudRoot = el("#hud");
const modeSelect = select("#mode");
const blockInput = inputEl("#block-ms");
const noteEl = el("#note");
const logEl = el("#log");
const lobbyRoot = el("#lobby");
const chatRoot = el("#chat");
const retryButton = button("#retry");
const soundButton = button("#sound");
const stageEl = el(".stage");
const netgraphRoot = el("#netgraph");
const netControls = el("#net-controls");

const bus = new GameBus();
const socket = new GameSocket();
const chat = createChatView(chatRoot, socket);

/**
 * Поточна сесія гравця. Потрібна саме для перепідключення: сокет може
 * відкритися заново будь-коли, і щоразу треба відрекомендуватися знову —
 * сервер після розриву про нас нічого не пам'ятає.
 */
let session: { room: string; name: string } | null = null;

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
onCustom<{ data: ArrayBuffer | string; isBinary: boolean }>(socket, "raw", (detail) => {
  link.receive(detail);
});

onCustom<{ state: string }>(socket, "state", ({ state }) => {
  if (state === "open" && session) socket.send("join", session);
});

// Сервер надіслав підтвердження входу — звідси беремо seed і id корабля.
onCustom<{ you: { shipId: number }; net?: { seed: number; proto: string } }>(
  socket,
  "joined",
  ({ you, net }) => {
    netcode.reset(net?.seed ?? 1, you.shipId);
    netcode.stats.proto = net?.proto ?? "binary";
  },
);
const input = createInput();
const audio = createAudio({ bus });
const loading = createLoadingScreen(canvas);

let assets: Assets | null = null;
let renderer: ReturnType<typeof createRenderer> | null = null;
let hud: ReturnType<typeof createHud> | null = null;
let game: Game | null = null;
let loop: Loop | null = null;
let mode: ExperimentMode = "none";

/* ------------------------------------------------------------------ */
/*  Крок 1. Завантаження ассетів                                        */
/* ------------------------------------------------------------------ */

let loadController: AbortController | null = null;

async function loadAssets(): Promise<boolean> {
  loadController?.abort();
  loadController = new AbortController();
  const signal = loadController.signal;
  const failure = activeFailure();

  const items = new Map<string, number>();
  const draw = (extra: LoadingState = {}): void =>
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
    const manifest = await loadJson<Manifest>("/assets/manifest.json", { signal, timeout: 2500 });
    for (const entry of [...manifest.images, ...manifest.audio, ...manifest.data]) {
      items.set(entry.id, 0);
    }
    draw({ ratio: 0, label: "завантаження…" });

    // Збій «гравець пішов»: обриваємо завантаження посеред процесу.
    const controller = loadController;
    if (failure === "abort") {
      setTimeout(() => controller.abort(new DOMException("Користувач вийшов", "AbortError")), 350);
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
  } catch (error: unknown) {
    // Жоден збій не має вбивати сторінку: показуємо причину й кнопку Retry.
    const name = error instanceof Error ? error.name : "";
    const reason =
      name === "AbortError"
        ? "завантаження перервано"
        : name === "TimeoutError"
          ? "сервер не відповів"
          : error instanceof Error
            ? error.message
            : String(error);
    draw({ ratio: 0, error: reason });
    logEvent("load-error", { text: reason });
    retryButton.hidden = false;
    // Усе, що ще летить після першої помилки, більше не потрібне.
    loadController?.abort();
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Крок 2. Лобі                                                        */
/* ------------------------------------------------------------------ */

const lobby = new Lobby();
const lobbyView = createLobbyView(lobbyRoot, lobby, { onJoin: startGame });

function showLobby(): void {
  stageEl.hidden = true;
  lobbyView.show();
  lobby.start();
}

/* ------------------------------------------------------------------ */
/*  Крок 3. Гра                                                         */
/* ------------------------------------------------------------------ */

/**
 * Звуження даних із JSON без приведення типу: перевіряємо кожне поле,
 * яке збираємося взяти. Типи тут не допоможуть — файл міг бути яким завгодно.
 */
function asArenaConfig(value: unknown): Partial<ArenaConfig> {
  if (typeof value !== "object" || value === null) return {};
  const out: Partial<ArenaConfig> = {};
  const limit = Reflect.get(value, "asteroidLimit");
  const pickups = Reflect.get(value, "pickupLimit");
  if (typeof limit === "number") out.asteroidLimit = limit;
  if (typeof pickups === "number") out.pickupLimit = pickups;
  return out;
}

const ARENA_PRESETS: Record<string, Partial<ArenaConfig>> = {
  classic: {},
  dense: { asteroidLimit: 18, asteroidInterval: [1.2, 2.4] },
  sparse: { asteroidLimit: 6, asteroidInterval: [4, 7], pickupInterval: [6, 10] },
};

async function startGame({ name, room }: { name: string; room: RoomInfo | null }): Promise<void> {
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

  /**
   * `assets.data` типізований як Map<string, unknown> — і це не причіпка:
   * у JSON із мережі може бути що завгодно. Тому форму перевіряємо тут,
   * а не сподіваємося на неї.
   */
  const fromFile = asArenaConfig(assets?.data.get("arena"));
  const preset = room?.arena ? (ARENA_PRESETS[room.arena] ?? {}) : {};
  const config: Partial<ArenaConfig> = { ...fromFile, ...preset };
  // Локальний game лишається лише як джерело HUD-статистики: саму гру
  // тепер рахує сервер.
  game = createGame({
    bus,
    config,
    onEvent: (type, payload) =>
      logEvent(type, typeof payload === "object" && payload !== null ? { ...payload } : {}),
  });
  netControls.hidden = false;
  netgraphRoot.hidden = false;

  renderer = createRenderer(canvas, { assets: assets ?? undefined });
  hud = createHud(hudRoot);
  logEvent("joined", { text: `${name} → ${room?.name ?? "локальна арена"}` });
  if (!game) return;

  applyMode("none");
  demonstrateThisBug(game.ship, game.world);
}

function update(dt: number): void {
  if (!renderer) return;
  if (input.justPressed("debug")) {
    const on = renderer.toggleVelocity();
    logEvent("debug", { text: `вектор швидкості ${on ? "увімкнено" : "вимкнено"}` });
  }

  // Світ рахує сервер. Локально ми лише передбачаємо свій корабель
  // і свої кулі — решта приходить знімками.
  netcode.update(dt);
  input.endStep();
}

function render(alpha: number): void {
  if (!renderer || !hud || !loop || !game) return;
  if (mode === "block") burnMilliseconds(Number(blockInput.value) || 0);
  const view = netcode.buildView();
  renderer.render(view, mode === "variable" ? 1 : alpha);
  hud.update(loop.stats, game, EXPERIMENTS[mode].label, performance.now());
  netgraph.update(netcode.stats, performance.now());
}

function buildLoop(): Loop {
  if (mode === "interval")
    return createIntervalLoop({ update, render, stepHz: 60, intervalMs: 16 });
  if (mode === "variable") return createVariableLoop({ update, render });
  return createLoop({ update, render, stepHz: 60 });
}

function applyMode(next: ExperimentMode): void {
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
modeSelect.addEventListener("change", () => {
  // Значення <select> — рядок; перевіряємо, що це справді відомий режим.
  const next = EXPERIMENT_MODES.find((candidate) => candidate === modeSelect.value);
  if (next) applyMode(next);
});

const fireButton = button("#fire");
const brokenToggle = inputEl("#broken-this");

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
  } catch (error: unknown) {
    const name = error instanceof Error ? error.constructor.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    logEvent("this-error", { text: `${name}: ${message}` });
  }
});

retryButton.addEventListener("click", async () => {
  if (await loadAssets()) showLobby();
});

soundButton.addEventListener("click", () => {
  soundButton.textContent = audio.toggleMute() ? "Sound off" : "Sound on";
});

const benchButton = button("#bench");

const EMPTY_LOOP_STATS: LoopStats = {
  stepsPerSecond: 0,
  framesPerSecond: 0,
  frameTimeMs: 0,
  longestFrameMs: 0,
  accumulatorMs: 0,
  panics: 0,
};

async function startBenchmark(): Promise<unknown> {
  benchButton.disabled = true;
  modeSelect.disabled = true;
  const result = await runBenchmark({
    setMode: (next) => {
      modeSelect.value = next;
      applyMode(next);
    },
    getStats: () => loop?.stats ?? EMPTY_LOOP_STATS,
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

button("#reset").addEventListener("click", () => game?.reset());

/* ------------------------------------------------------------------ */
/*  Керування умовами мережі                                            */
/* ------------------------------------------------------------------ */

const sliders: ReadonlyArray<
  readonly [string, string, keyof LinkSettings, (value: string) => string]
> = [
  ["#net-latency", "#net-latency-out", "latencyMs", (v) => `${v} мс`],
  ["#net-jitter", "#net-jitter-out", "jitterMs", (v) => `${v} мс`],
  ["#net-loss", "#net-loss-out", "lossPercent", (v) => `${v} %`],
];

for (const [inputSelector, outputSelector, key, format] of sliders) {
  const slider = inputEl(inputSelector);
  const out = el(outputSelector);
  const apply = (): void => {
    link.settings[key] = Number(slider.value);
    out.textContent = format(slider.value);
  };
  slider.addEventListener("input", apply);
  apply();
}

const predictToggle = inputEl("#net-predict");
predictToggle.addEventListener("change", () => {
  const checked = predictToggle.checked;
  netcode.options.predict = checked;
  logEvent("net", {
    text: checked
      ? "передбачення увімкнено — корабель рухається одразу"
      : "передбачення вимкнено — корабель рухається лише після знімка",
  });
});

const desyncToggle = inputEl("#net-desync");
desyncToggle.addEventListener("change", () => {
  const checked = desyncToggle.checked;
  netcode.options.desync = checked;
  logEvent("net", {
    text: checked
      ? "у крок додано Math.random() — дивіться, як росте поправка"
      : "випадковість прибрано, поправка має впасти",
  });
});

button("#net-cheat").addEventListener("click", () => {
  const decoded = netcode.tryCheat();
  logEvent("net", {
    text: `надіслано input seq=${decoded?.seq ?? "?"} — сервер приймає лише наміри, координат у протоколі немає`,
  });
});

// Вихід із кімнати: закриваємо сокет і повертаємось у лобі.
button("#leave").addEventListener("click", () => {
  session = null;
  socket.close(1000, "leave");
  chat.hide();
  loop?.stop();
  stageEl.hidden = true;
  showLobby();
});

/** Стрічка подій під ареною. */
function logEvent(type: string, payload: Record<string, unknown> = {}): void {
  const messages: Record<string, () => string | null> = {
    hit: () => `влучання, лишилось HP: ${String(payload.hp)}`,
    death: () => "корабель знищено, респаун через 2 с",
    respawn: () => "респаун, 2 с невразливості",
    score: () => `+${String(payload.amount)} очок`,
    pickup: () => `підібрано ${String(payload.label)}`,
    joined: () => String(payload.text),
    debug: () => String(payload.text),
    this: () => `this: ${String(payload.text)}`,
    "this-error": () => `this зламався — ${String(payload.text)}`,
    "load-error": () => `завантаження: ${String(payload.text)}`,
    "load-retry": () => `повтор ${String(payload.text)}`,
    net: () => String(payload.text),
    fired: () => null,
    exploded: () => null,
  };
  const text = messages[type]?.() ?? null;

  if (!text || !logEl) return;
  const line = document.createElement("li");
  line.textContent = text;
  if (type === "this-error" || type === "load-error") line.className = "is-bad";
  logEl.prepend(line);
  while (logEl.children.length > 6) logEl.lastChild?.remove();
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

/**
 * Дебаг-хук для замірів із консолі.
 * Оголошення нижче додає його до типу window — інакше tsc правильно
 * заперечить, що такої властивості не існує.
 */
declare global {
  interface Window {
    starfall: Record<string, unknown>;
  }
}

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
  setMode(next: ExperimentMode) {
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
