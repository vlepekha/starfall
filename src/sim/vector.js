import { WORLD } from "./arena.js";

/**
 * Незмінний двовимірний вектор.
 *
 * Жоден метод не чіпає ні this, ні аргумент — усі повертають НОВИЙ Vector2.
 * Це коштує зайвих об'єктів, але знімає цілий клас помилок: вектор, який
 * ви комусь передали, ніхто не зіпсує у вас за спиною. Для гри такого
 * масштабу ціна незначна (десятки сутностей, а не десятки тисяч).
 */
export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    Object.freeze(this); // спроба мутації в strict mode кине помилку
  }

  static zero() {
    return ZERO;
  }

  /** Одиничний вектор із кута в радіанах. */
  static fromAngle(angle, length = 1) {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  add(other) {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  sub(other) {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  scale(factor) {
    return new Vector2(this.x * factor, this.y * factor);
  }

  get length() {
    return Math.hypot(this.x, this.y);
  }

  get angle() {
    return Math.atan2(this.y, this.x);
  }

  normalize() {
    const len = this.length;
    return len === 0 ? ZERO : this.scale(1 / len);
  }

  /** Обрізати довжину зверху, напрямок зберегти. */
  clampLength(max) {
    const len = this.length;
    return len <= max ? this : this.scale(max / len);
  }

  distanceTo(other) {
    return this.sub(other).length;
  }

  /**
   * Найкоротший вектор до цілі з урахуванням «загортання» арени.
   * Через край може бути ближче, ніж навпростець — homing це враховує.
   */
  shortestDeltaTo(other) {
    let dx = other.x - this.x;
    let dy = other.y - this.y;
    if (dx > WORLD.width / 2) dx -= WORLD.width;
    if (dx < -WORLD.width / 2) dx += WORLD.width;
    if (dy > WORLD.height / 2) dy -= WORLD.height;
    if (dy < -WORLD.height / 2) dy += WORLD.height;
    return new Vector2(dx, dy);
  }

  /** Відстань по тору — саме її використовує система зіткнень. */
  wrappedDistanceTo(other) {
    return this.shortestDeltaTo(other).length;
  }

  toString() {
    return `Vector2(${this.x.toFixed(1)}, ${this.y.toFixed(1)})`;
  }
}

const ZERO = new Vector2(0, 0);
