import { WORLD, wrap } from "./arena.js";
import { Bullet } from "./bullet.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

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

const NO_INPUT = Object.freeze({
  left: false,
  right: false,
  thrust: false,
  brake: false,
  fire: false,
});

/** Корабель із лаби 1 — тепер клас. Рівно один рівень від Entity. */
export class Ship extends Entity {
  /**
   * Приватне поле: зовні здоров'я не записати, тільки прочитати через get hp().
   * Будь-яка зміна проходить через damage()/heal(), які вміють повідомити світ
   * про смерть. Якби hp було публічним, будь-хто міг би написати ship.hp = -5
   * і корабель лишився б «живим» із від'ємним здоров'ям.
   */
  #hp;
  #maxHp;
  #fireCooldown = 0;

  constructor({ maxHp = 3, fireInterval = 0.22, ...options } = {}) {
    super({ kind: "ship", radius: 18, angle: -Math.PI / 2, ...options });
    this.#hp = maxHp;
    this.#maxHp = maxHp;
    this.fireInterval = fireInterval;
    this.thrusting = false;
    this.invulnerableFor = 0;

    /**
     * Джерело керування — звичайна функція. Корабель не знає нічого про
     * клавіатуру: підставте сюди мережевий пакет або бота — і нічого
     * не зміниться. Це знадобиться вже в лабі 5.
     */
    this.controller = () => NO_INPUT;
  }

  get hp() {
    return this.#hp;
  }

  get maxHp() {
    return this.#maxHp;
  }

  get invulnerable() {
    return this.invulnerableFor > 0;
  }

  update(dt, world) {
    const input = this.controller();

    // Фізика лишилася чистою функцією з лаби 1 — клас лише тримає стан.
    const next = integrate(
      { x: this.pos.x, y: this.pos.y, vx: this.vel.x, vy: this.vel.y, angle: this.angle },
      input,
      dt,
    );

    this.pos = new Vector2(next.x, next.y);
    this.vel = new Vector2(next.vx, next.vy);
    this.angle = next.angle;
    this.thrusting = Boolean(input.thrust);

    this.#fireCooldown = Math.max(0, this.#fireCooldown - dt);
    this.invulnerableFor = Math.max(0, this.invulnerableFor - dt);

    if (input.fire) this.fire(world);

    for (const behavior of this.behaviors) behavior.update?.(this, dt, world);
  }

  /**
   * Постріл із носа корабля.
   *
   * ВАЖЛИВО: цей метод звертається до this. Якщо передати його кудись
   * як звичайне посилання (`addEventListener("keydown", ship.fire)`),
   * this загубиться — див. розділ «Баг із this» у README.
   */
  fire(world) {
    if (this.#fireCooldown > 0 || !this.alive) return null;
    this.#fireCooldown = this.fireInterval;

    const nose = Vector2.fromAngle(this.angle, this.radius + 6);
    const options = {
      pos: this.pos.add(nose),
      vel: Vector2.fromAngle(this.angle, Bullet.SPEED).add(this.vel),
      ownerId: this.id,
      angle: this.angle,
    };

    // Підібраний бонус не створює новий клас кулі — лише інший набір поведінок.
    const useHoming = (this.homingShots ?? 0) > 0;
    if (useHoming) this.homingShots -= 1;
    const bullet = useHoming ? Bullet.homing(options) : new Bullet(options);

    world.spawn(bullet);
    world.emit("shot", { ship: this, bullet });
    return bullet;
  }

  damage(amount, world) {
    if (this.invulnerable || !this.alive) return this.#hp;
    this.#hp = Math.max(0, this.#hp - amount);
    world?.emit("hit", { entity: this, hp: this.#hp });
    if (this.#hp === 0) {
      this.kill();
      world?.emit("death", { entity: this });
    }
    return this.#hp;
  }

  heal(amount) {
    this.#hp = Math.min(this.#maxHp, this.#hp + amount);
    return this.#hp;
  }

  /** Повне відновлення після респауну. */
  reset(pos) {
    this.#hp = this.#maxHp;
    this.pos = pos;
    this.previousPos = pos;
    this.vel = Vector2.zero();
    this.angle = -Math.PI / 2;
    this.alive = true;
    this.invulnerableFor = 2;
  }
}
