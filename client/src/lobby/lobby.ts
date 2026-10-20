/**
 * Лобі: опитує /api/rooms, поки воно видиме.
 *
 * class Lobby extends EventTarget — так само, як DOM-елементи: хто хоче
 * знати про оновлення, підписується. Сам Lobby нічого не малює, у нього
 * немає жодного звернення до document; за DOM відповідає lobby-dom.js.
 */
import { fetchJson } from "../assets/loaders.ts";

export interface RoomInfo {
  id: string;
  name: string;
  arena: string;
  players: number;
  capacity: number;
}

interface RoomsPayload {
  rooms: RoomInfo[];
  updatedAt: string;
}

export class Lobby extends EventTarget {
  #timer: ReturnType<typeof setInterval> | null = null;
  #controller: AbortController | null = null;
  readonly #interval: number;
  readonly #timeout: number;
  readonly #url: string;

  rooms: RoomInfo[] = [];
  status: "idle" | "loading" | "ready" | "error" = "idle";
  error: string | null = null;

  constructor({
    url = "/api/rooms",
    interval = 4000,
    timeout = 2500,
  }: { url?: string; interval?: number; timeout?: number } = {}) {
    super();
    this.#url = url;
    this.#interval = interval;
    this.#timeout = timeout;
  }

  #emit(type: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Один запит. Власний таймаут на кожен — зависле з'єднання не вічне. */
  async refresh(): Promise<void> {
    this.#controller?.abort();
    this.#controller = new AbortController();

    // Два сигнали разом: наш (вихід із лобі) і таймаут запиту.
    // AbortSignal.any гасить обидва випадки одним шляхом.
    const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(this.#timeout)]);

    this.status = "loading";
    this.#emit("status", { status: this.status });
    try {
      const payload = await fetchJson<RoomsPayload>(this.#url, { signal });
      this.rooms = payload.rooms ?? [];
      this.status = "ready";
      this.error = null;
      this.#emit("rooms", { rooms: this.rooms, updatedAt: payload.updatedAt });
    } catch (error: unknown) {
      // Скасування — не помилка: так виглядає нормальний вихід із лобі.
      if (!(error instanceof Error)) throw error;
      if (error.name === "AbortError") return;
      this.status = "error";
      this.error = error.name === "TimeoutError" ? "сервер не відповів вчасно" : error.message;
      this.#emit("error", { error: this.error });
    } finally {
      this.#emit("status", { status: this.status });
    }
  }

  start(): void {
    if (this.#timer) return;
    this.refresh();
    this.#timer = setInterval(() => this.refresh(), this.#interval);
  }

  /** Вихід із лобі: зупиняємо опитування й ОБРИВАЄМО запит, що летить. */
  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#controller?.abort();
    this.#controller = null;
    this.status = "idle";
  }

  join({ name, roomId }: { name: string; roomId: string }): RoomInfo | null {
    const room = this.rooms.find((r) => r.id === roomId) ?? null;
    this.stop();
    this.#emit("join", { name, room });
    return room;
  }
}
