import { createRng, type Rng } from "../rng.ts";
import type { EntityId, EntityKind } from "../types.ts";
import { resolveCollisions } from "./collision.ts";
import type { Entity, WorldLike } from "./entity.ts";

/** Шина подій, яку світ може повідомляти. Деталі — у клієнті/сервері. */
export interface EventSink {
  emit(type: string, detail?: unknown): void;
}

export interface WorldStats {
  entities: number;
  collisions: number;
  score: number;
  steps: number;
}

/**
 * Карта подій світу: ім'я → форма payload.
 *
 * Раніше слухач отримував `unknown` і кожен обробник починався з
 * приведення типу. Тепер компілятор знає, що в "death" є entity,
 * а в "score" — amount, і помилку в імені події ловить одразу.
 */
export interface WorldEvents {
  hit: { entity: Entity; hp: number };
  death: { entity: Entity };
  score: { amount: number };
  pickup: { ship: Entity; label: string };
  fired: { ship: Entity; bullet: Entity };
  exploded: { pos: { x: number; y: number }; big: boolean };
  respawn: { ship: Entity };
}

export type WorldEvent = keyof WorldEvents;

/**
 * Світ — це Map<id, Entity> плюс правила одного кроку.
 * Порядок усередині step() має значення: оновити → зіткнення →
 * додати нове → прибрати мертвих.
 */
export class World implements WorldLike {
  #entities = new Map<EntityId, Entity>();
  #spawnQueue: Entity[] = [];
  #listeners = new Map<string, Set<(payload: unknown) => void>>();
  #bus: EventSink | null;

  readonly rng: Rng;
  stats: WorldStats = { entities: 0, collisions: 0, score: 0, steps: 0 };

  constructor({ bus, seed = 1 }: { bus?: EventSink | null; seed?: number } = {}) {
    this.#bus = bus ?? null;
    this.rng = createRng(seed);
  }

  spawn(entity: Entity): Entity {
    this.#spawnQueue.push(entity);
    return entity;
  }

  add(entity: Entity): Entity {
    this.#entities.set(entity.id, entity);
    return entity;
  }

  despawn(entityOrId: Entity | EntityId): Entity | undefined {
    const entity = typeof entityOrId === "number" ? this.#entities.get(entityOrId) : entityOrId;
    entity?.kill();
    return entity;
  }

  get(id: EntityId): Entity | undefined {
    return this.#entities.get(id);
  }

  get size(): number {
    return this.#entities.size;
  }

  [Symbol.iterator](): Iterator<Entity> {
    return this.#entities.values();
  }

  /** Генератор: віддає сутності заданого виду, нічого не копіюючи. */
  *ofKind(kind: EntityKind): Generator<Entity> {
    for (const entity of this.#entities.values()) {
      if (entity.kind === kind && entity.alive) yield entity;
    }
  }

  nearestOfKind(
    kind: EntityKind,
    pos: { wrappedDistanceTo(other: { x: number; y: number }): number },
    maxDistance = Number.POSITIVE_INFINITY,
  ): Entity | null {
    let best: Entity | null = null;
    let bestDistance = maxDistance;
    for (const candidate of this.ofKind(kind)) {
      const distance = pos.wrappedDistanceTo(candidate.pos);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  on<K extends WorldEvent>(event: K, handler: (payload: WorldEvents[K]) => void): () => void {
    const set = this.#listeners.get(event) ?? new Set();
    this.#listeners.set(event, set);
    const listener = (payload: unknown) => handler(payload as WorldEvents[K]);
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<K extends WorldEvent>(event: K, payload: WorldEvents[K]): void {
    for (const handler of this.#listeners.get(event) ?? []) handler(payload);
    this.#bus?.emit(event, payload);
  }

  step(dt: number): void {
    for (const entity of this.#entities.values()) {
      entity.previousPos = entity.pos;
      entity.previousAngle = entity.angle;
      if (entity.alive) entity.update(dt, this);
    }

    this.stats.collisions = resolveCollisions(this);

    for (const entity of this.#spawnQueue) this.#entities.set(entity.id, entity);
    this.#spawnQueue.length = 0;

    this.#sweep();

    this.stats.entities = this.#entities.size;
    this.stats.steps += 1;
  }

  #sweep(): void {
    for (const [id, entity] of this.#entities) {
      if (!entity.alive) this.#entities.delete(id);
    }
  }

  clear(): void {
    this.#entities.clear();
    this.#spawnQueue.length = 0;
  }
}
