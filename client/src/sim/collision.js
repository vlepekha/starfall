/**
 * Система зіткнень: коло-коло, наївний перебір пар O(n²).
 *
 * При 40–60 сутностях це ~1200 перевірок на крок, тобто 72 тисячі на секунду —
 * частки мілісекунди. Просторове розбиття (grid/quadtree) тут було б
 * передчасною оптимізацією; його місце — лаба 7, коли з'являться боти
 * й навантажувальні тести.
 *
 * Важливо: сама система НЕ знає, що робити при зіткненні. Вона лише знаходить
 * пари й питає таблицю правил. Додати новий вид — це рядок у RULES,
 * а не правка перебору.
 */
const RULES = new Map();

/** Зареєструвати реакцію на зіткнення двох видів (порядок не важливий). */
export function defineCollision(kindA, kindB, handler) {
  RULES.set(pairKey(kindA, kindB), { kindA, handler });
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function resolveCollisions(world) {
  const entities = [];
  for (const entity of world) {
    if (entity.alive && entity.radius > 0) entities.push(entity);
  }

  let hits = 0;
  for (let i = 0; i < entities.length; i += 1) {
    const a = entities[i];
    for (let j = i + 1; j < entities.length; j += 1) {
      const b = entities[j];
      // Мертві в межах цього ж кроку більше ні з ким не стикаються:
      // інакше одна куля встигла б «вбити» двох.
      if (!a.alive) break;
      if (!b.alive) continue;
      if (!a.intersects(b)) continue;

      const rule = RULES.get(pairKey(a.kind, b.kind));
      if (!rule) continue;

      // Приводимо аргументи до порядку, в якому правило зареєстроване.
      const [first, second] = a.kind === rule.kindA ? [a, b] : [b, a];
      rule.handler(first, second, world);
      hits += 1;
    }
  }
  return hits;
}
