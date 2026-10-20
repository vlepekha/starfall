import { activeFailure, corrupt } from "./failures.js";
import { loadAudio, loadImage, loadJson } from "./loaders.js";

/**
 * Завантаження всього, що описано в manifest.json.
 *
 * Ключове рішення — Promise.all, а не послідовні await. Браузер уміє
 * тримати кілька з'єднань одночасно; послідовний варіант просто чекає
 * по черзі й не використовує цю здатність. Різниця заміряна, див. README.
 */
/** Скільки чекати на один файл, перш ніж вважати мережу зависленою. */
export const ASSET_TIMEOUT = 2500;

export async function loadAll(
  manifest,
  { signal, onProgress, onRetry, audioContext, failure, timeout = ASSET_TIMEOUT } = {},
) {
  const mode = failure ?? activeFailure();
  const entries = describe(manifest);
  const progress = new Map(entries.map((entry) => [entry.id, 0]));

  const report = (id, value) => {
    progress.set(id, value);
    onProgress?.({
      id,
      value,
      done: [...progress.values()].filter((v) => v >= 1).length,
      total: entries.length,
      ratio: [...progress.values()].reduce((a, b) => a + b, 0) / entries.length,
    });
  };

  const tasks = entries.map(async (entry) => {
    const url = corrupt(entry.url, mode);
    report(entry.id, 0.05);
    const value = await entry.load(url, {
      signal,
      audioContext,
      timeout,
      onRetry: (info) => onRetry?.({ id: entry.id, ...info }),
    });
    report(entry.id, 1);
    return [entry.kind, entry.id, value, entry];
  });

  // Promise.all відхиляється на ПЕРШІЙ помилці, але решта запитів
  // продовжують летіти. Саме тому зовні стоїть AbortController:
  // після збою ми обриваємо все, що ще не встигло.
  const settled = await Promise.all(tasks);

  const images = new Map();
  const audio = new Map();
  const data = new Map();
  for (const [kind, id, value, entry] of settled) {
    if (kind === "image") images.set(id, { bitmap: value, ...entry.meta });
    else if (kind === "audio") audio.set(id, value);
    else data.set(id, value);
  }
  return { images, audio, data };
}

/** Той самий вантаж, але строго по черзі — існує заради заміру в README. */
export async function loadAllSequential(manifest, options = {}) {
  const entries = describe(manifest);
  const images = new Map();
  const audio = new Map();
  const data = new Map();
  for (const entry of entries) {
    const value = await entry.load(entry.url, options);
    if (entry.kind === "image") images.set(entry.id, { bitmap: value, ...entry.meta });
    else if (entry.kind === "audio") audio.set(entry.id, value);
    else data.set(entry.id, value);
  }
  return { images, audio, data };
}

function describe(manifest) {
  return [
    ...manifest.images.map((image) => ({
      kind: "image",
      id: image.id,
      url: image.url,
      meta: image,
      load: (url, options) => loadImage(url, options),
    })),
    ...manifest.audio.map((sound) => ({
      kind: "audio",
      id: sound.id,
      url: sound.url,
      meta: sound,
      load: (url, options) => loadAudio(url, options),
    })),
    ...manifest.data.map((item) => ({
      kind: "data",
      id: item.id,
      url: item.url,
      meta: item,
      load: (url, options) => loadJson(url, options),
    })),
  ];
}
