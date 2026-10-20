import { createGame, EMPTY_INPUT, Ship, TICK_DT, TICK_HZ, Vector2, WORLD } from "@starfall/shared";
import { encodeSnapshot, jsonCodec } from "@starfall/shared/protocol";

const TICK_MS = 1000 / TICK_HZ;

/** Скільки кадрів input сервер тримає про запас. Більше — зайва затримка. */
const MAX_INPUT_BUFFER = 2;

/**
 * Авторитетний матч: світ рахує ТІЛЬКИ сервер.
 *
 * Клієнт надсилає наміри (газ, поворот, постріл) із номером seq.
 * Координати від клієнта не приймаються взагалі — інакше будь-хто
 * надіслав би «я тепер отут, зі швидкістю 9000» і це була б не гра.
 */
export class Match {
  #timer = null;
  #nextTickAt = 0;
  #players = new Map();

  constructor({ roomId, seed = (Math.random() * 2 ** 32) >>> 0, onSnapshot, onEvent }) {
    this.roomId = roomId;
    this.seed = seed >>> 0;
    this.onSnapshot = onSnapshot;
    this.onEvent = onEvent;
    this.tick = 0;
    this.startedAt = Date.now();

    this.game = createGame({ seed: this.seed, config: { asteroidLimit: 8 } });
    // Корабель із createGame — «нічий»: у мережевій грі кожен гравець
    // отримує власний, тож прибираємо його з арени.
    this.game.world.despawn(this.game.ship);
    this.game.world.step(0);
  }

  get playerCount() {
    return this.#players.size;
  }

  addPlayer(id, name) {
    const ship = this.#spawnShip(name);
    const player = {
      id,
      name,
      ship,
      queue: [],
      lastInput: { ...EMPTY_INPUT },
      ackSeq: 0,
      clientTimeMs: 0,
      bytesOut: 0,
    };
    // Корабель керується чергою input цього гравця — і більше нічим.
    ship.controller = () => player.lastInput;
    this.#players.set(id, player);
    if (!this.#timer) this.start();
    return player;
  }

  #spawnShip(name) {
    const angle = this.game.world.rng.next() * Math.PI * 2;
    const pos = new Vector2(
      WORLD.width / 2 + Math.cos(angle) * 220,
      WORLD.height / 2 + Math.sin(angle) * 180,
    );
    const ship = new Ship({ pos });
    ship.playerName = name;
    this.game.world.add(ship);
    return ship;
  }

  removePlayer(id) {
    const player = this.#players.get(id);
    if (!player) return;
    this.game.world.despawn(player.ship);
    this.#players.delete(id);
    if (this.#players.size === 0) this.stop();
  }

  /**
   * Вхідні наміри складаються в чергу. За тік споживається рівно один —
   * інакше клієнт, який шле 200 input/с, рухався б у шість разів швидше
   * за решту. Це не оптимізація, це захист від найпростішого чіта.
   */
  applyInput(id, { seq, input, clientTimeMs }) {
    const player = this.#players.get(id);
    if (!player) return;
    if (seq <= player.ackSeq) return; // старий або дубль — ігноруємо
    if (player.queue.length > 12) player.queue.shift(); // клієнт «біжить» — відкидаємо найстаріше
    player.queue.push({ seq, input, clientTimeMs });
  }

  start() {
    this.#nextTickAt = Date.now();
    this.#scheduleNext();
  }

  stop() {
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Планування за ЦІЛЬОВИМ часом, а не setInterval.
   *
   * setInterval(33) насправді дає 33 + похибка, і ця похибка
   * накопичується: за хвилину набігає помітний дрейф. Тут наступний тік
   * прив'язаний до абсолютного моменту, тож затримка одного тіку
   * компенсується коротшою паузою перед наступним.
   */
  #scheduleNext() {
    this.#nextTickAt += TICK_MS;
    const delay = this.#nextTickAt - Date.now();

    // Якщо відстали більше ніж на 5 тіків (заснув ноутбук, GC) — не
    // намагаємося наздогнати все: перескакуємо, інакше буде лавина.
    if (delay < -5 * TICK_MS) this.#nextTickAt = Date.now();

    this.#timer = setTimeout(() => this.#runTick(), Math.max(0, delay));
  }

  #runTick() {
    const startedAt = Date.now();

    for (const player of this.#players.values()) {
      /**
       * Буфер input має бути КОРОТКИМ.
       *
       * Якщо просто брати по одному за тік, будь-який сплеск (вхід у гру,
       * підвисла вкладка) створює стоячу чергу, яка вже ніколи не
       * розсмоктується: клієнт шле 30/с і сервер споживає 30/с. Черга
       * з семи пакетів — це +230 мс до всього, що робить гравець, і
       * рівно стільки ж до підтвердження, на якому тримається звірка.
       *
       * Тому зайве відкидаємо, лишаючи не більше двох кадрів запасу
       * на нерівність мережі.
       */
      while (player.queue.length > MAX_INPUT_BUFFER) {
        const stale = player.queue.shift();
        player.ackSeq = stale.seq; // підтверджуємо, щоб клієнт не чекав
        player.droppedInputs = (player.droppedInputs ?? 0) + 1;
      }

      const next = player.queue.shift();
      if (next) {
        player.lastInput = next.input;
        player.ackSeq = next.seq;
        player.clientTimeMs = next.clientTimeMs;
      }
      // Черга порожня — повторюємо останній відомий намір. Так втрата
      // одного пакета не перетворюється на смикання корабля.
    }

    this.game.step(TICK_DT);
    this.tick += 1;

    const entities = [...this.game.world].filter((e) => e.kind !== "explosion");
    const payload = {
      tick: this.tick,
      serverTimeMs: Date.now() - this.startedAt,
      rngState: this.game.world.rng.state,
      entities,
    };

    for (const player of this.#players.values()) {
      this.onSnapshot?.(player, payload);
    }

    this.lastTickMs = Date.now() - startedAt;
    this.#scheduleNext();
  }

  /** Пакування знімка персонально для гравця: у нього свій ackSeq і свій "you". */
  encodeFor(player, payload, { json = false } = {}) {
    const full = {
      ...payload,
      ackSeq: player.ackSeq,
      youId: player.ship.id,
      clientTimeMs: player.clientTimeMs,
    };
    return json ? jsonCodec.encodeSnapshot(full) : encodeSnapshot(full);
  }
}
