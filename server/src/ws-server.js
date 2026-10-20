import { randomUUID } from "node:crypto";
import { decodeInput } from "@starfall/shared/protocol";
import { WebSocketServer } from "ws";
import { Match } from "./match.js";
import { createMatchLog } from "./match-log.js";
import { CLOSE, encode, parseMessage } from "./protocol.js";

/**
 * WebSocket-шар: приймає з'єднання, перевіряє все, що приходить,
 * і перекладає це на події кімнати.
 *
 * Правило тут одне: будь-яке порушення протоколу — закриття сокета
 * з конкретним кодом. Не «проігнорували й поїхали далі»: мовчазне
 * ігнорування ховає помилки клієнта до найгіршого моменту.
 */
export function attachWebSocket(httpServer, { config, rooms, logEvent }) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const sockets = new Map();
  /** Один матч на кімнату. Створюється на першому гравцеві. */
  const matches = new Map();

  function send(socket, type, payload) {
    if (socket.readyState !== socket.OPEN) return false;

    /**
     * Backpressure. bufferedAmount — скільки байтів уже чекає відправки.
     * Якщо клієнт не встигає читати, черга росте в пам'яті СЕРВЕРА.
     * Один повільний клієнт здатен так з'їсти всю пам'ять, тому
     * необов'язкові повідомлення йому просто не шлемо.
     */
    if (socket.bufferedAmount > config.maxBufferedBytes) {
      const state = sockets.get(socket);
      if (state) state.dropped += 1;
      return false;
    }

    socket.send(encode(type, payload));
    return true;
  }

  function broadcast(roomId, type, payload, { except } = {}) {
    for (const [socket, state] of sockets) {
      if (state.roomId !== roomId || socket === except) continue;
      send(socket, type, payload);
    }
  }

  /** Кімната створюється разом зі своїм логом і підписками на події. */
  rooms.on("created", (room) => {
    const log = createMatchLog(config.logDir, room.id);
    room.log = log;

    room.on("join", (member) => {
      log.write({ room: room.id, event: "join", name: member.name });
      broadcast(room.id, "player-joined", { name: member.name, players: room.size });
    });
    room.on("leave", (member) => {
      log.write({ room: room.id, event: "leave", name: member.name });
      broadcast(room.id, "player-left", { name: member.name, players: room.size });
    });
    room.on("chat", (message) => {
      log.write({ room: room.id, event: "chat", name: message.from, text: message.text });
      broadcast(room.id, "chat", message);
    });
    room.once("empty", () => {
      log.write({ room: room.id, event: "closed" });
      log.close();
    });
  });

  wss.on("connection", (socket, request) => {
    const state = {
      id: randomUUID(),
      roomId: null,
      name: null,
      missedPongs: 0,
      dropped: 0,
      // Лічильник для обмеження частоти: скидається щосекунди.
      windowStart: Date.now(),
      windowCount: 0,
      ip: request.socket.remoteAddress,
      bytesIn: 0,
      bytesOut: 0,
      json: new URL(request.url, "http://localhost").searchParams.get("proto") === "json",
      player: null,
      match: null,
    };
    state.socket = socket;
    sockets.set(socket, state);

    /**
     * join має прийти впродовж 5 с. Інакше це або зламаний клієнт,
     * або сканер портів — тримати такий сокет відкритим немає сенсу.
     */
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

    socket.on("message", (raw, isBinary) => {
      // Бінарний кадр — це завжди input. Він іде найкоротшим шляхом:
      // ніякого JSON.parse 30 разів на секунду на кожного гравця.
      if (isBinary) {
        state.bytesIn += raw.length;
        handleInput(state, raw);
        return;
      }
      state.bytesIn += raw.length;
      handleMessage(socket, state, raw);
    });
    socket.on("pong", () => {
      state.missedPongs = 0;
    });
    socket.on("close", (code) => cleanup(socket, state, code));
    // Без цього слухача помилка сокета стала б необробленою подією "error".
    socket.on("error", (error) => {
      console.error(`[ws ${state.id}] ${error.message}`);
    });
  });

  function handleMessage(socket, state, raw) {
    // 1. Обмеження частоти — до будь-якого розбору.
    const now = Date.now();
    if (now - state.windowStart >= 1000) {
      state.windowStart = now;
      state.windowCount = 0;
    }
    state.windowCount += 1;
    if (state.windowCount > config.messagesPerSecond) {
      socket.close(CLOSE.RATE_LIMIT, "too many messages");
      return;
    }

    // 2. Розмір, JSON, форма, відомий тип.
    const result = parseMessage(raw, { maxBytes: config.maxMessageBytes });
    if (!result.ok) {
      socket.close(result.code, result.reason);
      return;
    }

    const message = result.message;

    if (message.type === "join") {
      if (state.roomId) {
        socket.close(CLOSE.BAD_SHAPE, "already joined");
        return;
      }
      clearTimeout(state.joinTimer);

      const room = rooms.ensure(message.room);
      const member = { id: state.id, name: message.name };
      if (!room.add(member)) {
        socket.close(CLOSE.BAD_SHAPE, "room is full");
        return;
      }

      state.roomId = room.id;
      state.name = message.name;

      const match = ensureMatch(room.id);
      state.match = match;
      state.player = match.addPlayer(state.id, message.name);
      state.player.socket = socket;

      send(socket, "joined", {
        room: room.toJSON(),
        you: { id: state.id, name: state.name, shipId: state.player.ship.id },
        net: {
          tickHz: match.tickHz ?? 30,
          seed: match.seed,
          proto: state.json ? "json" : "binary",
        },
      });
      logEvent?.({ event: "ws-join", room: room.id, name: state.name });
      return;
    }

    // pong — службове повідомлення, воно дозволене й до входу в кімнату.
    if (message.type === "pong") {
      state.missedPongs = 0;
      return;
    }

    // Будь-що інше, крім join, вимагає вже наявної кімнати.
    if (!state.roomId) {
      socket.close(CLOSE.NOT_JOINED, "join first");
      return;
    }
    const room = rooms.get(state.roomId);

    if (message.type === "chat") {
      room?.chat(state.id, message.text);
      return;
    }
    if (message.type === "leave") {
      socket.close(1000, "bye");
    }
  }

  function ensureMatch(roomId) {
    const existing = matches.get(roomId);
    if (existing) return existing;

    const match = new Match({
      roomId,
      onSnapshot: (player, payload) => {
        const socket = player.socket;
        if (!socket || socket.readyState !== socket.OPEN) return;
        const state = sockets.get(socket);
        // Той самий backpressure, що й у лабі 4: знімок — річ
        // необов'язкова, наступний прийде за 33 мс.
        if (socket.bufferedAmount > config.maxBufferedBytes) {
          if (state) state.dropped += 1;
          return;
        }
        const frame = match.encodeFor(player, payload, { json: state?.json });
        socket.send(frame, { binary: typeof frame !== "string" });
        if (state)
          state.bytesOut += typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
      },
    });
    matches.set(roomId, match);
    return match;
  }

  /** Бінарний input: розбір, перевірка версії, у чергу матчу. */
  function handleInput(state, raw) {
    if (!state.player || !state.match) return;
    const decoded = decodeInput(raw);
    if (!decoded) {
      state.socket?.close(CLOSE.BAD_SHAPE, "bad input frame");
      return;
    }
    state.match.applyInput(state.id, decoded);
  }

  function cleanup(socket, state, code) {
    clearTimeout(state.joinTimer);
    if (state.match) {
      state.match.removePlayer(state.id);
      if (state.match.playerCount === 0) {
        state.match.stop();
        matches.delete(state.roomId);
      }
    }
    sockets.delete(socket);
    if (state.roomId) rooms.get(state.roomId)?.remove(state.id);
    logEvent?.({ event: "ws-close", id: state.id, code, dropped: state.dropped });
  }

  /**
   * Ping раз на 15 с. Два пропущені pong — розрив.
   *
   * Без цього «мертві» з'єднання (ноутбук закрили, мережа зникла)
   * висять годинами: TCP сам про це не повідомить.
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
    get connections() {
      return sockets.size;
    },
    get matches() {
      return [...matches.values()].map((m) => ({
        room: m.roomId,
        tick: m.tick,
        players: m.playerCount,
        lastTickMs: m.lastTickMs ?? 0,
      }));
    },
    async close() {
      clearInterval(pingTimer);
      for (const match of matches.values()) match.stop();
      for (const socket of sockets.keys()) {
        socket.close(CLOSE.SERVER_SHUTDOWN, "server shutdown");
      }
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}
