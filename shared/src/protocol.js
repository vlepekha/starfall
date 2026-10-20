/**
 * Мережевий протокол лаби 5.
 *
 * Два формати одних і тих самих даних:
 *  - бінарний (DataView, little-endian) — робочий;
 *  - JSON — лишений за прапорцем, щоб було з чим порівняти в README.
 *
 * Little-endian обрано свідомо: усі процесори, на яких це реально
 * запуститься (x86, ARM), саме такі, тож DataView не робитиме
 * перестановку байтів. Але писати порядок явно ВСЕ ОДНО треба —
 * інакше код залежав би від платформи, а не від домовленості.
 */

export const PROTOCOL_VERSION = 1;

export const MSG = { INPUT: 1, SNAPSHOT: 2 };

export const BUTTON = {
  left: 1 << 0,
  right: 1 << 1,
  thrust: 1 << 2,
  brake: 1 << 3,
  fire: 1 << 4,
};

export const ENTITY_KIND = { ship: 1, bullet: 2, asteroid: 3, pickup: 4 };
const KIND_NAME = Object.fromEntries(Object.entries(ENTITY_KIND).map(([k, v]) => [v, k]));

export const FLAG = {
  thrusting: 1 << 0,
  hunting: 1 << 1,
  homing: 1 << 2,
  invulnerable: 1 << 3,
  you: 1 << 4,
};

/**
 * Масштаби для цілочисельного пакування.
 *
 * Позиція × 8 означає крок 1/8 світової одиниці — при арені 1600×900
 * це максимум 12800, що вільно влазить в Int16 (±32767). Точніше
 * і не треба: піксель на екрані більший за 1/8 одиниці.
 */
const POS_SCALE = 8;
const VEL_SCALE = 16;
/** Кут пакується в Int16 рівномірно по колу: крок ≈ 0.0096°. */
const ANGLE_SCALE = 32767 / Math.PI;

const HEADER_BYTES = 20;
const ENTITY_BYTES = 16;

const clampInt16 = (value) => Math.max(-32768, Math.min(32767, Math.round(value)));

const wrapAngle = (angle) => {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/* ------------------------------------------------------------------ */
/*  INPUT: клієнт → сервер, 12 байтів                                   */
/* ------------------------------------------------------------------ */

export function encodeInput({ seq, input, clientTimeMs }) {
  const buffer = new ArrayBuffer(12);
  const view = new DataView(buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.INPUT);
  view.setUint32(2, seq >>> 0, true);

  let buttons = 0;
  for (const [name, bit] of Object.entries(BUTTON)) {
    if (input[name]) buttons |= bit;
  }
  view.setUint8(6, buttons);
  view.setUint8(7, 0); // запас на майбутнє — вирівнювання теж корисне
  view.setUint32(8, clientTimeMs >>> 0, true);
  return buffer;
}

export function decodeInput(buffer) {
  const view = new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  if (view.byteLength !== 12) return null;
  if (view.getUint8(0) !== PROTOCOL_VERSION) return null;
  if (view.getUint8(1) !== MSG.INPUT) return null;

  const buttons = view.getUint8(6);
  return {
    seq: view.getUint32(2, true),
    clientTimeMs: view.getUint32(8, true),
    input: {
      left: Boolean(buttons & BUTTON.left),
      right: Boolean(buttons & BUTTON.right),
      thrust: Boolean(buttons & BUTTON.thrust),
      brake: Boolean(buttons & BUTTON.brake),
      fire: Boolean(buttons & BUTTON.fire),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  SNAPSHOT: сервер → клієнт, 20 байтів заголовка + 16 на сутність     */
/* ------------------------------------------------------------------ */

export function encodeSnapshot({ tick, serverTimeMs, ackSeq, rngState, entities, youId }) {
  const buffer = new ArrayBuffer(HEADER_BYTES + entities.length * ENTITY_BYTES);
  const view = new DataView(buffer);

  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.SNAPSHOT);
  view.setUint16(2, entities.length, true);
  view.setUint32(4, tick >>> 0, true);
  view.setUint32(8, serverTimeMs >>> 0, true);
  view.setUint32(12, ackSeq >>> 0, true);
  // Стан генератора — щоб перегравання кроків на клієнті дало
  // ті самі уламки й ті самі точки появи астероїдів.
  view.setUint32(16, rngState >>> 0, true);

  let offset = HEADER_BYTES;
  for (const entity of entities) {
    view.setUint16(offset, entity.id & 0xffff, true);
    view.setUint8(offset + 2, ENTITY_KIND[entity.kind] ?? 0);

    let flags = 0;
    if (entity.thrusting) flags |= FLAG.thrusting;
    if (entity.hunting) flags |= FLAG.hunting;
    if (entity.homingEnabled) flags |= FLAG.homing;
    if (entity.invulnerable) flags |= FLAG.invulnerable;
    // FLAG.you ставиться не лише на корабель гравця, а й на ЙОГО кулі:
    // клієнт малює власні постріли з передбачення й має знати,
    // які серверні сутності дублюють уже намальоване.
    if (entity.id === youId || entity.ownerId === youId) flags |= FLAG.you;
    view.setUint8(offset + 3, flags);

    view.setInt16(offset + 4, clampInt16(entity.pos.x * POS_SCALE), true);
    view.setInt16(offset + 6, clampInt16(entity.pos.y * POS_SCALE), true);
    view.setInt16(offset + 8, clampInt16(entity.vel.x * VEL_SCALE), true);
    view.setInt16(offset + 10, clampInt16(entity.vel.y * VEL_SCALE), true);
    view.setInt16(offset + 12, clampInt16(wrapAngle(entity.angle) * ANGLE_SCALE), true);
    view.setUint8(offset + 14, Math.max(0, Math.min(255, entity.hp ?? 0)));
    view.setUint8(offset + 15, Math.max(0, Math.min(255, entity.radius ?? 0)));
    offset += ENTITY_BYTES;
  }

  return buffer;
}

export function decodeSnapshot(buffer) {
  const view = new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  if (view.getUint8(0) !== PROTOCOL_VERSION) return null;
  if (view.getUint8(1) !== MSG.SNAPSHOT) return null;

  const count = view.getUint16(2, true);
  const snapshot = {
    tick: view.getUint32(4, true),
    serverTimeMs: view.getUint32(8, true),
    ackSeq: view.getUint32(12, true),
    rngState: view.getUint32(16, true),
    entities: new Array(count),
    bytes: view.byteLength,
  };

  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i += 1) {
    const flags = view.getUint8(offset + 3);
    snapshot.entities[i] = {
      id: view.getUint16(offset, true),
      kind: KIND_NAME[view.getUint8(offset + 2)] ?? "unknown",
      thrusting: Boolean(flags & FLAG.thrusting),
      hunting: Boolean(flags & FLAG.hunting),
      homingEnabled: Boolean(flags & FLAG.homing),
      invulnerable: Boolean(flags & FLAG.invulnerable),
      you: Boolean(flags & FLAG.you),
      x: view.getInt16(offset + 4, true) / POS_SCALE,
      y: view.getInt16(offset + 6, true) / POS_SCALE,
      vx: view.getInt16(offset + 8, true) / VEL_SCALE,
      vy: view.getInt16(offset + 10, true) / VEL_SCALE,
      angle: view.getInt16(offset + 12, true) / ANGLE_SCALE,
      hp: view.getUint8(offset + 14),
      radius: view.getUint8(offset + 15),
    };
    offset += ENTITY_BYTES;
  }
  return snapshot;
}

/* ------------------------------------------------------------------ */
/*  JSON-варіант: лише для порівняння розмірів                          */
/* ------------------------------------------------------------------ */

export const jsonCodec = {
  encodeInput: ({ seq, input, clientTimeMs }) =>
    JSON.stringify({ type: "input", seq, clientTimeMs, input }),
  encodeSnapshot: ({ tick, serverTimeMs, ackSeq, rngState, entities, youId }) =>
    JSON.stringify({
      type: "snapshot",
      tick,
      serverTimeMs,
      ackSeq,
      rngState,
      entities: entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        x: Math.round(e.pos.x * 100) / 100,
        y: Math.round(e.pos.y * 100) / 100,
        vx: Math.round(e.vel.x * 100) / 100,
        vy: Math.round(e.vel.y * 100) / 100,
        angle: Math.round(e.angle * 1000) / 1000,
        hp: e.hp ?? 0,
        radius: e.radius ?? 0,
        thrusting: Boolean(e.thrusting),
        hunting: Boolean(e.hunting),
        homingEnabled: Boolean(e.homingEnabled),
        invulnerable: Boolean(e.invulnerable),
        you: e.id === youId || e.ownerId === youId,
      })),
    }),
};

export const SIZES = { HEADER_BYTES, ENTITY_BYTES, INPUT_BYTES: 12 };
