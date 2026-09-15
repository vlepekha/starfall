/**
 * Арена: межі світу, параметри фізики й «загортання» країв.
 * Жодного DOM — цей модуль має однаково працювати в браузері та в Node.
 */
export const WORLD = Object.freeze({
  width: 1600,
  height: 900,
  turnRate: Math.PI * 1.6, // рад/с
  thrust: 420, // од/с^2
  brake: 1.8, // коеф. гальмування
  drag: 0.12, // пасивне тертя космосу (умовне)
  maxSpeed: 700,
});

/** Обгортання країв арени (тор). */
export function wrap(value, max) {
  if (value < 0) return value + max * Math.ceil(-value / max);
  if (value >= max) return value % max;
  return value;
}
