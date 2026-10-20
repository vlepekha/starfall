/**
 * Лобі: опитує /api/rooms, поки воно видиме.
 *
 * class Lobby extends EventTarget — так само, як DOM-елементи: хто хоче
 * знати про оновлення, підписується. Сам Lobby нічого не малює, у нього
 * немає жодного звернення до document; за DOM відповідає lobby-dom.js.
 */
import { fetchJson } from "../assets/loaders.js";

export class Lobby extends EventTarget {
  #timer = null;
  #controller = null;
  #interval;
  #timeout;
  #url;

  constructor({ url = "/api/rooms", interval = 4000, timeout = 2500 } = {}) {
    super();
    this.#url = url;
    this.#interval = interval;
    this.#timeout = timeout;
    this.rooms = [];
    this.status = "idle";
    this.error = null;
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Один запит. Власний таймаут на кожен — зависле з'єднання не вічне. */
  async refresh() {
    this.#controller?.abort();
    this.#controller = new AbortController();

    // Два сигнали разом: наш (вихід із лобі) і таймаут запиту.
    // AbortSignal.any гасить обидва випадки одним шляхом.
    const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(this.#timeout)]);

    this.status = "loading";
    this.#emit("status", { status: this.status });
    try {
      const payload = await fetchJson(this.#url, { signal });
      this.rooms = payload.rooms ?? [];
      this.status = "ready";
      this.error = null;
      this.#emit("rooms", { rooms: this.rooms, updatedAt: payload.updatedAt });
    } catch (error) {
      // Скасування — не помилка: так виглядає нормальний вихід із лобі.
      if (error.name === "AbortError") return;
      this.status = "error";
      this.error = error.name === "TimeoutError" ? "сервер не відповів вчасно" : error.message;
      this.#emit("error", { error: this.error });
    } finally {
      this.#emit("status", { status: this.status });
    }
  }

  start() {
    if (this.#timer) return;
    this.refresh();
    this.#timer = setInterval(() => this.refresh(), this.#interval);
  }

  /** Вихід із лобі: зупиняємо опитування й ОБРИВАЄМО запит, що летить. */
  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#controller?.abort();
    this.#controller = null;
    this.status = "idle";
  }

  join({ name, roomId }) {
    const room = this.rooms.find((r) => r.id === roomId) ?? null;
    this.stop();
    this.#emit("join", { name, room });
    return room;
  }
}
