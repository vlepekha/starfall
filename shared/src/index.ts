/**
 * Спільна симуляція: той самий код у браузері і в Node.
 *
 * Два правила, які роблять це можливим:
 *  1. Жодного DOM і жодних модулів Node.
 *  2. Жодного Math.random() і Date.now() — випадковість із генератора
 *     з seed від сервера, час приходить кроками.
 */

export type { Rng } from "./rng.ts";
export { binaryCodec, type Codec, jsonCodec, pickCodec } from "./codec.ts";
export { createRng } from "./rng.ts";
export type { ArenaSettings } from "./sim/arena.ts";
export { WORLD, wrap } from "./sim/arena.ts";
export { Asteroid } from "./sim/asteroid.ts";
export { Bullet } from "./sim/bullet.ts";
export type { Behavior, WorldLike } from "./sim/entity.ts";
export { Entity } from "./sim/entity.ts";
export type { Particle } from "./sim/explosion.ts";
export { Explosion } from "./sim/explosion.ts";
export { Pickup } from "./sim/pickup.ts";
export type { ArenaConfig, Game, GameOptions } from "./sim/rules.ts";
export { createGame, DEFAULT_CONFIG, SCORE } from "./sim/rules.ts";
export type { ShipState } from "./sim/ship.ts";
export { createShip, integrate, interpolate, Ship } from "./sim/ship.ts";
export { Vector2 } from "./sim/vector.ts";
export type { EventSink, WorldEvent, WorldEvents } from "./sim/world.ts";
export { World } from "./sim/world.ts";
export type { EntityId, EntityKind, InputState, Millis, Seq, Tick } from "./types.ts";
export { assertNever, entityId, millis, seq, tick } from "./types.ts";

import type { InputState } from "./types.ts";

/** Частота серверної симуляції. Клієнт передбачає тим самим кроком. */
export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export const EMPTY_INPUT: InputState = Object.freeze({
  left: false,
  right: false,
  thrust: false,
  brake: false,
  fire: false,
});
