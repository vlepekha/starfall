import { type EntityId, type EntityKind, entityId } from "../types.ts";
import { WORLD, wrap } from "./arena.ts";

const HALF_WIDTH = WORLD.width / 2;
const HALF_HEIGHT = WORLD.height / 2;

import { Vector2 } from "./vector.ts";
import type { WorldEvent, WorldEvents } from "./world.ts";

/** Поведінка — об'єкт із необов'язковим update. Композиція з лаби 2. */
export interface Behavior {
  readonly name: string;
  update?(entity: Entity, dt: number, world: WorldLike): void;
}

/**
 * Мінімум, який поведінки й правила знають про світ.
 *
 * Інтерфейс тут замість класу World навмисно: інакше entity.ts і world.ts
 * імпортували б одне одного по колу. Структурна типізація дозволяє
 * описати лише те, що справді потрібно.
 */
export interface WorldLike {
  spawn(entity: Entity): Entity;
  nearestOfKind(kind: EntityKind, pos: Vector2, maxDistance?: number): Entity | null;
  emit<K extends WorldEvent>(event: K, payload: WorldEvents[K]): void;
  readonly rng: { next(): number; chance(p: number): boolean };
}

export interface EntityOptions {
  pos?: Vector2;
  vel?: Vector2;
  radius?: number;
  kind?: EntityKind;
  angle?: number;
  behaviors?: Behavior[];
}

export class Entity {
  /** Приватний статичний лічильник — ззовні до нього не дістатися. */
  static #nextId = 1;

  /**
   * Не readonly лише через пул: об'єкт, узятий із пулу, отримує новий
   * id, бо для решти гри це НОВА сутність. Поза reset() id не змінюють.
   */
  id: EntityId;
  pos: Vector2;
  vel: Vector2;
  radius: number;
  kind: EntityKind;
  angle: number;
  alive = true;
  behaviors: Behavior[];
  previousPos: Vector2;
  previousAngle: number;
  /** Фаза анімації для рендера. На симуляцію не впливає. */
  phase?: number;

  constructor({
    pos = Vector2.zero(),
    vel = Vector2.zero(),
    radius = 10,
    kind = "ship",
    angle = 0,
    behaviors = [],
  }: EntityOptions = {}) {
    this.id = entityId(Entity.#nextId++);
    this.pos = pos;
    this.vel = vel;
    this.radius = radius;
    this.kind = kind;
    this.angle = angle;
    this.behaviors = behaviors;
    this.previousPos = pos;
    this.previousAngle = angle;
  }

  /**
   * Повернути об'єкт у стан «щойно створений» — для повторного
   * використання з пулу. Новий id навмисно: клієнт і сервер звіряють
   * сутності за id, і стара куля не має «ожити» під тим самим номером.
   */
  resetEntity({
    pos = Vector2.zero(),
    vel = Vector2.zero(),
    radius = 10,
    kind = "ship",
    angle = 0,
    behaviors = [],
  }: EntityOptions = {}): void {
    this.id = entityId(Entity.#nextId++);
    this.pos = pos;
    this.vel = vel;
    this.radius = radius;
    this.kind = kind;
    this.angle = angle;
    this.behaviors = behaviors;
    this.previousPos = pos;
    this.previousAngle = angle;
    this.alive = true;
    this.phase = undefined;
  }

  update(dt: number, world: WorldLike): void {
    for (const behavior of this.behaviors) behavior.update?.(this, dt, world);
    this.pos = new Vector2(
      wrap(this.pos.x + this.vel.x * dt, WORLD.width),
      wrap(this.pos.y + this.vel.y * dt, WORLD.height),
    );
  }

  /** Позначка «мертвий»: сутність доживе до кінця кроку. */
  kill(): void {
    this.alive = false;
  }

  /**
   * Перевірка дотику БЕЗ виділення пам'яті.
   *
   * Раніше тут було `pos.wrappedDistanceTo(other.pos)`, а це два нові
   * Vector2 і один Math.hypot на кожну пару. У профілі це дало 40%
   * часу кроку (`shortestDeltaTo` 20.4% + `get length` 20.7%).
   * Тут та сама математика на числах і без кореня: порівнюємо
   * квадрати відстаней.
   */
  intersects(other: Entity): boolean {
    let dx = Math.abs(this.pos.x - other.pos.x);
    let dy = Math.abs(this.pos.y - other.pos.y);
    // Арена — тор: через край може бути ближче, ніж навпростець.
    if (dx > HALF_WIDTH) dx = WORLD.width - dx;
    if (dy > HALF_HEIGHT) dy = WORLD.height - dy;

    const reach = this.radius + other.radius;
    return dx * dx + dy * dy < reach * reach;
  }
}
