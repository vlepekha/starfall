/**
 * Пул об'єктів.
 *
 * Кулі й частинки вибуху — найчастіші короткоживучі об'єкти в грі:
 * при восьми ботах це приблизно 240 нових куль за секунду плюс
 * десятки частинок на кожен вибух. Кожна з них живе менше за дві
 * секунди й одразу стає сміттям.
 *
 * Пул не робить код швидшим сам по собі — він прибирає ПАУЗИ.
 * Замість того щоб збирач сміття час від часу зупиняв кадр,
 * відпрацьовані об'єкти повертаються у вільний список і беруться
 * звідти знову.
 */
export interface Poolable {
  /** Повернути об'єкт у стан «як новий». */
  reset(...args: never[]): void;
}

export interface PoolStats {
  created: number;
  reused: number;
  released: number;
  free: number;
}

export class Pool<T> {
  readonly #free: T[] = [];
  readonly #create: () => T;
  readonly #limit: number;
  readonly stats: PoolStats = { created: 0, reused: 0, released: 0, free: 0 };

  constructor(create: () => T, { limit = 512 }: { limit?: number } = {}) {
    this.#create = create;
    this.#limit = limit;
  }

  /** Взяти об'єкт: із вільних, якщо є, інакше створити новий. */
  take(): T {
    const reused = this.#free.pop();
    if (reused !== undefined) {
      this.stats.reused += 1;
      this.stats.free = this.#free.length;
      return reused;
    }
    this.stats.created += 1;
    return this.#create();
  }

  /**
   * Повернути об'єкт.
   *
   * Ліміт потрібен проти протилежної крайності: якщо на піку гри
   * звільнилося кілька тисяч куль, тримати їх усі вічно — це витік
   * пам'яті з доброго наміру.
   */
  release(item: T): void {
    this.stats.released += 1;
    if (this.#free.length >= this.#limit) return;
    this.#free.push(item);
    this.stats.free = this.#free.length;
  }

  get size(): number {
    return this.#free.length;
  }

  clear(): void {
    this.#free.length = 0;
    this.stats.free = 0;
  }
}
