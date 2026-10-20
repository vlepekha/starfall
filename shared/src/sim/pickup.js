import { pickup } from "./behaviors.js";
import { Entity } from "./entity.js";

/**
 * Підбиране. Стоїть, колізиться, не корабель.
 * Клас тримає лише дані; що саме станеться при підбиранні — функція
 * усередині поведінки. Нові бонуси = нові функції, нуль нових класів.
 */
export class Pickup extends Entity {
  constructor({ effect, label, ...options } = {}) {
    super({ kind: "pickup", radius: 16, ...options });
    this.label = label;
    this.behaviors = [...this.behaviors, pickup({ effect, label })];
  }

  static repair(pos) {
    return new Pickup({ pos, label: "+1 HP", effect: (ship) => ship.heal(1) });
  }

  static homingAmmo(pos) {
    return new Pickup({
      pos,
      label: "HOMING",
      effect: (ship) => {
        ship.homingShots = (ship.homingShots ?? 0) + 12;
      },
    });
  }
}
