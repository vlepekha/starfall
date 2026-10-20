import { pickup, type ShipLike } from "./behaviors.ts";
import { Entity, type EntityOptions, type WorldLike } from "./entity.ts";
import type { Vector2 } from "./vector.ts";

export interface PickupOptions extends EntityOptions {
  effect: (ship: ShipLike, world: WorldLike) => void;
  label: string;
}

/**
 * Підбиране. Клас тримає лише дані; що станеться при підбиранні —
 * функція всередині поведінки. Нові бонуси = нові функції, нуль класів.
 */
export class Pickup extends Entity {
  readonly label: string;

  constructor({ effect, label, ...options }: PickupOptions) {
    super({ kind: "pickup", radius: 16, ...options });
    this.label = label;
    this.behaviors = [...this.behaviors, pickup({ effect, label })];
  }

  static repair(pos: Vector2): Pickup {
    return new Pickup({ pos, label: "+1 HP", effect: (ship) => void ship.heal(1) });
  }

  static homingAmmo(pos: Vector2): Pickup {
    return new Pickup({
      pos,
      label: "HOMING",
      effect: (ship) => {
        ship.homingShots = (ship.homingShots ?? 0) + 12;
      },
    });
  }
}
