import type { Rng } from "../rng.ts";
import { WORLD, wrap } from "./arena.ts";
import { Entity, type EntityOptions } from "./entity.ts";
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
export class Explosion extends Entity {
  readonly color: string;
  readonly lifetime: number;
  readonly particles: Particle[];
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

    const random = rng ? () => rng.next() : () => 0.5;
    this.particles = Array.from({ length: count }, (_, i): Particle => {
      const angle = (Math.PI * 2 * i) / count + random() * 0.4;
      const v = Vector2.fromAngle(angle, speed * (0.4 + random() * 0.8));
      return {
        x: this.pos.x,
        y: this.pos.y,
        vx: v.x,
        vy: v.y,
        life: 0.35 + random() * (lifetime - 0.3),
        age: 0,
      };
    });
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
