import type { EntityId } from "../types.ts";
import { homing, ttl } from "./behaviors.ts";
import { Entity, type EntityOptions } from "./entity.ts";

export interface BulletOptions extends EntityOptions {
  ownerId?: EntityId;
  lifetime?: number;
}

/** Куля: летить прямо й помирає за TTL. */
export class Bullet extends Entity {
  static readonly SPEED = 620;

  readonly ownerId: EntityId | undefined;
  homingEnabled = false;

  constructor({ ownerId, lifetime = 1.4, ...options }: BulletOptions = {}) {
    super({ kind: "bullet", radius: 4, ...options });
    this.ownerId = ownerId;
    this.behaviors = [...this.behaviors, ttl(lifetime)];
  }

  /** Фабрика самонавідної кулі: той самий клас, інший набір поведінок. */
  static homing(options: BulletOptions = {}): Bullet {
    const bullet = new Bullet({ ...options, lifetime: 2.6 });
    bullet.homingEnabled = true;
    bullet.behaviors = [
      ...bullet.behaviors,
      homing({ targetKind: "asteroid", turnRate: Math.PI * 1.4, range: 520 }),
    ];
    return bullet;
  }
}
