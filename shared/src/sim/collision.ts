import type { EntityKind } from "../types.ts";
import { WORLD } from "./arena.ts";
import type { Entity, WorldLike } from "./entity.ts";

/**
 * Система зіткнень: коло-коло.
 *
 * Сама вона НЕ знає, що робити при зіткненні — лише знаходить пари
 * й питає таблицю правил. Широку фазу (кого з ким узагалі порівнювати)
 * робить просторовий хеш; до лаби 7 тут був повний перебір усіх з усіма.
 */
export type CollisionHandler = (a: Entity, b: Entity, world: CollisionWorld) => void;

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

/**
 * Розмір комірки сітки.
 *
 * 128 одиниць — трохи більше за найбільший радіус (астероїд ~44),
 * тож сутність зачіпає щонайбільше чотири комірки. Менша комірка
 * означає більше комірок на сутність, більша — більше зайвих пар.
 */
const CELL = 128;
const COLUMNS = Math.ceil(WORLD.width / CELL);
const ROWS = Math.ceil(WORLD.height / CELL);

/**
 * Сітка живе між викликами й лише очищається.
 *
 * Створювати Map на кожному кроці — це 30 нових Map за секунду на
 * кожен матч плюс масиви всередині. Тут масиви перевикористовуються:
 * у профілі після зміни збирач сміття зник із верхівки.
 */
const grid: Entity[][] = Array.from({ length: COLUMNS * ROWS }, () => []);
const candidates: Entity[] = [];
const seen = new Set<number>();

const cellIndex = (x: number, y: number): number => {
  // Арена — тор, тож крайні комірки сусідять через край.
  const cx = ((Math.floor(x / CELL) % COLUMNS) + COLUMNS) % COLUMNS;
  const cy = ((Math.floor(y / CELL) % ROWS) + ROWS) % ROWS;
  return cy * COLUMNS + cx;
};

export function resolveCollisions(world: CollisionWorld): number {
  for (const cell of grid) cell.length = 0;

  let count = 0;
  for (const entity of world) {
    if (!entity.alive || entity.radius <= 0) continue;
    grid[cellIndex(entity.pos.x, entity.pos.y)]?.push(entity);
    count += 1;
  }

  // На порожньому чи майже порожньому світі хеш лише заважає.
  if (count < 2) return 0;

  let hits = 0;
  for (const entity of world) {
    if (!entity.alive || entity.radius <= 0) continue;

    candidates.length = 0;
    seen.clear();

    // Сутність може зачіпати сусідні комірки, тож дивимося 3×3 навколо.
    const cx = Math.floor(entity.pos.x / CELL);
    const cy = Math.floor(entity.pos.y / CELL);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const index = cellIndex((cx + dx) * CELL + 1, (cy + dy) * CELL + 1);
        const cell = grid[index];
        if (!cell || seen.has(index)) continue;
        seen.add(index);
        for (const other of cell) candidates.push(other);
      }
    }

    for (const other of candidates) {
      // Кожну пару розглядаємо один раз: порівнюємо за id.
      if (other.id <= entity.id) continue;
      if (!entity.alive) break;
      if (!other.alive) continue;
      if (!entity.intersects(other)) continue;

      const rule = RULES.get(pairKey(entity.kind, other.kind));
      if (!rule) continue;

      const [first, second] = entity.kind === rule.kindA ? [entity, other] : [other, entity];
      rule.handler(first, second, world);
      hits += 1;
    }
  }

  return hits;
}

/**
 * Повний перебір усіх із усіма — лишений навмисно.
 *
 * По-перше, на ньому перевіряється, що хеш не загубив жодної пари
 * (див. тести). По-друге, саме з ним порівнюється виграш у README.
 */
export function resolveCollisionsBruteForce(world: CollisionWorld): number {
  const entities: Entity[] = [];
  for (const entity of world) {
    if (entity.alive && entity.radius > 0) entities.push(entity);
  }

  let hits = 0;
  for (let i = 0; i < entities.length; i += 1) {
    const a = entities[i];
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
