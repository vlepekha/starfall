import type { EntityKind } from "../types.ts";
import type { Entity, WorldLike } from "./entity.ts";

/**
 * Система зіткнень: коло-коло, наївний перебір пар O(n²).
 *
 * Сама вона НЕ знає, що робити при зіткненні — лише знаходить пари
 * й питає таблицю правил. Додати новий вид — рядок у таблиці.
 */
export type CollisionHandler = (a: Entity, b: Entity, world: CollisionWorld) => void;

/** Те, що система зіткнень вимагає від світу: лише ітерація. */
export interface CollisionWorld extends WorldLike {
  [Symbol.iterator](): Iterator<Entity>;
}

interface Rule {
  readonly kindA: EntityKind;
  readonly handler: CollisionHandler;
}

const RULES = new Map<string, Rule>();

const pairKey = (a: EntityKind, b: EntityKind): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function defineCollision(
  kindA: EntityKind,
  kindB: EntityKind,
  handler: CollisionHandler,
): void {
  RULES.set(pairKey(kindA, kindB), { kindA, handler });
}

export function resolveCollisions(world: CollisionWorld): number {
  const entities: Entity[] = [];
  for (const entity of world) {
    if (entity.alive && entity.radius > 0) entities.push(entity);
  }

  let hits = 0;
  for (let i = 0; i < entities.length; i += 1) {
    const a = entities[i];
    // noUncheckedIndexedAccess: доступ за індексом тепер може дати undefined,
    // і компілятор вимагає це перевірити. Дешева перевірка замість
    // «Cannot read properties of undefined» у рантаймі.
    if (!a) continue;

    for (let j = i + 1; j < entities.length; j += 1) {
      const b = entities[j];
      if (!b) continue;
      if (!a.alive) break;
      if (!b.alive) continue;
      if (!a.intersects(b)) continue;

      const rule = RULES.get(pairKey(a.kind, b.kind));
      if (!rule) continue;

      const [first, second] = a.kind === rule.kindA ? [a, b] : [b, a];
      rule.handler(first, second, world);
      hits += 1;
    }
  }
  return hits;
}
