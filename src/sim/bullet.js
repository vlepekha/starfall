import { homing, ttl } from "./behaviors.js";
import { Entity } from "./entity.js";

/** Куля: летить прямо й помирає за TTL. Нічого більше вона не вміє. */
export class Bullet extends Entity {
  static SPEED = 620;

  constructor({ ownerId, lifetime = 1.4, ...options } = {}) {
    super({ kind: "bullet", radius: 4, ...options });
    this.ownerId = ownerId;
    // TTL — поведінка, а не поле класу: так само її отримає будь-що інше.
    this.behaviors = [...this.behaviors, ttl(lifetime)];
  }

  /** Фабрика самонавідної кулі: той самий клас, інший набір поведінок. */
  static homing(options) {
    const bullet = new Bullet({ ...options, lifetime: 2.6 });
    bullet.homingEnabled = true;
    bullet.behaviors = [
      ...bullet.behaviors,
      homing({ targetKind: "asteroid", turnRate: Math.PI * 1.4, range: 520 }),
    ];
    return bullet;
  }
}
