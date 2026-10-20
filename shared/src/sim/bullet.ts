import type { EntityId } from "../types.ts";
import { homing, ttl } from "./behaviors.ts";
import { Entity, type EntityOptions } from "./entity.ts";
import { Pool } from "./pool.ts";

export interface BulletOptions extends EntityOptions {
  ownerId?: EntityId;
  lifetime?: number;
}

/** Куля: летить прямо й помирає за TTL. */
export class Bullet extends Entity {
  static readonly SPEED = 620;

  /**
   * Пул куль.
   *
   * Куля живе 1.4 с, а стріляють безперервно: при восьми ботах це
   * близько 240 нових об'єктів за секунду, і кожен — разом із масивом
   * поведінок. Пул робить із цього потоку кілька десятків об'єктів,
   * що по колу беруться й повертаються.
   */
  static readonly #pool = new Pool<Bullet>(() => new Bullet(), { limit: 512 });

  ownerId: EntityId | undefined;
  homingEnabled = false;

  constructor({ ownerId, lifetime = 1.4, ...options }: BulletOptions = {}) {
    super({ kind: "bullet", radius: 4, ...options });
    this.ownerId = ownerId;
    this.behaviors = [...this.behaviors, ttl(lifetime)];
  }

  /** Взяти кулю з пулу. Єдина точка створення куль у грі. */
  static take({ ownerId, lifetime = 1.4, ...options }: BulletOptions = {}): Bullet {
    const bullet = Bullet.#pool.take();
    bullet.resetEntity({ kind: "bullet", radius: 4, ...options });
    bullet.ownerId = ownerId;
    bullet.homingEnabled = false;
    bullet.behaviors = [ttl(lifetime)];
    return bullet;
  }

  /** Фабрика самонавідної кулі: той самий клас, інший набір поведінок. */
  static homing(options: BulletOptions = {}): Bullet {
    const bullet = Bullet.take({ ...options, lifetime: 2.6 });
    bullet.homingEnabled = true;
    bullet.behaviors = [
      ...bullet.behaviors,
      homing({ targetKind: "asteroid", turnRate: Math.PI * 1.4, range: 520 }),
    ];
    return bullet;
  }

  /** Повернути відпрацьовану кулю в пул. Викликає світ під час sweep. */
  static release(bullet: Bullet): void {
    bullet.behaviors = [];
    bullet.ownerId = undefined;
    Bullet.#pool.release(bullet);
  }

  static get poolStats() {
    return Bullet.#pool.stats;
  }
}
