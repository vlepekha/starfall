import type { Rng } from "../rng.ts";
import { WORLD, wrap } from "./arena.ts";
import { Entity, type EntityOptions } from "./entity.ts";
import { Pool } from "./pool.ts";
import { Vector2 } from "./vector.ts";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
}

export interface ExplosionOptions extends EntityOptions {
  count?: number;
  color?: string;
  speed?: number;
  lifetime?: number;
  rng?: Rng;
}

/**
 * Вибух — ОДНА сутність, що володіє пучком частинок.
 * Окремими сутностями вони додали б 20 записів у Map і 20 зайвих
 * перевірок у систему зіткнень, у яких вони не беруть участі.
 */
/**
 * Пул частинок.
 *
 * Один вибух — 14 об'єктів, і вибухи йдуть пачками. Самі масиви
 * частинок теж беремо з пулу: інакше кожен вибух лишав би за собою
 * і 14 об'єктів, і масив під них.
 */
const particlePool = new Pool<Particle>(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, age: 0 }), {
  limit: 1024,
});

const arrayPool = new Pool<Particle[]>(() => [], { limit: 64 });

/**
 * Вибух — ОДНА сутність, що володіє пучком частинок.
 * Окремими сутностями вони додали б 20 записів у Map і 20 зайвих
 * перевірок у систему зіткнень, у яких вони не беруть участі.
 */
export class Explosion extends Entity {
  color: string;
  lifetime: number;
  particles: Particle[];
  age = 0;

  constructor({
    count = 14,
    color = "#ffb648",
    speed = 240,
    lifetime = 0.7,
    rng,
    ...options
  }: ExplosionOptions = {}) {
    super({ kind: "explosion", radius: 0, ...options });
    this.color = color;
    this.lifetime = lifetime;
    this.particles = arrayPool.take();
    this.#fill({ count, speed, lifetime, rng });
  }

  /** Взяти вибух із пулу. */
  static take({
    count = 14,
    color = "#ffb648",
    speed = 240,
    lifetime = 0.7,
    rng,
    ...options
  }: ExplosionOptions = {}): Explosion {
    const explosion = explosionPool.take();
    explosion.resetEntity({ kind: "explosion", radius: 0, ...options });
    explosion.color = color;
    explosion.lifetime = lifetime;
    explosion.age = 0;
    explosion.particles = arrayPool.take();
    explosion.#fill({ count, speed, lifetime, rng });
    return explosion;
  }

  /** Повернути вибух, його масив і всі частинки в пули. */
  static release(explosion: Explosion): void {
    for (const particle of explosion.particles) particlePool.release(particle);
    explosion.particles.length = 0;
    arrayPool.release(explosion.particles);
    explosion.particles = EMPTY;
    explosionPool.release(explosion);
  }

  static get poolStats() {
    return { explosions: explosionPool.stats, particles: particlePool.stats };
  }

  #fill({
    count,
    speed,
    lifetime,
    rng,
  }: {
    count: number;
    speed: number;
    lifetime: number;
    rng?: Rng;
  }): void {
    const random = rng ? () => rng.next() : () => 0.5;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + random() * 0.4;
      const v = Vector2.fromAngle(angle, speed * (0.4 + random() * 0.8));
      const particle = particlePool.take();
      particle.x = this.pos.x;
      particle.y = this.pos.y;
      particle.vx = v.x;
      particle.vy = v.y;
      particle.life = 0.35 + random() * (lifetime - 0.3);
      particle.age = 0;
      this.particles.push(particle);
    }
  }

  override update(dt: number): void {
    this.age += dt;
    const decay = Math.exp(-2.2 * dt);
    let anyAlive = false;

    for (const p of this.particles) {
      if (p.age >= p.life) continue;
      p.age += dt;
      p.vx *= decay;
      p.vy *= decay;
      p.x = wrap(p.x + p.vx * dt, WORLD.width);
      p.y = wrap(p.y + p.vy * dt, WORLD.height);
      anyAlive = true;
    }

    if (!anyAlive) this.kill();
  }

  static fade(particle: Particle): number {
    return Math.max(0, 1 - particle.age / particle.life);
  }
}

const EMPTY: Particle[] = [];
const explosionPool = new Pool<Explosion>(() => new Explosion({ count: 0 }), { limit: 128 });
