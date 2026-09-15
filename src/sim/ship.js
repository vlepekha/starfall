/**
 * Стан корабля і чиста фізика: ніякого DOM, ніякого performance.now(),
 * ніякого Math.random(). Ті самі аргументи -> той самий результат.
 * Саме тому це можна буде запускати і на сервері.
 */
import { WORLD, wrap } from "./arena.js";

export function createShip(overrides = {}) {
  return {
    x: WORLD.width / 2,
    y: WORLD.height / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    thrusting: false,
    ...overrides,
  };
}

/**
 * @param {object} ship — попередній стан (не мутується)
 * @param {object} input — знімок клавіатури
 * @param {number} dt — фіксований крок у секундах
 * @returns {object} новий стан
 */
export function integrate(ship, input, dt) {
  let angle = ship.angle;
  if (input.left) angle -= WORLD.turnRate * dt;
  if (input.right) angle += WORLD.turnRate * dt;

  let vx = ship.vx;
  let vy = ship.vy;

  if (input.thrust) {
    vx += Math.cos(angle) * WORLD.thrust * dt;
    vy += Math.sin(angle) * WORLD.thrust * dt;
  }

  const damping = WORLD.drag + (input.brake ? WORLD.brake : 0);
  const decay = Math.exp(-damping * dt); // експонента, а не (1 - k*dt): стабільна при будь-якому dt
  vx *= decay;
  vy *= decay;

  const speed = Math.hypot(vx, vy);
  if (speed > WORLD.maxSpeed) {
    const k = WORLD.maxSpeed / speed;
    vx *= k;
    vy *= k;
  }

  return {
    ...ship,
    angle,
    vx,
    vy,
    x: wrap(ship.x + vx * dt, WORLD.width),
    y: wrap(ship.y + vy * dt, WORLD.height),
    thrusting: Boolean(input.thrust),
  };
}

/** Лінійна інтерполяція між двома станами для плавного рендера. */
export function interpolate(previous, current, alpha) {
  // Через "загортання" пряма інтерполяція дала б стрибок через усю арену.
  const lerpWrapped = (a, b, max) => {
    let delta = b - a;
    if (delta > max / 2) delta -= max;
    if (delta < -max / 2) delta += max;
    return wrap(a + delta * alpha, max);
  };

  let da = current.angle - previous.angle;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;

  return {
    ...current,
    x: lerpWrapped(previous.x, current.x, WORLD.width),
    y: lerpWrapped(previous.y, current.y, WORLD.height),
    angle: previous.angle + da * alpha,
  };
}
