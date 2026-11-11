import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { assertNever } from "@starfall/shared";
import { CLOSE, parseClientMessage } from "@starfall/shared/messages";
import { decodeInput } from "@starfall/shared/protocol";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { Config } from "./config.ts";
import type { Logger } from "./log.ts";
import { silentLogger } from "./log.ts";
import { Match, type Player, type TickPayload } from "./match.ts";
import { createMatchLog, type LogEvent } from "./match-log.ts";
import type { Room, RoomRegistry } from "./room.ts";

/**
 * Чи дозволений цей Origin.
 *
 * Окрема експортована функція, бо це рівно те місце, яке треба
 * покрити тестами: помилка тут або відкриває сервер усьому
 * інтернету, або не пускає власних гравців.
 *
 * Правила:
 *  - порожній список дозволених — перевірки немає (лише в розробці,
 *    у production конфіг такого не дозволить);
 *  - відсутній Origin пропускаємо: його не надсилають НЕ-браузерні
 *    клієнти (боти, навантажувальний тест, curl). Захист потрібен
 *    саме від чужої сторінки в браузері, а вона Origin надсилає завжди;
 *  - порівнюємо точний рядок, без «закінчується на»: перевірка
 *    `endsWith("example.com")` пропустила б evil-example.com.
 */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  if (origin === undefined || origin === "") return true;
  return allowed.includes(origin);
}

/** IP клієнта з урахуванням проксі: на хостингу ми завжди за ним. */
export function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  // Перший у списку — початковий клієнт; далі йдуть проксі.
  const first = raw?.split(",")[0]?.trim();
  return first || request.socket.remoteAddress || "unknown";
}

const encode = (type: string, payload: Record<string, unknown> = {}): string =>
  JSON.stringify({ type, ...payload });

interface SocketState {
  readonly ip: string;
  readonly id: string;
  readonly socket: WebSocket;
  roomId: string | null;
  name: string | null;
  missedPongs: number;
  dropped: number;
  /** Токени для обмеження частоти (token bucket). */
  tokens: number;
  lastRefill: number;
  bytesIn: number;
  bytesOut: number;
  readonly json: boolean;
  player: Player | null;
  match: Match | null;
  joinTimer?: NodeJS.Timeout;
}

export interface WsOptions {
  config: Config;
  rooms: RoomRegistry;
  logEvent?: (event: LogEvent) => void;
  log?: Logger;
}

/** Лічильники для /metrics. Від старту процесу, не швидкості. */
export interface WsCounters {
  messagesIn: number;
  messagesOut: number;
  bytesIn: number;
  bytesOut: number;
  closedByRateLimit: number;
  closedByOrigin: number;
  closedByIpLimit: number;
  rejectedFrames: number;
}

export interface MatchInfo {
  room: string;
  tick: number;
  players: number;
  lastTickMs: number;
}

/**
 * WebSocket-шар: приймає з'єднання, перевіряє все вхідне й перекладає
 * це на події кімнати. Будь-яке порушення протоколу — закриття сокета
 * з конкретним кодом.
 */
export function attachWebSocket(
  httpServer: Server,
  { config, rooms, logEvent, log = silentLogger }: WsOptions,
) {
  const counters: WsCounters = {
    messagesIn: 0,
    messagesOut: 0,
    bytesIn: 0,
    bytesOut: 0,
    closedByRateLimit: 0,
    closedByOrigin: 0,
    closedByIpLimit: 0,
    rejectedFrames: 0,
  };

  /** Скільки з'єднань тримає кожна IP. Ключ зникає разом з останнім. */
  const perIp = new Map<string, number>();
  let acceptingConnections = true;
  /**
   * maxPayload — захист на рівні бібліотеки: кадри більші за ліміт
   * ws відкидає сам, не збираючи їх у пам'яті. Наша перевірка в
   * parseClientMessage лишається другою лінією (і дає зрозумілий код).
   */
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    maxPayload: config.maxMessageBytes,
    /**
     * Перевірка ДО рукостискання.
     *
     * Принципово відхиляти тут, а не після connection: відмова на
     * рукостисканні — це звичайний HTTP 403, сокет не створюється
     * взагалі, і нам не треба тримати стан для з'єднання, яке ми
     * однаково не обслуговуємо.
     */
    verifyClient: ({ origin, req }, done) => {
      if (!acceptingConnections) {
        log.info({ event: "handshake-rejected", reason: "shutting-down" });
        done(false, 503, "server is shutting down");
        return;
      }

      if (!isOriginAllowed(origin, config.allowedOrigins)) {
        counters.closedByOrigin += 1;
        log.warn({ event: "handshake-rejected", reason: "bad-origin", origin });
        done(false, 403, "origin not allowed");
        return;
      }

      const ip = clientIp(req);
      if ((perIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
        counters.closedByIpLimit += 1;
        log.warn({ event: "handshake-rejected", reason: "ip-limit", ip });
        done(false, 429, "too many connections");
        return;
      }

      done(true);
    },
  });
  const sockets = new Map<WebSocket, SocketState>();
  /** Один матч на кімнату. Створюється на першому гравцеві. */
  const matches = new Map<string, Match>();

  function send(socket: WebSocket, type: string, payload: Record<string, unknown>): boolean {
    if (socket.readyState !== socket.OPEN) return false;

    // Backpressure: якщо клієнт не встигає читати, черга росте в пам'яті
    // СЕРВЕРА. Необов'язкові повідомлення такому клієнту не шлемо.
    if (socket.bufferedAmount > config.maxBufferedBytes) {
      const state = sockets.get(socket);
      if (state) state.dropped += 1;
      return false;
    }

    const frame = encode(type, payload);
    socket.send(frame);
    counters.messagesOut += 1;
    counters.bytesOut += Buffer.byteLength(frame);
    return true;
  }

  function broadcast(roomId: string, type: string, payload: Record<string, unknown>): void {
    for (const [socket, state] of sockets) {
      if (state.roomId !== roomId) continue;
      send(socket, type, payload);
    }
  }

  rooms.on("created", (room: Room) => {
    const log = createMatchLog(config.logDir, room.id);

    room.on("join", (member) => {
      log.write({ room: room.id, event: "join", name: member.name });
      broadcast(room.id, "player-joined", { name: member.name, players: room.size });
    });
    room.on("leave", (member) => {
      log.write({ room: room.id, event: "leave", name: member.name });
      broadcast(room.id, "player-left", { name: member.name, players: room.size });
    });
    room.on("chat", (line) => {
      log.write({ room: room.id, event: "chat", name: line.from, text: line.text });
      broadcast(room.id, "chat", { from: line.from, text: line.text, at: line.at });
    });
    room.once("empty", () => {
      log.write({ room: room.id, event: "closed" });
      void log.close();
    });
  });

  function ensureMatch(roomId: string): Match {
    const existing = matches.get(roomId);
    if (existing) return existing;

    const match = new Match({
      roomId,
      onSnapshot: (player: Player, payload: TickPayload) => {
        const socket = player.socket;
        if (!socket || socket.readyState !== socket.OPEN) return;
        const state = sockets.get(socket);
        // Знімок — річ необов'язкова: наступний прийде за 33 мс.
        if (socket.bufferedAmount > config.maxBufferedBytes) {
          if (state) state.dropped += 1;
          return;
        }
        const frame = match.encodeFor(player, payload, { json: state?.json ?? false });
        socket.send(frame, { binary: typeof frame !== "string" });
        const size = typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
        if (state) state.bytesOut += size;
        counters.messagesOut += 1;
        counters.bytesOut += size;
      },
    });
    matches.set(roomId, match);
    return match;
  }

  /** RawData із ws буває Buffer, ArrayBuffer або масивом буферів. */
  function toBytes(raw: RawData): Uint8Array {
    if (Buffer.isBuffer(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
    return new Uint8Array(raw);
  }

  function totalPlayers(): number {
    let total = 0;
    for (const match of matches.values()) total += match.playerCount;
    return total;
  }

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const ip = clientIp(request);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);

    const state: SocketState = {
      ip,
      id: randomUUID(),
      socket,
      roomId: null,
      name: null,
      missedPongs: 0,
      dropped: 0,
      tokens: config.messagesPerSecond,
      lastRefill: Date.now(),
      bytesIn: 0,
      bytesOut: 0,
      json: new URL(request.url ?? "/", "http://localhost").searchParams.get("proto") === "json",
      player: null,
      match: null,
    };
    sockets.set(socket, state);

    // join має прийти впродовж 5 с, інакше це зламаний клієнт або сканер.
    state.joinTimer = setTimeout(() => {
      if (!state.roomId) socket.close(CLOSE.JOIN_TIMEOUT, "join timeout");
    }, config.joinTimeoutMs);

    send(socket, "hello", {
      id: state.id,
      limits: {
        maxMessageBytes: config.maxMessageBytes,
        messagesPerSecond: config.messagesPerSecond,
        joinTimeoutMs: config.joinTimeoutMs,
      },
    });

    socket.on("message", (raw: RawData, isBinary: boolean) => {
      const bytes = toBytes(raw);
      state.bytesIn += bytes.byteLength;
      counters.messagesIn += 1;
      counters.bytesIn += bytes.byteLength;
      if (isBinary) handleInput(state, bytes);
      else handleMessage(socket, state, bytes);
    });

    socket.on("pong", () => {
      state.missedPongs = 0;
    });
    socket.on("close", (code: number) => cleanup(socket, state, code));
    // Без цього слухача помилка сокета стала б необробленою подією "error".
    socket.on("error", (error: Error) => {
      log.error({ event: "ws-error", player: state.id, room: state.roomId, err: error.message });
    });
  });

  function handleMessage(socket: WebSocket, state: SocketState, raw: Uint8Array): void {
    /**
     * 1. Обмеження частоти — до будь-якого розбору.
     *
     * Token bucket, а не лічильник у вікні: вікно дозволяє надіслати
     * подвійну норму на стику двох секунд (20 наприкінці однієї і 20
     * на початку наступної). Тут токени поповнюються рівномірно, тож
     * сплеск обмежений розміром відра.
     */
    const now = Date.now();
    const elapsed = (now - state.lastRefill) / 1000;
    state.lastRefill = now;
    state.tokens = Math.min(
      config.messagesPerSecond,
      state.tokens + elapsed * config.messagesPerSecond,
    );

    if (state.tokens < 1) {
      counters.closedByRateLimit += 1;
      log.warn({ event: "close", reason: "rate-limit", player: state.id, room: state.roomId });
      socket.close(CLOSE.RATE_LIMIT, "too many messages");
      return;
    }
    state.tokens -= 1;

    // 2. Розмір, JSON, форма й відомий тип — усе в одній схемі Zod.
    const result = parseClientMessage(raw, { maxBytes: config.maxMessageBytes });
    if (!result.ok) {
      counters.rejectedFrames += 1;
      log.warn({
        event: "close",
        reason: "bad-message",
        code: result.code,
        detail: result.reason,
        player: state.id,
        room: state.roomId,
      });
      socket.close(result.code, result.reason);
      return;
    }

    const message = result.message;
    switch (message.type) {
      case "join":
        handleJoin(socket, state, message.room, message.name);
        return;
      case "pong":
        // Службове повідомлення, дозволене й до входу в кімнату.
        state.missedPongs = 0;
        return;
      case "chat":
        if (!state.roomId) {
          socket.close(CLOSE.NOT_JOINED, "join first");
          return;
        }
        rooms.get(state.roomId)?.chat(state.id, message.text);
        return;
      case "leave":
        socket.close(1000, "bye");
        return;
      default:
        /**
         * Вичерпність. Якщо в схемі з'явиться новий тип повідомлення,
         * `message` тут перестане бути never — і tsc не збереться.
         * Без цього новий тип тихо провалювався б у порожнечу.
         */
        assertNever(message, "необроблений тип повідомлення");
    }
  }

  function handleJoin(socket: WebSocket, state: SocketState, roomId: string, name: string): void {
    if (state.roomId) {
      socket.close(CLOSE.BAD_SHAPE, "already joined");
      return;
    }
    clearTimeout(state.joinTimer);

    // Ліміт кімнат: інакше будь-хто створить тисячу порожніх матчів,
    // кожен зі своїм таймером і файлом логу.
    if (!rooms.get(roomId) && rooms.size >= config.maxRooms) {
      socket.close(CLOSE.BAD_SHAPE, "too many rooms");
      return;
    }

    /**
     * Стеля гравців на процес.
     *
     * Кімната має свій ліміт, але кімнат багато, і без цієї перевірки
     * 32 кімнати по 6 гравців дали б 192 гравці в одному циклі подій.
     * Краще сказати «повно» одному, ніж зіпсувати гру всім.
     */
    if (totalPlayers() >= config.maxPlayers) {
      socket.close(CLOSE.SERVER_FULL, "server is full");
      log.warn({ event: "join-rejected", reason: "server-full", room: roomId });
      return;
    }

    const room = rooms.ensure(roomId, { capacity: config.roomCapacity });
    if (!room.add({ id: state.id, name })) {
      socket.close(CLOSE.BAD_SHAPE, "room is full");
      return;
    }

    const match = ensureMatch(room.id);
    const player = match.addPlayer(state.id, name);
    player.socket = socket;

    state.roomId = room.id;
    state.name = name;
    state.match = match;
    state.player = player;

    log.info({ event: "ws-join", player: state.id, room: room.id, name, ip: state.ip });
    send(socket, "joined", {
      room: room.toJSON(),
      you: { id: state.id, name, shipId: player.ship.id },
      net: { tickHz: 30, seed: match.seed, proto: state.json ? "json" : "binary" },
    });
    logEvent?.({ event: "ws-join", room: room.id, name });
  }

  /** Бінарний input: розбір, перевірка версії, у чергу матчу. */
  function handleInput(state: SocketState, raw: Uint8Array): void {
    if (!state.player || !state.match) return;
    const decoded = decodeInput(raw);
    if (!decoded) {
      // Декодер сам перевірив довжину, байт версії і діапазон кнопок.
      counters.rejectedFrames += 1;
      log.warn({ event: "close", reason: "bad-input-frame", player: state.id, room: state.roomId });
      state.socket.close(CLOSE.BAD_SHAPE, "bad input frame");
      return;
    }
    state.match.applyInput(state.id, decoded);
  }

  function cleanup(socket: WebSocket, state: SocketState, code: number): void {
    clearTimeout(state.joinTimer);
    const left = (perIp.get(state.ip) ?? 1) - 1;
    // Ключ прибираємо разом з останнім з'єднанням: інакше Map росла б
    // на кожну IP, яка колись заходила, і це був би витік пам'яті.
    if (left <= 0) perIp.delete(state.ip);
    else perIp.set(state.ip, left);
    if (state.match) {
      state.match.removePlayer(state.id);
      if (state.match.playerCount === 0) {
        state.match.stop();
        if (state.roomId) matches.delete(state.roomId);
      }
    }
    sockets.delete(socket);
    if (state.roomId) rooms.get(state.roomId)?.remove(state.id);
    logEvent?.({ event: "ws-close", id: state.id, code, dropped: state.dropped });
    log.info({
      event: "ws-close",
      player: state.id,
      room: state.roomId,
      code,
      dropped: state.dropped,
      bytesIn: state.bytesIn,
      bytesOut: state.bytesOut,
    });
  }

  /**
   * Ping раз на 15 с, два пропущені pong — розрив. Без цього «мертві»
   * з'єднання висять годинами: TCP сам про це не повідомить.
   */
  const pingTimer = setInterval(() => {
    for (const [socket, state] of sockets) {
      if (state.missedPongs >= config.missedPongLimit) {
        socket.terminate(); // саме terminate: close() чекав би відповіді
        continue;
      }
      state.missedPongs += 1;
      socket.ping();
    }
  }, config.pingIntervalMs);

  return {
    wss,
    get connections(): number {
      return sockets.size;
    },
    get matches(): MatchInfo[] {
      return [...matches.values()].map((m) => ({
        room: m.roomId,
        tick: m.tick,
        players: m.playerCount,
        lastTickMs: m.lastTickMs,
      }));
    },
    /** Докладна статистика тіків для /api/stats. */
    get matchStats() {
      return [...matches.values()].map((m) => m.stats);
    },
    counters,
    get players(): number {
      return totalPlayers();
    },
    /** Середній і p95 час кроку по всіх матчах — для /metrics. */
    get tickMs(): { avg: number; p95: number } {
      const stats = [...matches.values()].map((m) => m.stats);
      if (stats.length === 0) return { avg: 0, p95: 0 };
      const avg = stats.reduce((sum, s) => sum + s.tickMsAvg, 0) / stats.length;
      // Найгірший матч, а не середнє з p95: якщо одній кімнаті погано,
      // метрика має це показати, а не розмазати по решті.
      const p95 = Math.max(...stats.map((s) => s.tickMsP95));
      return { avg: +avg.toFixed(3), p95: +p95.toFixed(3) };
    },
    get droppedInputs(): number {
      return [...matches.values()].reduce((sum, m) => sum + m.stats.droppedInputs, 0);
    },

    /**
     * Перший крок зупинки: більше не пускаємо, попереджаємо гравців.
     *
     * Саме попередження робить різницю між «гра зникла» і «сервер
     * перезапускається»: клієнт отримує shutdown, показує це в лобі
     * й не намагається перепідключитися до процесу, який уже йде.
     */
    stopAccepting(reason: string): number {
      acceptingConnections = false;
      let warned = 0;
      for (const [socket, state] of sockets) {
        if (socket.readyState !== socket.OPEN) continue;
        socket.send(encode("shutdown", { reason, retryAfterMs: 5000 }));
        counters.messagesOut += 1;
        warned += 1;
        log.info({ event: "shutdown-notice", player: state.id, room: state.roomId });
      }
      return warned;
    },
    async close(): Promise<void> {
      acceptingConnections = false;
      clearInterval(pingTimer);
      for (const match of matches.values()) match.stop();
      /**
       * 1001 — «going away», а не 1000 «нормально».
       *
       * Різниця не формальна: клієнт за кодом вирішує, що робити.
       * 1000 означає «так і планувалося, сиди в лобі», 1001 —
       * «сервер пішов, спробуй повернутися пізніше».
       */
      for (const socket of sockets.keys()) {
        socket.close(CLOSE.SERVER_SHUTDOWN, "server shutdown");
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
