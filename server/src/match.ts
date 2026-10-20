import {
  createGame,
  EMPTY_INPUT,
  type Game,
  type InputState,
  type Millis,
  millis,
  type Seq,
  Ship,
  seq,
  TICK_DT,
  TICK_HZ,
  type Tick,
  tick,
  Vector2,
  WORLD,
} from "@starfall/shared";
import {
  encodeSnapshot,
  type InputFrame,
  jsonCodec,
  type Packable,
  type SnapshotPayload,
} from "@starfall/shared/protocol";
import type { WebSocket } from "ws";

const TICK_MS = 1000 / TICK_HZ;

/** Скільки кадрів input сервер тримає про запас. Більше — зайва затримка. */
const MAX_INPUT_BUFFER = 2;

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly ship: Ship;
  queue: InputFrame[];
  lastInput: InputState;
  ackSeq: Seq;
  clientTimeMs: Millis;
  droppedInputs: number;
  socket?: WebSocket;
}

export interface MatchOptions {
  roomId: string;
  seed?: number;
  onSnapshot?: (player: Player, payload: TickPayload) => void;
}

export interface TickPayload {
  tick: Tick;
  serverTimeMs: Millis;
  rngState: number;
  entities: Packable[];
}

/**
 * Авторитетний матч: світ рахує ТІЛЬКИ сервер.
 * Клієнт надсилає наміри з номером seq; координат у протоколі немає.
 */
export class Match {
  #timer: NodeJS.Timeout | null = null;
  #nextTickAt = 0;
  #players = new Map<string, Player>();

  readonly roomId: string;
  readonly seed: number;
  readonly startedAt = Date.now();
  readonly game: Game;
  readonly onSnapshot: MatchOptions["onSnapshot"];

  tick: Tick = tick(0);
  lastTickMs = 0;

  /**
   * Останні 120 тіків (4 секунди) — для /api/stats.
   * Нас цікавить не середнє, а розкид: рівний сервер із середнім 1 мс
   * і піками по 40 мс грається гірше за рівний із середнім 5 мс.
   */
  readonly #durations: number[] = [];
  readonly #intervals: number[] = [];
  #lastTickAt = 0;

  constructor({ roomId, seed = (Math.random() * 2 ** 32) >>> 0, onSnapshot }: MatchOptions) {
    this.roomId = roomId;
    this.seed = seed >>> 0;
    this.onSnapshot = onSnapshot;

    this.game = createGame({ seed: this.seed, config: { asteroidLimit: 8 } });
    // Корабель із createGame — «нічий»: у мережевій грі кожен гравець
    // отримує власний, тож прибираємо його з арени.
    this.game.world.despawn(this.game.ship);
    this.game.world.step(0);
  }

  get playerCount(): number {
    return this.#players.size;
  }

  addPlayer(id: string, name: string): Player {
    const angle = this.game.world.rng.next() * Math.PI * 2;
    const ship = new Ship({
      pos: new Vector2(
        WORLD.width / 2 + Math.cos(angle) * 220,
        WORLD.height / 2 + Math.sin(angle) * 180,
      ),
    });
    ship.playerName = name;
    this.game.world.add(ship);

    const player: Player = {
      id,
      name,
      ship,
      queue: [],
      lastInput: { ...EMPTY_INPUT },
      ackSeq: seq(0),
      clientTimeMs: millis(0),
      droppedInputs: 0,
    };
    // Корабель керується чергою input цього гравця — і більше нічим.
    ship.controller = () => player.lastInput;

    this.#players.set(id, player);
    if (!this.#timer) this.start();
    return player;
  }

  removePlayer(id: string): void {
    const player = this.#players.get(id);
    if (!player) return;
    this.game.world.despawn(player.ship);
    this.#players.delete(id);
    if (this.#players.size === 0) this.stop();
  }

  /** Вхідні наміри складаються в чергу: за тік споживається один. */
  applyInput(id: string, frame: InputFrame): void {
    const player = this.#players.get(id);
    if (!player) return;
    if (frame.seq <= player.ackSeq) return; // старий або дубль
    if (player.queue.length > 12) player.queue.shift();
    player.queue.push(frame);
  }

  start(): void {
    this.#nextTickAt = Date.now();
    this.#scheduleNext();
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Планування за ЦІЛЬОВИМ часом, а не setInterval: похибка одного тіку
   * не накопичується, бо наступний прив'язаний до абсолютного моменту.
   */
  #scheduleNext(): void {
    this.#nextTickAt += TICK_MS;
    const delay = this.#nextTickAt - Date.now();
    // Відстали більше ніж на 5 тіків — не наздоганяємо, буде лавина.
    if (delay < -5 * TICK_MS) this.#nextTickAt = Date.now();
    this.#timer = setTimeout(() => this.#runTick(), Math.max(0, delay));
  }

  #runTick(): void {
    const startedAt = Date.now();

    for (const player of this.#players.values()) {
      // Буфер input має бути КОРОТКИМ: стояча черга — це +230 мс
      // до всього, що робить гравець. Зайве відкидаємо з підтвердженням.
      while (player.queue.length > MAX_INPUT_BUFFER) {
        const stale = player.queue.shift();
        if (stale) {
          player.ackSeq = stale.seq;
          player.droppedInputs += 1;
        }
      }

      const next = player.queue.shift();
      if (next) {
        player.lastInput = next.input;
        player.ackSeq = next.seq;
        player.clientTimeMs = next.clientTimeMs;
      }
      // Черга порожня — повторюємо останній намір: втрата одного пакета
      // не має перетворюватися на смикання корабля.
    }

    this.game.step(TICK_DT);
    this.tick = tick(this.tick + 1);

    const entities: Packable[] = [];
    for (const entity of this.game.world) {
      if (entity.kind === "explosion") continue;
      entities.push(entity);
    }

    const payload: TickPayload = {
      tick: this.tick,
      serverTimeMs: millis(Date.now() - this.startedAt),
      rngState: this.game.world.rng.state,
      entities,
    };

    for (const player of this.#players.values()) this.onSnapshot?.(player, payload);

    this.lastTickMs = Date.now() - startedAt;
    this.#record(this.lastTickMs, startedAt);
    this.#scheduleNext();
  }

  #record(durationMs: number, startedAt: number): void {
    this.#durations.push(durationMs);
    if (this.#lastTickAt) this.#intervals.push(startedAt - this.#lastTickAt);
    this.#lastTickAt = startedAt;
    while (this.#durations.length > 120) this.#durations.shift();
    while (this.#intervals.length > 120) this.#intervals.shift();
  }

  /** Статистика тіків: середнє, p95 і джитер (стандартне відхилення інтервалу). */
  get stats() {
    const avg = (xs: number[]): number =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const p95 = (xs: number[]): number => {
      if (!xs.length) return 0;
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    };
    const meanInterval = avg(this.#intervals);
    const variance = this.#intervals.length
      ? avg(this.#intervals.map((x) => (x - meanInterval) ** 2))
      : 0;

    return {
      room: this.roomId,
      tick: this.tick,
      players: this.playerCount,
      tickMsAvg: +avg(this.#durations).toFixed(3),
      tickMsP95: +p95(this.#durations).toFixed(3),
      intervalMsAvg: +meanInterval.toFixed(2),
      /** Джитер: наскільки нерівно лягають тіки. Ідеал — 0 при 33.33 мс. */
      jitterMs: +Math.sqrt(variance).toFixed(2),
      droppedInputs: [...this.#players.values()].reduce((a, p) => a + p.droppedInputs, 0),
    };
  }

  /** Пакування знімка персонально для гравця: свій ackSeq і свій "you". */
  encodeFor(player: Player, payload: TickPayload, { json = false } = {}): ArrayBuffer | string {
    const full: SnapshotPayload = {
      ...payload,
      ackSeq: player.ackSeq,
      youId: player.ship.id,
    };
    return json ? jsonCodec.encodeSnapshot(full) : encodeSnapshot(full);
  }
}
