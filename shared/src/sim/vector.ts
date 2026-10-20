import { WORLD } from "./arena.ts";

/**
 * Незмінний двовимірний вектор.
 *
 * `readonly` тут не декорація: саме компілятор тепер не дасть написати
 * `v.x = 5`. Раніше це ловилося лише в рантаймі через Object.freeze —
 * тобто вже після того, як код потрапив у браузер.
 */
export class Vector2 {
  readonly x: number;
  readonly y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  static zero(): Vector2 {
    return ZERO;
  }

  /** Одиничний вектор із кута в радіанах. */
  static fromAngle(angle: number, length = 1): Vector2 {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  add(other: Vector2): Vector2 {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vector2): Vector2 {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  scale(factor: number): Vector2 {
    return new Vector2(this.x * factor, this.y * factor);
  }

  get length(): number {
    return Math.hypot(this.x, this.y);
  }

  get angle(): number {
    return Math.atan2(this.y, this.x);
  }

  normalize(): Vector2 {
    const len = this.length;
    return len === 0 ? ZERO : this.scale(1 / len);
  }

  clampLength(max: number): Vector2 {
    const len = this.length;
    return len <= max ? this : this.scale(max / len);
  }

  distanceTo(other: Vector2): number {
    return this.sub(other).length;
  }

  /** Найкоротший вектор до цілі з урахуванням «загортання» арени. */
  shortestDeltaTo(other: Vector2): Vector2 {
    let dx = other.x - this.x;
    let dy = other.y - this.y;
    if (dx > WORLD.width / 2) dx -= WORLD.width;
    if (dx < -WORLD.width / 2) dx += WORLD.width;
    if (dy > WORLD.height / 2) dy -= WORLD.height;
    if (dy < -WORLD.height / 2) dy += WORLD.height;
    return new Vector2(dx, dy);
  }

  /** Відстань по тору — саме її використовує система зіткнень. */
  wrappedDistanceTo(other: Vector2): number {
    return this.shortestDeltaTo(other).length;
  }

  toString(): string {
    return `Vector2(${this.x.toFixed(1)}, ${this.y.toFixed(1)})`;
  }
}

const ZERO = new Vector2(0, 0);
