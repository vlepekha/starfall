/**
 * Арена: межі світу, параметри фізики й «загортання» країв.
 * Жодного DOM — цей модуль має однаково працювати в браузері та в Node.
 */
export interface ArenaSettings {
  readonly width: number;
  readonly height: number;
  readonly turnRate: number;
  readonly thrust: number;
  readonly brake: number;
  readonly drag: number;
  readonly maxSpeed: number;
}

export const WORLD: ArenaSettings = Object.freeze({
  width: 1600,
  height: 900,
  turnRate: Math.PI * 1.6,
  thrust: 420,
  brake: 1.8,
  drag: 0.12,
  maxSpeed: 700,
});

/** Обгортання країв арени (тор). */
export function wrap(value: number, max: number): number {
  if (value < 0) return value + max * Math.ceil(-value / max);
  if (value >= max) return value % max;
  return value;
}
