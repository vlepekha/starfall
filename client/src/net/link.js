/**
 * Штучні умови мережі: затримка, розкид і втрата пакетів.
 *
 * Локально все працює ідеально, і через це вся мережева частина
 * виглядає зайвою. Цей шар дозволяє побачити те, заради чого вона
 * написана: при 100 мс затримки різниця між «рухаюся одразу» і
 * «чекаю на знімок» помітна неозброєним оком.
 *
 * Працює в обидва боки: і на тому, що ми шлемо, і на тому, що приймаємо.
 */
export function createLink({ send, onMessage }) {
  const settings = { latencyMs: 0, jitterMs: 0, lossPercent: 0 };

  const delayOf = () => {
    if (settings.latencyMs <= 0 && settings.jitterMs <= 0) return 0;
    const jitter = (Math.random() * 2 - 1) * settings.jitterMs;
    return Math.max(0, settings.latencyMs + jitter);
  };

  const dropped = { out: 0, in: 0 };

  function schedule(fn) {
    const delay = delayOf();
    if (delay === 0) fn();
    else setTimeout(fn, delay);
  }

  return {
    settings,
    dropped,

    /** Надсилання «через мережу»: може спізнитися або зникнути зовсім. */
    send(frame) {
      if (Math.random() * 100 < settings.lossPercent) {
        dropped.out += 1;
        return;
      }
      schedule(() => send(frame));
    },

    /** Прийом: симетрично, бо затримка існує в обидва боки. */
    receive(message) {
      if (Math.random() * 100 < settings.lossPercent) {
        dropped.in += 1;
        return;
      }
      schedule(() => onMessage(message));
    },

    /** Повна затримка туди-назад для довідки в netgraph. */
    get roundTripMs() {
      return settings.latencyMs * 2;
    },
  };
}
