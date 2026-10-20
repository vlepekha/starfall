import { EventEmitter } from "node:events";

/**
 * Кімната. Саме тут видно, навіщо EventEmitter: кімната нічого не знає
 * ні про WebSocket, ні про файл логу. Вона лише повідомляє, що сталося.
 */
export class Room extends EventEmitter {
  /** @type {Map<string, {id: string, name: string, joinedAt: number}>} */
  #members = new Map();

  constructor(id, { arena = "classic", capacity = 6 } = {}) {
    super();
    this.id = id;
    this.arena = arena;
    this.capacity = capacity;
    this.createdAt = Date.now();

    /**
     * ВАЖЛИВО: власний слухач "error".
     *
     * EventEmitter має особливий контракт для події "error": якщо на неї
     * ніхто не підписаний, emit кидає виняток, і це валить ВЕСЬ процес —
     * не кімнату, не з'єднання, а сервер цілком. Тому слухач тут є завжди,
     * навіть якщо він лише логує.
     */
    this.on("error", (error) => {
      console.error(`[room ${this.id}] ${error.message}`);
    });
  }

  get size() {
    return this.#members.size;
  }

  get isEmpty() {
    return this.#members.size === 0;
  }

  get members() {
    return [...this.#members.values()];
  }

  has(id) {
    return this.#members.has(id);
  }

  add(member) {
    if (this.#members.size >= this.capacity) return false;
    this.#members.set(member.id, { ...member, joinedAt: Date.now() });
    this.emit("join", member);
    return true;
  }

  remove(id) {
    const member = this.#members.get(id);
    if (!member) return null;
    this.#members.delete(id);
    this.emit("leave", member);
    if (this.isEmpty) this.emit("empty");
    return member;
  }

  chat(id, text) {
    const member = this.#members.get(id);
    if (!member) return null;
    const message = { from: member.name, memberId: id, text, at: Date.now() };
    this.emit("chat", message);
    return message;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.id,
      arena: this.arena,
      capacity: this.capacity,
      players: this.size,
      members: this.members.map((m) => m.name),
    };
  }
}

/**
 * Реєстр кімнат. Порожня кімната видаляється — інакше через добу роботи
 * сервера в пам'яті лежала б тисяча порожніх об'єктів із власними логами.
 */
export class RoomRegistry extends EventEmitter {
  #rooms = new Map();

  constructor({ onCreate } = {}) {
    super();
    this.on("error", (error) => console.error(`[rooms] ${error.message}`));
    this.onCreate = onCreate;
  }

  list() {
    return [...this.#rooms.values()].map((room) => room.toJSON());
  }

  get(id) {
    return this.#rooms.get(id) ?? null;
  }

  ensure(id, options) {
    const existing = this.#rooms.get(id);
    if (existing) return existing;

    const room = new Room(id, options);
    this.#rooms.set(id, room);

    room.once("empty", () => {
      this.#rooms.delete(id);
      this.emit("destroyed", room);
    });

    this.onCreate?.(room);
    this.emit("created", room);
    return room;
  }

  get size() {
    return this.#rooms.size;
  }
}
