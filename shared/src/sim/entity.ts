import { type EntityId, type EntityKind, entityId } from "../types.ts";
import { WORLD, wrap } from "./arena.ts";
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

  readonly id: EntityId;
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

  intersects(other: Entity): boolean {
    return this.pos.wrappedDistanceTo(other.pos) < this.radius + other.radius;
  }
}
