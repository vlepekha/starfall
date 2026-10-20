/**
 * Завантажувачі ассетів.
 *
 * Спільне для всіх трьох:
 *  - приймають AbortSignal і чесно його поважають;
 *  - повторюють спробу з експоненційною затримкою та джитером;
 *  - НЕ повторюють на 4xx: якщо сервер каже «такого файлу немає»,
 *    то й удесяте він скаже те саме, а користувач чекатиме дарма.
 */

/** Помилка з кодом відповіді — щоб вище можна було відрізнити 404 від обриву. */
export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} — ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

const isAbort = (error) => error?.name === "AbortError" || error?.name === "TimeoutError";

/**
 * Повторювати має сенс лише на тому, що може минути саме собою.
 *
 * 4xx — не може: «файлу немає» лишиться «файлу немає» і на десятій спробі,
 * а користувач просто чекатиме дарма.
 * Таймаут — може: повільна мережа часто відпускає.
 * AbortError від НАШОГО сигналу — це свідоме рішення вийти, не збій.
 */
function shouldRetry(error) {
  if (error?.name === "TimeoutError") return true;
  if (isAbort(error)) return false;
  if (error instanceof HttpError) return error.status >= 500;
  return true; // TypeError від fetch — обрив мережі
}

/**
 * Сигнал для ОДНІЄЇ спроби: наш сигнал скасування плюс власний таймаут.
 * Важливо, що таймаут створюється на кожну спробу заново — інакше
 * друга спроба стартувала б із уже вичерпаним лімітом часу.
 */
function attemptSignal({ signal, timeout } = {}) {
  if (!timeout) return signal;
  const timer = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

/**
 * Експоненційна затримка з джитером.
 *
 * Джитер потрібен не для краси: без нього всі клієнти, що впали разом,
 * повторять запит теж разом і покладуть сервер удруге. Випадковий
 * розкид у ±50% розводить їх у часі.
 */
export function backoffDelay(attempt, base = 220, cap = 4000) {
  const exponential = Math.min(cap, base * 2 ** attempt);
  const jitter = exponential * (Math.random() - 0.5);
  return Math.round(exponential + jitter);
}

export async function withRetry(task, { retries = 2, signal, onRetry } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) throw error;
      const delay = backoffDelay(attempt);
      onRetry?.({ attempt: attempt + 1, delay, error });
      await sleep(delay, signal);
    }
  }
  throw lastError;
}

/** Базовий fetch: єдине місце, де перевіряється response.ok. */
export async function fetchChecked(url, { signal } = {}) {
  const response = await fetch(url, { signal });
  // fetch НЕ кидає на 404 — він спокійно віддає ok: false.
  // Забути цю перевірку означає отримати «JSON parse error» замість «404».
  if (!response.ok) throw new HttpError(response.status, url);
  return response;
}

export async function fetchJson(url, options = {}) {
  const response = await fetchChecked(url, options);
  return response.json();
}

export function loadJson(url, options = {}) {
  return withRetry(() => fetchJson(url, { ...options, signal: attemptSignal(options) }), options);
}

/**
 * Картинка через fetch + createImageBitmap, а не через new Image().
 * Причина: <img> не вміє ні AbortSignal, ні повідомити код помилки —
 * у нього є лише подія error без деталей. А так 404 і обрив мережі
 * розрізняються, і скасування працює.
 */
export function loadImage(url, options = {}) {
  return withRetry(async () => {
    const response = await fetchChecked(url, { signal: attemptSignal(options) });
    const blob = await response.blob();
    return createImageBitmap(blob);
  }, options);
}

/**
 * Звук: завантажуємо байти зараз, декодуємо теж зараз.
 * decodeAudioData повертає проміс, тож декодування не блокує кадр.
 */
export function loadAudio(url, { audioContext, ...options } = {}) {
  return withRetry(async () => {
    const response = await fetchChecked(url, { signal: attemptSignal(options) });
    const bytes = await response.arrayBuffer();
    if (!audioContext) return bytes; // контексту ще немає — віддамо сирі байти
    return audioContext.decodeAudioData(bytes);
  }, options);
}
