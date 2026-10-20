import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { assertNever } from "@starfall/shared";
import { CLOSE, parseClientMessage } from "@starfall/shared/messages";
import { decodeInput } from "@starfall/shared/protocol";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { Config } from "./config.ts";
import { Match, type Player, type TickPayload } from "./match.ts";
import { createMatchLog, type LogEvent } from "./match-log.ts";
import type { Room, RoomRegistry } from "./room.ts";

/** Скільки кімнат сервер готовий тримати одночасно. */
const MAX_ROOMS = 32;

const encode = (type: string, payload: Record<string, unknown> = {}): string =>
  JSON.stringify({ type, ...payload });

interface SocketState {
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
export function attachWebSocket(httpServer: Server, { config, rooms, logEvent }: WsOptions) {
  /**
   * maxPayload — захист на рівні бібліотеки: кадри більші за ліміт
   * ws відкидає сам, не збираючи їх у пам'яті. Наша перевірка в
   * parseClientMessage лишається другою лінією (і дає зрозумілий код).
   */
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    maxPayload: config.maxMessageBytes,
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

    socket.send(encode(type, payload));
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
        if (state) {
          state.bytesOut += typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
        }
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

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const state: SocketState = {
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
      if (isBinary) handleInput(state, bytes);
      else handleMessage(socket, state, bytes);
    });

    socket.on("pong", () => {
      state.missedPongs = 0;
    });
    socket.on("close", (code: number) => cleanup(socket, state, code));
    // Без цього слухача помилка сокета стала б необробленою подією "error".
    socket.on("error", (error: Error) => {
      console.error(`[ws ${state.id}] ${error.message}`);
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
      socket.close(CLOSE.RATE_LIMIT, "too many messages");
      return;
    }
    state.tokens -= 1;

    // 2. Розмір, JSON, форма й відомий тип — усе в одній схемі Zod.
    const result = parseClientMessage(raw, { maxBytes: config.maxMessageBytes });
    if (!result.ok) {
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
    if (!rooms.get(roomId) && rooms.size >= MAX_ROOMS) {
      socket.close(CLOSE.BAD_SHAPE, "too many rooms");
      return;
    }

    const room = rooms.ensure(roomId);
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
      state.socket.close(CLOSE.BAD_SHAPE, "bad input frame");
      return;
    }
    state.match.applyInput(state.id, decoded);
  }

  function cleanup(socket: WebSocket, state: SocketState, code: number): void {
    clearTimeout(state.joinTimer);
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
    async close(): Promise<void> {
      clearInterval(pingTimer);
      for (const match of matches.values()) match.stop();
      for (const socket of sockets.keys()) {
        socket.close(CLOSE.SERVER_SHUTDOWN, "server shutdown");
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
