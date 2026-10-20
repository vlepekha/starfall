/**
 * Обгортка над WebSocket: черга надсилання та перепідключення.
 *
 * Голий WebSocket незручний рівно двома речами:
 *  1. send() кидає помилку, якщо сокет ще не відкрився — а відкривається
 *     він асинхронно, тож перше ж повідомлення після connect() часто падає;
 *  2. при обриві з'єднання він просто помирає, і відновлювати доводиться руками.
 *
 * Обидві проблеми вирішуються тут, а решта коду працює так, ніби
 * з'єднання є завжди.
 */
export class GameSocket extends EventTarget {
  #socket = null;
  #queue = [];
  #attempt = 0;
  #closedByUs = false;
  #reconnectTimer = null;

  constructor({ url, maxQueue = 64, maxDelay = 10_000 } = {}) {
    super();
    this.url = url ?? defaultUrl();
    this.maxQueue = maxQueue;
    this.maxDelay = maxDelay;
    this.state = "idle";
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #setState(state, detail = {}) {
    this.state = state;
    this.#emit("state", { state, ...detail });
  }

  connect() {
    this.#closedByUs = false;
    clearTimeout(this.#reconnectTimer);
    if (this.#socket && this.#socket.readyState <= WebSocket.OPEN) return;

    this.#setState(this.#attempt === 0 ? "connecting" : "reconnecting", {
      attempt: this.#attempt,
    });
    const socket = new WebSocket(this.url);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      this.#attempt = 0;
      this.#setState("open");
      // Усе, що накопичилося, поки з'єднання не було, йде зараз —
      // у тому самому порядку, в якому його надсилали.
      const pending = this.#queue;
      this.#queue = [];
      for (const message of pending) socket.send(message);
      this.#emit("flush", { count: pending.length });
    });

    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        this.#emit("protocol-error", { reason: "сервер надіслав не JSON" });
        return;
      }
      this.#emit("message", payload);
      this.#emit(payload.type, payload);
    });

    socket.addEventListener("error", () => {
      // WebSocket не повідомляє причину помилки — деталі будуть у close.
      this.#emit("socket-error", {});
    });

    socket.addEventListener("close", (event) => {
      this.#socket = null;
      this.#emit("closed", { code: event.code, reason: event.reason });

      // Коди 4000+ — це відмова сервера через наш протокол. Перепідключатися
      // немає сенсу: той самий клієнт зробить ту саму помилку ще раз.
      const fatal = event.code >= 4000 || event.code === 1009;
      if (this.#closedByUs || fatal) {
        this.#setState("closed", { code: event.code, reason: event.reason, fatal });
        return;
      }
      this.#scheduleReconnect();
    });
  }

  /**
   * Пауза між спробами росте: 500, 1000, 2000, 4000… до maxDelay.
   * Плюс джитер — щоб усі клієнти, яких відкинуло одночасно,
   * не повернулися теж одночасно.
   */
  #scheduleReconnect() {
    this.#attempt += 1;
    const base = Math.min(this.maxDelay, 500 * 2 ** (this.#attempt - 1));
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    this.#setState("waiting", { attempt: this.#attempt, delay });
    this.#reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  send(type, payload = {}) {
    const message = JSON.stringify({ type, ...payload });
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(message);
      return true;
    }
    // Черга обмежена: інакше за довгого обриву вона з'їсть пам'ять вкладки.
    if (this.#queue.length >= this.maxQueue) this.#queue.shift();
    this.#queue.push(message);
    this.#emit("queued", { size: this.#queue.length });
    return false;
  }

  close(code = 1000, reason = "bye") {
    this.#closedByUs = true;
    clearTimeout(this.#reconnectTimer);
    this.#queue = [];
    this.#socket?.close(code, reason);
    this.#setState("closed", { code, reason });
  }

  get queued() {
    return this.#queue.length;
  }
}

function defaultUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
