import { WORLD, wrap } from "./arena.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

/**
 * Вибух — ОДНА сутність, що володіє пучком частинок.
 *
 * Альтернатива — зробити кожну частинку окремою сутністю світу. Тоді
 * один вибух додає 20 записів у Map і 20 перевірок у систему зіткнень,
 * хоча частинки ні з чим не стикаються. Тут радіус 0, у зіткненнях
 * участі не бере, а частинки живуть усередині звичайним масивом.
 */
export class Explosion extends Entity {
  /**
   * @param {object} options
   * @param {{next: () => number}} options.rng — обов'язковий: без нього
   *   частинки розлетілися б по-різному на сервері й на клієнті.
   */
  constructor({
    count = 14,
    color = "#ffb648",
    speed = 240,
    lifetime = 0.7,
    rng,
    ...options
  } = {}) {
    super({ kind: "explosion", radius: 0, ...options });
    const random = rng?.next ?? (() => 0.5);
    this.color = color;
    this.lifetime = lifetime;
    this.age = 0;

    this.particles = Array.from({ length: count }, (_, i) => {
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

  update(dt) {
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

  /** Частка життя, що лишилася, — рендер малює нею прозорість. */
  static fade(particle) {
    return Math.max(0, 1 - particle.age / particle.life);
  }
}
