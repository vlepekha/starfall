import { EventEmitter } from "node:events";

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly joinedAt: number;
}

export interface ChatLine {
  readonly from: string;
  readonly memberId: string;
  readonly text: string;
  readonly at: number;
}

/**
 * Типізовані події кімнати.
 *
 * EventEmitter сам по собі приймає будь-яке ім'я й будь-які аргументи —
 * одруківка в `emit("joni", …)` просто нічого не зробить. Цей інтерфейс
 * описує дозволені події, а методи нижче звужують emit/on до нього.
 */
export interface RoomEvents {
  join: [Member];
  leave: [Member];
  chat: [ChatLine];
  empty: [];
  error: [Error];
}

export interface RoomOptions {
  arena?: string;
  capacity?: number;
}

export class Room extends EventEmitter<RoomEvents> {
  #members = new Map<string, Member>();

  readonly id: string;
  readonly arena: string;
  readonly capacity: number;
  readonly createdAt = Date.now();

  constructor(id: string, { arena = "classic", capacity = 6 }: RoomOptions = {}) {
    super();
    this.id = id;
    this.arena = arena;
    this.capacity = capacity;

    /**
     * Власний слухач "error" обов'язковий: без нього emit("error")
     * кидає виняток і валить увесь процес. Деталі — у README, частина 4.
     */
    this.on("error", (error) => {
      console.error(`[room ${this.id}] ${error.message}`);
    });
  }

  get size(): number {
    return this.#members.size;
  }

  get isEmpty(): boolean {
    return this.#members.size === 0;
  }

  get members(): Member[] {
    return [...this.#members.values()];
  }

  has(id: string): boolean {
    return this.#members.has(id);
  }

  add(member: { id: string; name: string }): boolean {
    if (this.#members.size >= this.capacity) return false;
    const full: Member = { ...member, joinedAt: Date.now() };
    this.#members.set(member.id, full);
    this.emit("join", full);
    return true;
  }

  remove(id: string): Member | null {
    const member = this.#members.get(id);
    if (!member) return null;
    this.#members.delete(id);
    this.emit("leave", member);
    if (this.isEmpty) this.emit("empty");
    return member;
  }

  chat(id: string, text: string): ChatLine | null {
    const member = this.#members.get(id);
    if (!member) return null;
    const line: ChatLine = { from: member.name, memberId: id, text, at: Date.now() };
    this.emit("chat", line);
    return line;
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

export interface RegistryEvents {
  created: [Room];
  destroyed: [Room];
  error: [Error];
}

/** Реєстр кімнат. Порожня кімната видаляється. */
export class RoomRegistry extends EventEmitter<RegistryEvents> {
  #rooms = new Map<string, Room>();

  constructor() {
    super();
    this.on("error", (error) => console.error(`[rooms] ${error.message}`));
  }

  list() {
    return [...this.#rooms.values()].map((room) => room.toJSON());
  }

  get(id: string): Room | null {
    return this.#rooms.get(id) ?? null;
  }

  ensure(id: string, options?: RoomOptions): Room {
    const existing = this.#rooms.get(id);
    if (existing) return existing;

    const room = new Room(id, options);
    this.#rooms.set(id, room);

    room.once("empty", () => {
      this.#rooms.delete(id);
      this.emit("destroyed", room);
    });

    this.emit("created", room);
    return room;
  }

  get size(): number {
    return this.#rooms.size;
  }
}
