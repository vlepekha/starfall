import { resolveCollisions } from "./collision.js";

/**
 * Світ — це Map<id, Entity> плюс правила одного кроку.
 *
 * Чому Map, а не масив чи звичайний об'єкт:
 *  - ключі числові й не перетворюються на рядки, як у звичайному об'єкті;
 *  - видалення за id — O(1), а не пошук по масиву;
 *  - порядок вставки збережений, тож ітерація детермінована (важливо,
 *    бо від порядку залежить розбір зіткнень).
 */
export class World {
  #entities = new Map();
  #spawnQueue = [];
  #listeners = new Map();
  #bus = null;

  /**
   * Шина подій — необов'язкова. Світ лише кидає в неї події; хто слухає
   * (звук, HUD, статистика) — його не стосується. Саме тому в sim/
   * немає жодного імпорту з audio/ чи render/.
   */
  constructor({ bus } = {}) {
    this.#bus = bus ?? null;
  }

  /** Лічильники для HUD: за крок їх оновлює step(). */
  stats = { entities: 0, collisions: 0, score: 0, steps: 0 };

  /**
   * Народження відкладене: додавати в Map під час ітерації по ній — шлях
   * до нескінченного циклу (куля породжує кулю породжує кулю...).
   * Тому все нове чекає в черзі до кінця кроку.
   */
  spawn(entity) {
    this.#spawnQueue.push(entity);
    return entity;
  }

  /** Негайне додавання — тільки поза кроком (стартова розстановка). */
  add(entity) {
    this.#entities.set(entity.id, entity);
    return entity;
  }

  despawn(entityOrId) {
    const entity = typeof entityOrId === "object" ? entityOrId : this.#entities.get(entityOrId);
    entity?.kill();
    return entity;
  }

  get(id) {
    return this.#entities.get(id);
  }

  get size() {
    return this.#entities.size;
  }

  /** Ітерація по всіх сутностях: for (const e of world) { ... } */
  [Symbol.iterator]() {
    return this.#entities.values();
  }

  /**
   * Генератор: віддає сутності заданого виду по одній, нічого не копіюючи
   * у проміжний масив. Зручно для homing — йому треба пробігти астероїди
   * й зупинитися, щойно знайдено найближчий.
   */
  *ofKind(kind) {
    for (const entity of this.#entities.values()) {
      if (entity.kind === kind && entity.alive) yield entity;
    }
  }

  /** Найближча сутність виду kind — поверх ofKind, по відстані на торі. */
  nearestOfKind(kind, pos, maxDistance = Number.POSITIVE_INFINITY) {
    let best = null;
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

  /** Найпростіша шина подій: hit, death, score, pickup. */
  on(event, handler) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(handler);
    return () => this.#listeners.get(event).delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.#listeners.get(event) ?? []) handler(payload);
    this.#bus?.emit(event, payload);
  }

  /**
   * Один крок симуляції. Порядок кроків має значення:
   *  1. оновити всіх (поведінки + рух);
   *  2. порахувати зіткнення вже по нових позиціях;
   *  3. додати те, що народилося за крок;
   *  4. прибрати мертвих.
   * Якщо міняти місцями 2 і 4, куля встигне зникнути до того, як влучить.
   */
  step(dt) {
    for (const entity of this.#entities.values()) {
      entity.previousPos = entity.pos;
      entity.previousAngle = entity.angle;
      if (entity.alive) entity.update(dt, this);
    }

    this.stats.collisions = resolveCollisions(this);

    for (const entity of this.#spawnQueue) {
      this.#entities.set(entity.id, entity);
    }
    this.#spawnQueue.length = 0;

    this.#sweep();

    this.stats.entities = this.#entities.size;
    this.stats.steps += 1;
  }

  /** Прибирання мертвих — рівно один раз за крок, наприкінці. */
  #sweep() {
    for (const [id, entity] of this.#entities) {
      if (!entity.alive) this.#entities.delete(id);
    }
  }

  clear() {
    this.#entities.clear();
    this.#spawnQueue.length = 0;
  }
}
