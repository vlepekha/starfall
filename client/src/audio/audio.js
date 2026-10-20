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
export function createAudio({ bus, signal } = {}) {
  let context = null;
  let master = null;
  let muted = false;
  const buffers = new Map();
  const pendingBytes = new Map();

  /** Викликається з обробника кліку — інакше контекст лишиться suspended. */
  async function unlock() {
    if (context) {
      if (context.state === "suspended") await context.resume();
      return context;
    }
    context = new (window.AudioContext ?? window.webkitAudioContext)();
    master = context.createGain();
    master.gain.value = 0.35;
    master.connect(context.destination);

    // Усе, що приїхало до розблокування, декодуємо зараз — одним заходом.
    const decoding = [...pendingBytes].map(async ([id, bytes]) => {
      buffers.set(id, await context.decodeAudioData(bytes.slice(0)));
    });
    pendingBytes.clear();
    await Promise.all(decoding);
    return context;
  }

  /** Приймає або готовий AudioBuffer, або сирі байти (контексту ще не було). */
  function register(id, value) {
    if (value instanceof ArrayBuffer) pendingBytes.set(id, value);
    else buffers.set(id, value);
  }

  function play(id, { gain = 1, rate = 1 } = {}) {
    if (muted || !context || context.state !== "running") return false;
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
  bus?.on("exploded", ({ big } = {}) => play("explode", { gain: big ? 1 : 0.55 }), { signal });

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
