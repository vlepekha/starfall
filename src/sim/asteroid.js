import { homing, spin } from "./behaviors.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

/** Астероїд: перешкода, що розпадається на менші уламки. */
export class Asteroid extends Entity {
  constructor({ size = 3, ...options } = {}) {
    super({ kind: "asteroid", radius: 14 + size * 10, ...options });
    this.size = size;
    this.behaviors = [...this.behaviors, spin(0.4 / size)];
  }

  /**
   * Та сама композиція, що й на кулі, але на астероїді: «мисливець»
   * переслідує корабель. Жодного нового класу — ще одна поведінка.
   */
  static hunter(options) {
    const asteroid = new Asteroid({ ...options, size: 2 });
    asteroid.hunting = true;
    asteroid.behaviors = [
      ...asteroid.behaviors,
      homing({ targetKind: "ship", turnRate: Math.PI * 0.35, range: 900 }),
    ];
    return asteroid;
  }

  /** Розпад на два менші уламки. */
  split() {
    if (this.size <= 1) return [];
    const children = [];
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
