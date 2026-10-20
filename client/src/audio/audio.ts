/**
 * Звук через Web Audio.
 *
 * Два правила, які не обійти:
 *  1. AudioContext не запуститься без жесту користувача — браузери
 *     блокують автовідтворення. Тому створюємо його на першому кліку,
 *     а не на завантаженні сторінки.
 *  2. Декодування (decodeAudioData) — асинхронне й доволі важке, тож
 *     робимо його один раз на етапі завантаження, а не під час пострілу.
 *
 * Цей модуль підписується на шину подій. Симуляція про нього не знає.
 */
import type { GameBus } from "../bus.ts";

export interface AudioApi {
  unlock(): Promise<AudioContext>;
  register(id: string, value: AudioBuffer | ArrayBuffer): void;
  play(id: string, options?: { gain?: number; rate?: number }): boolean;
  readonly ready: boolean;
  readonly muted: boolean;
  toggleMute(): boolean;
}

export function createAudio({
  bus,
  signal,
}: {
  bus?: GameBus;
  signal?: AbortSignal;
} = {}): AudioApi {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  const buffers = new Map<string, AudioBuffer>();
  const pendingBytes = new Map<string, ArrayBuffer>();

  /** Викликається з обробника кліку — інакше контекст лишиться suspended. */
  async function unlock(): Promise<AudioContext> {
    if (context) {
      if (context.state === "suspended") await context.resume();
      return context;
    }
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.35;
    master.connect(context.destination);

    // Усе, що приїхало до розблокування, декодуємо зараз — одним заходом.
    const ctx = context;
    const decoding = [...pendingBytes].map(async ([id, bytes]) => {
      buffers.set(id, await ctx.decodeAudioData(bytes.slice(0)));
    });
    pendingBytes.clear();
    await Promise.all(decoding);
    return context;
  }

  /** Приймає або готовий AudioBuffer, або сирі байти (контексту ще не було). */
  function register(id: string, value: AudioBuffer | ArrayBuffer): void {
    if (value instanceof ArrayBuffer) pendingBytes.set(id, value);
    else buffers.set(id, value);
  }

  function play(
    id: string,
    { gain = 1, rate = 1 }: { gain?: number; rate?: number } = {},
  ): boolean {
    if (muted || !context || !master || context.state !== "running") return false;
    const buffer = buffers.get(id);
    if (!buffer) return false;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const node = context.createGain();
    node.gain.value = gain;
    source.connect(node).connect(master);
    source.start();
    return true;
  }

  // Підписки на шину. signal дозволяє зняти їх усі одним abort().
  bus?.on("fired", () => play("fire", { rate: 0.95 + Math.random() * 0.12 }), { signal });
  bus?.on("hit", () => play("hit"), { signal });
  /** Вибухи бувають великі й малі — читаємо прапорець без приведення типу. */
  const isBig = (detail: unknown): boolean =>
    typeof detail === "object" && detail !== null && Reflect.get(detail, "big") === true;

  bus?.on("exploded", (detail) => play("explode", { gain: isBig(detail) ? 1 : 0.55 }), {
    signal,
  });

  return {
    unlock,
    register,
    play,
    get ready() {
      return context?.state === "running";
    },
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.35;
      return muted;
    },
  };
}
