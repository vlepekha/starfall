import { WORLD, wrap } from "./arena.js";
import { Vector2 } from "./vector.js";

/**
 * Базова сутність. Усе, що живе на арені, — це Entity або її прямий нащадок.
 * Глибше одного рівня успадкування свідомо не йдемо: див. розділ про
 * композицію в README.
 */
export class Entity {
  /**
   * Приватний статичний лічильник. Поза класом до нього не дістатися ніяк:
   * ні через Entity.#nextId, ні через прототип, ні через Object.keys.
   * Тому id гарантовано унікальний і його неможливо «підкрутити» ззовні.
   */
  static #nextId = 1;

  constructor({
    pos = Vector2.zero(),
    vel = Vector2.zero(),
    radius = 10,
    kind = "entity",
    angle = 0,
    behaviors = [],
  } = {}) {
    this.id = Entity.#nextId++;
    this.pos = pos;
    this.vel = vel;
    this.radius = radius;
    this.kind = kind;
    this.angle = angle;
    this.alive = true;

    /**
     * Композиція: список незалежних поведінок. Кожна — об'єкт із update().
     * Саме сюди додаються homing, ttl, pickup — замість нових підкласів.
     */
    this.behaviors = behaviors;

    /** Стан на попередньому кроці — потрібен рендеру для інтерполяції. */
    this.previousPos = pos;
    this.previousAngle = angle;
  }

  /** Базовий рух: позиція += швидкість * dt, з «загортанням» країв. */
  update(dt, world) {
    for (const behavior of this.behaviors) {
      behavior.update?.(this, dt, world);
    }
    this.pos = new Vector2(
      wrap(this.pos.x + this.vel.x * dt, WORLD.width),
      wrap(this.pos.y + this.vel.y * dt, WORLD.height),
    );
  }

  /** Позначка «мертвий»: сутність доживе до кінця кроку, потім її приберуть. */
  kill() {
    this.alive = false;
  }

  /** Коло-коло: найпростіша перевірка, якої тут цілком достатньо. */
  intersects(other) {
    return this.pos.wrappedDistanceTo(other.pos) < this.radius + other.radius;
  }
}
