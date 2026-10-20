import { activeFailure, corrupt, type FailureMode } from "./failures.ts";
import { type LoadOptions, loadAudio, loadImage, loadJson } from "./loaders.ts";

export interface ImageEntry {
  id: string;
  url: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  originX: number;
  originY: number;
}

export interface Manifest {
  version: number;
  images: ImageEntry[];
  audio: { id: string; url: string }[];
  data: { id: string; url: string }[];
}

export interface LoadedImage extends ImageEntry {
  bitmap: ImageBitmap;
}

export interface Assets {
  images: Map<string, LoadedImage>;
  audio: Map<string, AudioBuffer | ArrayBuffer>;
  data: Map<string, unknown>;
}

export interface Progress {
  id: string;
  value: number;
  done: number;
  total: number;
  ratio: number;
}

export interface LoadAllOptions extends Omit<LoadOptions, "onRetry"> {
  onProgress?: (progress: Progress) => void;
  onRetry?: (info: { id: string; attempt: number; delay: number; error: unknown }) => void;
  failure?: FailureMode;
}

/**
 * Опис одного завантаження. Поле kind — дискримінант: саме по ньому
 * нижче розкладається результат, і компілятор стежить, щоб у Map
 * для картинок не потрапив AudioBuffer.
 */
type Describable =
  | { kind: "image"; id: string; url: string; meta: ImageEntry }
  | { kind: "audio"; id: string; url: string }
  | { kind: "data"; id: string; url: string };

/** Скільки чекати на один файл, перш ніж вважати мережу зависленою. */
export const ASSET_TIMEOUT = 2500;

function describe(manifest: Manifest): Describable[] {
  return [
    ...manifest.images.map(
      (meta): Describable => ({ kind: "image", id: meta.id, url: meta.url, meta }),
    ),
    ...manifest.audio.map((item): Describable => ({ kind: "audio", id: item.id, url: item.url })),
    ...manifest.data.map((item): Describable => ({ kind: "data", id: item.id, url: item.url })),
  ];
}

function emptyAssets(): Assets {
  return { images: new Map(), audio: new Map(), data: new Map() };
}

async function loadOne(
  entry: Describable,
  url: string,
  options: LoadOptions,
  assets: Assets,
): Promise<void> {
  switch (entry.kind) {
    case "image": {
      const bitmap = await loadImage(url, options);
      assets.images.set(entry.id, { ...entry.meta, bitmap });
      return;
    }
    case "audio": {
      assets.audio.set(entry.id, await loadAudio(url, options));
      return;
    }
    case "data": {
      assets.data.set(entry.id, await loadJson(url, options));
      return;
    }
  }
}

/**
 * Завантаження всього з manifest.json через Promise.all.
 *
 * Послідовний варіант нижче існує лише заради заміру в README:
 * він додає затримки одна до одної, паралельний — ні.
 */
export async function loadAll(
  manifest: Manifest,
  {
    signal,
    onProgress,
    onRetry,
    audioContext,
    failure,
    timeout = ASSET_TIMEOUT,
  }: LoadAllOptions = {},
): Promise<Assets> {
  const mode = failure ?? activeFailure();
  const entries = describe(manifest);
  const assets = emptyAssets();
  const progress = new Map<string, number>(entries.map((entry) => [entry.id, 0]));

  const report = (id: string, value: number): void => {
    progress.set(id, value);
    const values = [...progress.values()];
    onProgress?.({
      id,
      value,
      done: values.filter((v) => v >= 1).length,
      total: entries.length,
      ratio: values.reduce((a, b) => a + b, 0) / entries.length,
    });
  };

  const tasks = entries.map(async (entry) => {
    const url = corrupt(entry.url, mode);
    report(entry.id, 0.05);
    await loadOne(
      entry,
      url,
      {
        signal,
        audioContext,
        timeout,
        onRetry: (info) => onRetry?.({ id: entry.id, ...info }),
      },
      assets,
    );
    report(entry.id, 1);
  });

  // Promise.all відхиляється на ПЕРШІЙ помилці, але решта запитів
  // продовжують летіти — їх обриває AbortController зовні.
  await Promise.all(tasks);
  return assets;
}

/** Той самий вантаж, але строго по черзі — існує заради заміру. */
export async function loadAllSequential(
  manifest: Manifest,
  options: LoadOptions = {},
): Promise<Assets> {
  const assets = emptyAssets();
  for (const entry of describe(manifest)) {
    await loadOne(entry, entry.url, options, assets);
  }
  return assets;
}
