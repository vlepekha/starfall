import { homing, spin } from "./behaviors.ts";
import { Entity, type EntityOptions } from "./entity.ts";
import { Vector2 } from "./vector.ts";

export interface AsteroidOptions extends EntityOptions {
  size?: number;
}

/** Астероїд: перешкода, що розпадається на менші уламки. */
export class Asteroid extends Entity {
  readonly size: number;
  hunting = false;

  constructor({ size = 3, ...options }: AsteroidOptions = {}) {
    super({ kind: "asteroid", radius: 14 + size * 10, ...options });
    this.size = size;
    this.behaviors = [...this.behaviors, spin(0.4 / size)];
  }

  /** Та сама композиція, але на астероїді: «мисливець» переслідує корабель. */
  static hunter(options: AsteroidOptions = {}): Asteroid {
    const asteroid = new Asteroid({ ...options, size: 2 });
    asteroid.hunting = true;
    asteroid.behaviors = [
      ...asteroid.behaviors,
      homing({ targetKind: "ship", turnRate: Math.PI * 0.35, range: 900 }),
    ];
    return asteroid;
  }

  split(): Asteroid[] {
    if (this.size <= 1) return [];
    const children: Asteroid[] = [];
    for (const sign of [-1, 1]) {
      const angle = this.vel.angle + sign * 0.7;
      children.push(
        new Asteroid({
          size: this.size - 1,
          pos: this.pos,
          vel: Vector2.fromAngle(angle, this.vel.length * 1.25 + 20),
        }),
      );
    }
    return children;
  }
}
