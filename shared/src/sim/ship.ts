import type { EntityId, InputState } from "../types.ts";
import { WORLD, wrap } from "./arena.ts";
import { Bullet } from "./bullet.ts";
import { Entity, type EntityOptions, type WorldLike } from "./entity.ts";
import { Vector2 } from "./vector.ts";

/**
 * Стан корабля у вигляді простих чисел — саме з таким працює чиста
 * функція integrate(). Вона лишилася з лаби 1 і досі не знає ні про
 * класи, ні про DOM, ні про мережу.
 */
export interface ShipState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  thrusting?: boolean;
}

export function createShip(overrides: Partial<ShipState> = {}): ShipState {
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
 * Чиста фізика: ті самі аргументи -> той самий результат.
 * Жодного Math.random(), жодного Date.now().
 */
export function integrate(ship: ShipState, input: InputState, dt: number): ShipState {
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
  // Експонента, а не (1 - k*dt): стабільна при будь-якому dt.
  const decay = Math.exp(-damping * dt);
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
export function interpolate(previous: ShipState, current: ShipState, alpha: number): ShipState {
  const lerpWrapped = (a: number, b: number, max: number): number => {
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

const NO_INPUT: InputState = Object.freeze({
  left: false,
  right: false,
  thrust: false,
  brake: false,
  fire: false,
});

export interface ShipOptions extends EntityOptions {
  maxHp?: number;
  fireInterval?: number;
}

export class Ship extends Entity {
  /** Приватне поле: зовні читається через get hp(), пишеться лише тут. */
  #hp: number;
  #maxHp: number;
  #fireCooldown = 0;

  readonly fireInterval: number;
  thrusting = false;
  invulnerableFor = 0;
  homingShots = 0;
  playerName = "";

  /** Джерело керування: мережевий пакет, клавіатура або бот. */
  controller: () => InputState = () => NO_INPUT;

  constructor({ maxHp = 3, fireInterval = 0.22, ...options }: ShipOptions = {}) {
    super({ kind: "ship", radius: 18, angle: -Math.PI / 2, ...options });
    this.#hp = maxHp;
    this.#maxHp = maxHp;
    this.fireInterval = fireInterval;
  }

  get hp(): number {
    return this.#hp;
  }

  get maxHp(): number {
    return this.#maxHp;
  }

  get invulnerable(): boolean {
    return this.invulnerableFor > 0;
  }

  override update(dt: number, world: WorldLike): void {
    const input = this.controller();

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
   * Метод звертається до this — відірваний від об'єкта, він упаде
   * на приватному полі. Розбір — у README, частина 2.
   */
  fire(world: WorldLike): Bullet | null {
    if (this.#fireCooldown > 0 || !this.alive) return null;
    this.#fireCooldown = this.fireInterval;

    const nose = Vector2.fromAngle(this.angle, this.radius + 6);
    const options = {
      pos: this.pos.add(nose),
      vel: Vector2.fromAngle(this.angle, Bullet.SPEED).add(this.vel),
      ownerId: this.id,
      angle: this.angle,
    };

    const useHoming = this.homingShots > 0;
    if (useHoming) this.homingShots -= 1;
    const bullet = useHoming ? Bullet.homing(options) : Bullet.take(options);

    world.spawn(bullet);
    world.emit("fired", { ship: this, bullet });
    return bullet;
  }

  damage(amount: number, world?: WorldLike): number {
    if (this.invulnerable || !this.alive) return this.#hp;
    this.#hp = Math.max(0, this.#hp - amount);
    world?.emit("hit", { entity: this, hp: this.#hp });
    if (this.#hp === 0) {
      this.kill();
      world?.emit("death", { entity: this });
    }
    return this.#hp;
  }

  heal(amount: number): number {
    this.#hp = Math.min(this.#maxHp, this.#hp + amount);
    return this.#hp;
  }

  reset(pos: Vector2): void {
    this.#hp = this.#maxHp;
    this.pos = pos;
    this.previousPos = pos;
    this.vel = Vector2.zero();
    this.angle = -Math.PI / 2;
    this.alive = true;
    this.invulnerableFor = 2;
  }
}

export type { EntityId };
