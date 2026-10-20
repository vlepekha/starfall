/**
 * Детермінований генератор псевдовипадкових чисел (mulberry32).
 *
 * Math.random() у спільній симуляції заборонений: сервер і клієнт мають
 * отримати ОДНАКОВИЙ стан з однакового входу. З Math.random() у них
 * розійдуться навіть позиції уламків, і звірка почне «виправляти»
 * корабель на рівному місці.
 *
 * Seed приходить від сервера разом із першим знімком — тому обидві
 * сторони крутять ту саму послідовність.
 */
export function createRng(seed = 1) {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Дробове в діапазоні [min, max). */
    between(min, max) {
      return min + next() * (max - min);
    },
    /** true з імовірністю p. */
    chance(p) {
      return next() < p;
    },
    /** Поточний стан — щоб знімок міг його переносити. */
    get state() {
      return state;
    },
    set state(value) {
      state = value >>> 0;
    },
  };
}
