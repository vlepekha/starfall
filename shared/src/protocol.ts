import type { Vector2 } from "./sim/vector.ts";
import {
  type EntityId,
  type EntityKind,
  entityId,
  type Millis,
  millis,
  type Seq,
  seq,
  type Tick,
  tick,
} from "./types.ts";

/**
 * Бінарний протокол: DataView, little-endian.
 *
 * Декодер не довіряє вхідним байтам: перевіряє довжину, байт версії
 * і діапазони. Типи тут не допоможуть — на межі процесу вони стерті.
 */

export const PROTOCOL_VERSION = 1;
export const MSG = { INPUT: 1, SNAPSHOT: 2 } as const;

export const BUTTON = {
  left: 1 << 0,
  right: 1 << 1,
  thrust: 1 << 2,
  brake: 1 << 3,
  fire: 1 << 4,
} as const;

export const ENTITY_KIND = new Map<EntityKind, number>([
  ["ship", 1],
  ["bullet", 2],
  ["asteroid", 3],
  ["pickup", 4],
]);

const KIND_NAME = new Map<number, EntityKind>([
  [1, "ship"],
  [2, "bullet"],
  [3, "asteroid"],
  [4, "pickup"],
]);

export const FLAG = {
  thrusting: 1 << 0,
  hunting: 1 << 1,
  homing: 1 << 2,
  invulnerable: 1 << 3,
  you: 1 << 4,
} as const;

/** Позиція × 8 — крок 1/8 одиниці; при арені 1600×900 це влазить в Int16. */
const POS_SCALE = 8;
const VEL_SCALE = 16;
/** Кут рівномірно по колу: крок ≈ 0.0096°. */
const ANGLE_SCALE = 32767 / Math.PI;

const HEADER_BYTES = 20;
const ENTITY_BYTES = 16;
const INPUT_BYTES = 12;

export const SIZES = { HEADER_BYTES, ENTITY_BYTES, INPUT_BYTES } as const;

const clampInt16 = (value: number): number => Math.max(-32768, Math.min(32767, Math.round(value)));

const wrapAngle = (angle: number): number => {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export interface InputFrame {
  seq: Seq;
  clientTimeMs: Millis;
  input: {
    left: boolean;
    right: boolean;
    thrust: boolean;
    brake: boolean;
    fire: boolean;
  };
}

export interface SnapshotEntity {
  id: EntityId;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  radius: number;
  thrusting: boolean;
  hunting: boolean;
  homingEnabled: boolean;
  invulnerable: boolean;
  you: boolean;
}

export interface Snapshot {
  tick: Tick;
  serverTimeMs: Millis;
  ackSeq: Seq;
  rngState: number;
  entities: SnapshotEntity[];
  bytes: number;
}

/** Сутність симуляції в тому вигляді, в якому її пакують. */
export interface Packable {
  id: EntityId;
  kind: EntityKind;
  pos: Vector2;
  vel: Vector2;
  angle: number;
  radius: number;
  hp?: number;
  thrusting?: boolean;
  hunting?: boolean;
  homingEnabled?: boolean;
  invulnerable?: boolean;
  ownerId?: EntityId | undefined;
}

export interface SnapshotPayload {
  tick: Tick;
  serverTimeMs: Millis;
  ackSeq: Seq;
  rngState: number;
  entities: Packable[];
  youId: EntityId;
}

/* ------------------------------------------------------------------ */
/*  INPUT                                                              */
/* ------------------------------------------------------------------ */

export function encodeInput({ seq: sequence, input, clientTimeMs }: InputFrame): ArrayBuffer {
  const buffer = new ArrayBuffer(INPUT_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.INPUT);
  view.setUint32(2, sequence >>> 0, true);

  let buttons = 0;
  if (input.left) buttons |= BUTTON.left;
  if (input.right) buttons |= BUTTON.right;
  if (input.thrust) buttons |= BUTTON.thrust;
  if (input.brake) buttons |= BUTTON.brake;
  if (input.fire) buttons |= BUTTON.fire;

  view.setUint8(6, buttons);
  view.setUint8(7, 0);
  view.setUint32(8, clientTimeMs >>> 0, true);
  return buffer;
}

/** @returns кадр або null, якщо байти не відповідають протоколу. */
export function decodeInput(bytes: ArrayBufferView | ArrayBuffer): InputFrame | null {
  const view = toView(bytes);
  if (!view || view.byteLength !== INPUT_BYTES) return null;
  if (view.getUint8(0) !== PROTOCOL_VERSION) return null;
  if (view.getUint8(1) !== MSG.INPUT) return null;

  const buttons = view.getUint8(6);
  // Невідомі біти — ознака іншої (чи підробленої) версії клієнта.
  if (buttons & ~0b11111) return null;

  return {
    seq: seq(view.getUint32(2, true)),
    clientTimeMs: millis(view.getUint32(8, true)),
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
/*  SNAPSHOT                                                           */
/* ------------------------------------------------------------------ */

export function encodeSnapshot(payload: SnapshotPayload): ArrayBuffer {
  const { entities, youId } = payload;
  const buffer = new ArrayBuffer(HEADER_BYTES + entities.length * ENTITY_BYTES);
  const view = new DataView(buffer);

  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, MSG.SNAPSHOT);
  view.setUint16(2, entities.length, true);
  view.setUint32(4, payload.tick >>> 0, true);
  view.setUint32(8, payload.serverTimeMs >>> 0, true);
  view.setUint32(12, payload.ackSeq >>> 0, true);
  view.setUint32(16, payload.rngState >>> 0, true);

  let offset = HEADER_BYTES;
  for (const entity of entities) {
    view.setUint16(offset, entity.id & 0xffff, true);
    view.setUint8(offset + 2, ENTITY_KIND.get(entity.kind) ?? 0);

    let flags = 0;
    if (entity.thrusting) flags |= FLAG.thrusting;
    if (entity.hunting) flags |= FLAG.hunting;
    if (entity.homingEnabled) flags |= FLAG.homing;
    if (entity.invulnerable) flags |= FLAG.invulnerable;
    // FLAG.you ставиться і на корабель гравця, і на ЙОГО кулі: клієнт
    // малює власні постріли з передбачення й має знати, що дублювати.
    if (entity.id === youId || entity.ownerId === youId) flags |= FLAG.you;
    view.setUint8(offset + 3, flags);

    view.setInt16(offset + 4, clampInt16(entity.pos.x * POS_SCALE), true);
    view.setInt16(offset + 6, clampInt16(entity.pos.y * POS_SCALE), true);
    view.setInt16(offset + 8, clampInt16(entity.vel.x * VEL_SCALE), true);
    view.setInt16(offset + 10, clampInt16(entity.vel.y * VEL_SCALE), true);
    view.setInt16(offset + 12, clampInt16(wrapAngle(entity.angle) * ANGLE_SCALE), true);
    view.setUint8(offset + 14, Math.max(0, Math.min(255, entity.hp ?? 0)));
    view.setUint8(offset + 15, Math.max(0, Math.min(255, entity.radius)));
    offset += ENTITY_BYTES;
  }

  return buffer;
}

export function decodeSnapshot(bytes: ArrayBufferView | ArrayBuffer): Snapshot | null {
  const view = toView(bytes);
  if (!view || view.byteLength < HEADER_BYTES) return null;
  if (view.getUint8(0) !== PROTOCOL_VERSION) return null;
  if (view.getUint8(1) !== MSG.SNAPSHOT) return null;

  const count = view.getUint16(2, true);
  // Довжина має точно відповідати кількості сутностей: обрізаний пакет
  // інакше дав би сміття в координатах замість помилки.
  if (view.byteLength !== HEADER_BYTES + count * ENTITY_BYTES) return null;

  const entities: SnapshotEntity[] = [];
  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i += 1) {
    const kind = KIND_NAME.get(view.getUint8(offset + 2));
    if (!kind) return null; // невідомий вид — протокол розійшовся

    const flags = view.getUint8(offset + 3);
    entities.push({
      id: entityId(view.getUint16(offset, true)),
      kind,
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
    });
    offset += ENTITY_BYTES;
  }

  return {
    tick: tick(view.getUint32(4, true)),
    serverTimeMs: millis(view.getUint32(8, true)),
    ackSeq: seq(view.getUint32(12, true)),
    rngState: view.getUint32(16, true),
    entities,
    bytes: view.byteLength,
  };
}

function toView(bytes: ArrayBufferView | ArrayBuffer): DataView | null {
  if (bytes instanceof ArrayBuffer) return new DataView(bytes);
  if (ArrayBuffer.isView(bytes))
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return null;
}

/* ------------------------------------------------------------------ */
/*  JSON-варіант: лише для порівняння розмірів у README                */
/* ------------------------------------------------------------------ */

export const jsonCodec = {
  encodeInput: (frame: InputFrame): string =>
    JSON.stringify({
      type: "input",
      seq: frame.seq,
      clientTimeMs: frame.clientTimeMs,
      input: frame.input,
    }),
  encodeSnapshot: (payload: SnapshotPayload): string =>
    JSON.stringify({
      type: "snapshot",
      tick: payload.tick,
      serverTimeMs: payload.serverTimeMs,
      ackSeq: payload.ackSeq,
      rngState: payload.rngState,
      entities: payload.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        x: Math.round(e.pos.x * 100) / 100,
        y: Math.round(e.pos.y * 100) / 100,
        vx: Math.round(e.vel.x * 100) / 100,
        vy: Math.round(e.vel.y * 100) / 100,
        angle: Math.round(e.angle * 1000) / 1000,
        hp: e.hp ?? 0,
        radius: e.radius,
        thrusting: Boolean(e.thrusting),
        hunting: Boolean(e.hunting),
        homingEnabled: Boolean(e.homingEnabled),
        invulnerable: Boolean(e.invulnerable),
        you: e.id === payload.youId || e.ownerId === payload.youId,
      })),
    }),
};
