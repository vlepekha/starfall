/**
 * Спільна симуляція: той самий код у браузері і в Node.
 *
 * Два правила, які роблять це можливим:
 *  1. Жодного DOM і жодних модулів Node — тільки те, що є скрізь.
 *  2. Жодного Math.random() і Date.now() — час приходить кроками,
 *     випадковість із генератора з seed від сервера.
 *
 * Порушення будь-якого з них ламає передбачення на клієнті: світи
 * розійдуться, і звірка почне смикати корабель на рівному місці.
 */

export { createRng } from "./rng.js";
export { WORLD, wrap } from "./sim/arena.js";
export { Asteroid } from "./sim/asteroid.js";
export { Bullet } from "./sim/bullet.js";
export { Entity } from "./sim/entity.js";
export { Explosion } from "./sim/explosion.js";
export { Pickup } from "./sim/pickup.js";
export { createGame, DEFAULT_CONFIG, SCORE } from "./sim/rules.js";
export { createShip, integrate, interpolate, Ship } from "./sim/ship.js";
export { Vector2 } from "./sim/vector.js";
export { World } from "./sim/world.js";

/** Частота серверної симуляції. Клієнт передбачає тим самим кроком. */
export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

/** Порожній input — те саме значення на обох сторонах. */
export const EMPTY_INPUT = Object.freeze({
  left: false,
  right: false,
  thrust: false,
  brake: false,
  fire: false,
});
