import {
  Bullet,
  type EntityId,
  entityId,
  type InputState,
  seq as makeSeq,
  millis,
  type Seq,
  Ship,
  TICK_DT,
  Vector2,
  WORLD,
  World,
} from "@starfall/shared";
import { decodeInput, decodeSnapshot, encodeInput, type Snapshot } from "@starfall/shared/protocol";
import type { Link } from "./link.ts";

export interface NetStats {
  rttMs: number;
  snapshotAgeMs: number;
  bytesInPerSecond: number;
  bytesOutPerSecond: number;
  pendingInputs: number;
  correctionUnits: number;
  snapshotsPerSecond: number;
  entities: number;
  proto: string;
}

export interface NetOptions {
  predict: boolean;
  desync: boolean;
  interpDelayMs: number;
}

/** Сутність у тому вигляді, в якому її чекає рендер. */
export interface ViewEntity {
  id: EntityId;
  kind: string;
  pos: Vector2;
  previousPos: Vector2;
  vel: Vector2;
  angle: number;
  previousAngle: number;
  radius: number;
  hp?: number;
  thrusting?: boolean;
  hunting?: boolean;
  homingEnabled?: boolean;
  invulnerable?: boolean;
  phase?: number;
  /** Підпис бонуса. Є лише в pickup — тому необов'язковий. */
  label?: string;
  remote?: boolean;
  mine?: boolean;
}

interface PendingInput {
  seq: Seq;
  input: InputState;
}

interface ReceivedSnapshot extends Snapshot {
  receivedAt: number;
}

/**
 * Мережевий клієнт: передбачення, звірка та інтерполяція.
 *
 * Розподіл обов'язків:
 *   свій корабель  — передбачення + звірка зі знімком;
 *   свої кулі      — передбачення (показуємо одразу);
 *   усе інше       — інтерполяція між двома знімками, тобто трохи в минулому.
 *
 * Чому передбачаємо лише своє: сервер усе одно головний, а передбачати
 * чужі кораблі немає сенсу — ми не знаємо їхнього input. Для них краще
 * показати правду із запізненням, ніж вигадку без затримки.
 */

/** На скільки показуємо чужі сутності в минулому. Обґрунтування — у README. */
export const INTERP_DELAY_MS = 100;

const SMOOTH_HALF_LIFE_MS = 100;

export function createNetcode({ link, getInput }: { link: Link; getInput: () => InputState }) {
  const options: NetOptions = {
    predict: true,
    /** Навмисна розсинхронізація: Math.random() всередині кроку. */
    desync: false,
    interpDelayMs: INTERP_DELAY_MS,
  };

  const stats: NetStats = {
    rttMs: 0,
    snapshotAgeMs: 0,
    bytesInPerSecond: 0,
    bytesOutPerSecond: 0,
    pendingInputs: 0,
    correctionUnits: 0,
    snapshotsPerSecond: 0,
    entities: 0,
    proto: "binary",
  };

  let world: World | null = null;
  let ship: Ship | null = null;
  let myShipId: EntityId | null = null;
  let sequence = 0;
  let accumulator = 0;
  let clockOffsetMs: number | null = null;

  const pending: PendingInput[] = [];
  const sentAt = new Map<number, number>();
  const snapshots: ReceivedSnapshot[] = [];
  let currentInput: InputState | null = null;

  // Поточне згладжування поправки: різниця між тим, що ми малювали,
  // і тим, де корабель опинився після звірки.
  let correction = new Vector2(0, 0);

  // Назва навмисно не `window`: у браузері це глобальний об'єкт, і
  // затінювати його локальною змінною — найкращий спосіб згодом
  // півгодини шукати, чому `window.location` раптом undefined.
  const counters = { bytesIn: 0, bytesOut: 0, snapshots: 0, startedAt: performance.now() };

  const EMPTY: InputState = {
    left: false,
    right: false,
    thrust: false,
    brake: false,
    fire: false,
  };

  function reset(seed: number, shipId: number): void {
    world = new World({ seed });
    ship = new Ship({ pos: new Vector2(WORLD.width / 2, WORLD.height / 2) });
    // Локальна копія нашого корабля має той самий id, що й на сервері:
    // інакше ми не впізнали б себе у знімку.
    // id корабля приходить від сервера: у знімку ми впізнаємо себе саме по ньому.
    Object.defineProperty(ship, "id", { value: entityId(shipId), writable: false });
    myShipId = entityId(shipId);
    ship.controller = () => currentInput ?? EMPTY;
    world.add(ship);
    pending.length = 0;
    snapshots.length = 0;
    sequence = 0;
    correction = new Vector2(0, 0);
  }

  /** Один мережевий тік: зняти намір, надіслати, передбачити. */
  function netTick(): void {
    if (!world || !ship) return;
    const input = getInput();
    sequence += 1;

    const frame = encodeInput({
      seq: makeSeq(sequence),
      input,
      clientTimeMs: millis(Math.round(performance.now())),
    });
    counters.bytesOut += frame.byteLength;
    sentAt.set(sequence, performance.now());
    link.send(frame);

    if (!options.predict) return;

    pending.push({ seq: makeSeq(sequence), input });
    // Запобіжник: якщо підтвердження чомусь не приходять, черга не має
    // рости вічно — це пам'ять і безглузде перегравання сотень кроків.
    if (pending.length > 120) pending.shift();
    stepWorld(input);
  }

  function stepWorld(input: InputState): void {
    if (!world || !ship) return;
    currentInput = input;
    world.step(TICK_DT);

    /**
     * Експеримент із README: додаємо випадковість у крок клієнта.
     * Сервер крутить ту саму симуляцію БЕЗ неї, тож світи щокроку
     * розходяться — і поправка на кожному знімку росте.
     */
    if (options.desync) {
      ship.pos = new Vector2(
        ship.pos.x + (Math.random() - 0.5) * 6,
        ship.pos.y + (Math.random() - 0.5) * 6,
      );
    }
  }

  function applySnapshot(snapshot: ReceivedSnapshot): void {
    if (!ship) return;
    const you = snapshot.entities.find((e) => e.you && e.kind === "ship");
    if (!you || !world) return;

    /**
     * Свій id беремо зі знімка, а не лише з повідомлення про вхід.
     *
     * Після перепідключення сервер створює НОВИЙ корабель із новим id,
     * і клієнт, який пам'ятає старий, перестає впізнавати себе у знімках:
     * звірка мовчки вимикається, черга непідтверджених input росте
     * до нескінченності, а корабель живе у власній реальності.
     * Прапорець FLAG.you робить це самовиправним.
     */
    if (myShipId !== you.id) {
      myShipId = you.id;
      Object.defineProperty(ship, "id", { value: you.id, writable: false });
      pending.length = 0;
    }

    const before = ship.pos;

    // 1. Ставимо корабель рівно туди, де його бачить сервер.
    ship.pos = new Vector2(you.x, you.y);
    ship.vel = new Vector2(you.vx, you.vy);
    ship.angle = you.angle;

    // 2. Заново програємо все, що сервер ще не підтвердив.
    //    Саме це робить передбачення чесним: ми не «вгадуємо»,
    //    а повторюємо ті самі кроки з того самого стану.
    for (const item of pending) stepWorld(item.input);

    // 3. Різниця між старим і новим положенням — це поправка.
    //    Її не застосовуємо миттєво: корабель смикався б. Замість цього
    //    лишаємо як зсув для рендера і гасимо приблизно за 100 мс.
    const delta = before.sub(ship.pos);
    correction = correction.add(delta);
    stats.correctionUnits = delta.length;
    stats.pendingInputs = pending.length;
  }

  function onFrame(raw: ArrayBuffer | string, { isBinary }: { isBinary: boolean }): void {
    if (isBinary) {
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(0);
      counters.bytesIn += bytes.byteLength;
      const snapshot = decodeSnapshot(bytes);
      if (snapshot) ingest({ ...snapshot, receivedAt: performance.now() });
      return;
    }

    // JSON-режим: ті самі дані, інший формат — для порівняння в README.
    const text = typeof raw === "string" ? raw : String(raw);
    counters.bytesIn += text.length;
    // JSON.parse повертає any — кладемо одразу в типізовану змінну.
    const parsed: Snapshot & { type?: string } = JSON.parse(text);
    if (parsed.type !== "snapshot") return;
    ingest({ ...parsed, bytes: text.length, receivedAt: performance.now() });
  }

  function ingest(snapshot: ReceivedSnapshot): void {
    snapshot.receivedAt = performance.now();
    counters.snapshots += 1;
    stats.entities = snapshot.entities.length;

    // Оцінка зсуву годинників: беремо мінімальну різницю за всі знімки —
    // вона відповідає найшвидшому доставленому пакету, тобто найменше
    // забруднена затримкою.
    const offset = snapshot.serverTimeMs - snapshot.receivedAt;
    clockOffsetMs =
      clockOffsetMs === null ? offset : Math.max(clockOffsetMs, offset) * 0.98 + offset * 0.02;

    // RTT: час від надсилання підтвердженого input до цього знімка.
    const sent = sentAt.get(snapshot.ackSeq);
    if (sent !== undefined) {
      stats.rttMs = snapshot.receivedAt - sent;
      for (const key of sentAt.keys()) {
        if (key <= snapshot.ackSeq) sentAt.delete(key);
      }
    }

    /**
     * Підтверджені input викидаємо ЗАВЖДИ, незалежно від того, чи
     * знайшли себе у знімку. Раніше це робилося всередині звірки — і
     * варто було серверу на мить загубити наш корабель (розрив,
     * перепідключення), як черга починала рости до стелі.
     */
    while (pending.length && (pending[0]?.seq ?? Number.POSITIVE_INFINITY) <= snapshot.ackSeq) {
      pending.shift();
    }

    snapshots.push(snapshot);
    while (snapshots.length > 24) snapshots.shift();

    if (options.predict) applySnapshot(snapshot);
  }

  /** Виклик із циклу рендера: тут живе фіксований мережевий крок. */
  function update(dt: number): void {
    if (!world) return;
    // Великий dt (перший кадр, повернення з фонової вкладки) не має
    // перетворюватися на пачку input: сервер усе одно їх відкине,
    // а черга на мить підскочить.
    accumulator += Math.min(dt, TICK_DT * 2);
    let guard = 0;
    while (accumulator >= TICK_DT && guard < 2) {
      accumulator -= TICK_DT;
      guard += 1;
      netTick();
    }

    // Згладжування поправки: експоненційне загасання з періодом
    // напіврозпаду 100 мс. Лінійне виглядало б як ривок наприкінці.
    const decay = 2 ** (-(dt * 1000) / SMOOTH_HALF_LIFE_MS);
    correction = correction.scale(decay);

    const latest = snapshots.at(-1);
    stats.snapshotAgeMs = latest ? performance.now() - latest.receivedAt : 0;
    stats.pendingInputs = pending.length;

    const elapsed = performance.now() - counters.startedAt;
    if (elapsed >= 500) {
      stats.bytesInPerSecond = Math.round((counters.bytesIn / elapsed) * 1000);
      stats.bytesOutPerSecond = Math.round((counters.bytesOut / elapsed) * 1000);
      stats.snapshotsPerSecond = +((counters.snapshots / elapsed) * 1000).toFixed(1);
      counters.bytesIn = 0;
      counters.bytesOut = 0;
      counters.snapshots = 0;
      counters.startedAt = performance.now();
    }
  }

  /** Два знімки навколо часу рендера — для інтерполяції чужих сутностей. */
  function framesAround(
    renderServerTime: number,
  ): [ReceivedSnapshot | null, ReceivedSnapshot | null] {
    for (let i = snapshots.length - 1; i > 0; i -= 1) {
      const before = snapshots[i - 1];
      const after = snapshots[i];
      if (before && after && before.serverTimeMs <= renderServerTime) return [before, after];
    }
    const first = snapshots[0] ?? null;
    return first ? [first, snapshots.at(-1) ?? first] : [null, null];
  }

  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  const lerpAngle = (a: number, b: number, t: number): number => {
    let delta = b - a;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return a + delta * t;
  };

  /**
   * Те, що малює рендер. Повертає масив сутностей, зібраний із двох
   * джерел: передбачення (своє) та інтерполяції (чуже).
   */
  function buildView(): ViewEntity[] {
    const out: ViewEntity[] = [];
    if (!world || !ship) return out;
    const now = performance.now();
    const renderServerTime = (clockOffsetMs ?? 0) + now - options.interpDelayMs;
    const [a, b] = framesAround(renderServerTime);

    if (a && b) {
      const span = b.serverTimeMs - a.serverTimeMs;
      const t = span > 0 ? Math.max(0, Math.min(1, (renderServerTime - a.serverTimeMs) / span)) : 0;
      const byId = new Map(b.entities.map((e) => [e.id, e]));

      for (const from of a.entities) {
        // Своє не беремо зі знімка: корабель і кулі вже намальовані
        // з передбачення, без затримки.
        if (from.you) continue;
        const to = byId.get(from.id) ?? from;
        out.push({
          id: from.id,
          kind: from.kind,
          pos: new Vector2(lerp(from.x, to.x, t), lerp(from.y, to.y, t)),
          previousPos: new Vector2(from.x, from.y),
          vel: new Vector2(from.vx, from.vy),
          angle: lerpAngle(from.angle, to.angle, t),
          previousAngle: from.angle,
          radius: from.radius,
          hp: from.hp,
          thrusting: from.thrusting,
          hunting: from.hunting,
          homingEnabled: from.homingEnabled,
          invulnerable: from.invulnerable,
          remote: true,
        });
      }
    }

    // Своє — з передбаченого світу, плюс згладжена поправка.
    for (const entity of world) {
      if (entity.kind === "explosion") continue;
      const offset = entity === ship ? correction : new Vector2(0, 0);
      out.push({
        id: entity.id,
        kind: entity.kind,
        pos: entity.pos.add(offset),
        previousPos: (entity.previousPos ?? entity.pos).add(offset),
        vel: entity.vel,
        angle: entity.angle,
        previousAngle: entity.previousAngle ?? entity.angle,
        radius: entity.radius,
        // instanceof звужує тип: hp і thrusting є лише в корабля,
        // homingEnabled — лише в кулі. Раніше тут просто читалося
        // undefined, і рендер мовчки малював кулю як звичайну.
        hp: entity instanceof Ship ? entity.hp : undefined,
        thrusting: entity instanceof Ship ? entity.thrusting : false,
        invulnerable: entity instanceof Ship ? entity.invulnerable : false,
        homingEnabled: entity instanceof Bullet ? entity.homingEnabled : false,
        mine: true,
      });
    }

    return out;
  }

  return {
    options,
    stats,
    reset,
    update,
    onFrame,
    buildView,
    get ship(): Ship | null {
      return ship;
    },
    get shipId(): EntityId | null {
      return myShipId;
    },
    get snapshotCount(): number {
      return snapshots.length;
    },
    /** Внутрішній стан — лише для налагодження й замірів. */
    get debug() {
      return {
        seq: sequence,
        pending: pending.length,
        firstPendingSeq: pending[0]?.seq ?? null,
        lastAck: snapshots.at(-1)?.ackSeq ?? null,
        snapshots: snapshots.length,
        clockOffsetMs,
      };
    },
    /** Для розділу «чіти» в README: спроба надіслати координати. */
    tryCheat() {
      const frame = encodeInput({
        seq: makeSeq(sequence + 1000),
        input: { left: false, right: false, thrust: true, brake: false, fire: false },
        clientTimeMs: millis(Math.round(performance.now())),
      });
      link.send(frame);
      return decodeInput(frame);
    },
  };
}
