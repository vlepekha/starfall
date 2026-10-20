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
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`HTTP ${status} — ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
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

/**
 * Перевірка «це скасування?» на unknown.
 *
 * Раніше було `error?.name === "AbortError"` — і воно мовчки працювало,
 * доки у catch не прилітало щось без поля name. Тепер компілятор
 * вимагає спершу довести, що це Error.
 */
const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

/**
 * Повторювати має сенс лише на тому, що може минути саме собою.
 *
 * 4xx — не може: «файлу немає» лишиться «файлу немає» і на десятій спробі,
 * а користувач просто чекатиме дарма.
 * Таймаут — може: повільна мережа часто відпускає.
 * AbortError від НАШОГО сигналу — це свідоме рішення вийти, не збій.
 */
function shouldRetry(error: unknown): boolean {
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (isAbort(error)) return false;
  if (error instanceof HttpError) return error.status >= 500;
  return true; // TypeError від fetch — обрив мережі
}

/**
 * Сигнал для ОДНІЄЇ спроби: наш сигнал скасування плюс власний таймаут.
 * Важливо, що таймаут створюється на кожну спробу заново — інакше
 * друга спроба стартувала б із уже вичерпаним лімітом часу.
 */
function attemptSignal({ signal, timeout }: LoadOptions = {}): AbortSignal | undefined {
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
export function backoffDelay(attempt: number, base = 220, cap = 4000): number {
  const exponential = Math.min(cap, base * 2 ** attempt);
  const jitter = exponential * (Math.random() - 0.5);
  return Math.round(exponential + jitter);
}

export interface LoadOptions {
  signal?: AbortSignal;
  timeout?: number;
  retries?: number;
  audioContext?: AudioContext;
  onRetry?: (info: { attempt: number; delay: number; error: unknown }) => void;
}

export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  { retries = 2, signal, onRetry }: LoadOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error: unknown) {
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
export async function fetchChecked(url: string, { signal }: LoadOptions = {}): Promise<Response> {
  const response = await fetch(url, { signal });
  // fetch НЕ кидає на 404 — він спокійно віддає ok: false.
  // Забути цю перевірку означає отримати «JSON parse error» замість «404».
  if (!response.ok) throw new HttpError(response.status, url);
  return response;
}

export async function fetchJson<T = unknown>(url: string, options: LoadOptions = {}): Promise<T> {
  const response = await fetchChecked(url, options);
  // response.json() повертає any — типізована змінна робить те саме, що й as.
  const data: T = await response.json();
  return data;
}

export function loadJson<T = unknown>(url: string, options: LoadOptions = {}): Promise<T> {
  return withRetry(() => fetchJson(url, { ...options, signal: attemptSignal(options) }), options);
}

/**
 * Картинка через fetch + createImageBitmap, а не через new Image().
 * Причина: <img> не вміє ні AbortSignal, ні повідомити код помилки —
 * у нього є лише подія error без деталей. А так 404 і обрив мережі
 * розрізняються, і скасування працює.
 */
export function loadImage(url: string, options: LoadOptions = {}): Promise<ImageBitmap> {
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
export function loadAudio(
  url: string,
  { audioContext, ...options }: LoadOptions = {},
): Promise<AudioBuffer | ArrayBuffer> {
  return withRetry(async () => {
    const response = await fetchChecked(url, { signal: attemptSignal(options) });
    const bytes = await response.arrayBuffer();
    if (!audioContext) return bytes; // контексту ще немає — віддамо сирі байти
    return audioContext.decodeAudioData(bytes);
  }, options);
}
