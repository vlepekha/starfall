/**
 * Експеримент 3 у "чистому" вигляді, без браузера.
 * Той самий модуль physics.js, той самий вхід — різні схеми кроку.
 * Запуск: npm run bench:physics
 */
import { WORLD } from "../src/sim/arena.js";
import { createShip, integrate } from "../src/sim/ship.js";

const HOLD = { left: false, right: true, thrust: true, brake: false, fire: false };
const DURATION = 10; // секунд модельного часу

function simulateFixed(hz) {
  const dt = 1 / hz;
  let ship = createShip();
  for (let t = 0; t < DURATION - 1e-9; t += dt) ship = integrate(ship, HOLD, dt);
  return ship;
}

/**
 * Фіксований крок, але кадри приходять нерівномірно (як у реальному rAF):
 * саме так працює наш createLoop. Результат має збігтися з еталоном біт у біт.
 */
function simulateAccumulated(frameHz, jitter, seed = 5) {
  const dt = 1 / 60;
  const random = makeRandom(seed);
  let ship = createShip();
  let accumulator = 0;
  let t = 0;
  while (t < DURATION) {
    const frame = (1 / frameHz) * (1 + (random() * 2 - 1) * jitter);
    accumulator += Math.min(frame, DURATION - t);
    t += frame;
    while (accumulator >= dt) {
      ship = integrate(ship, HOLD, dt);
      accumulator -= dt;
    }
  }
  return ship;
}

function makeRandom(seed) {
  let rng = seed;
  return () => {
    rng = (rng * 1664525 + 1013904223) % 4294967296;
    return rng / 4294967296;
  };
}

/** Змінний крок: dt = реальний час кадру. Імітуємо монітор із дрижанням. */
function simulateVariable(hz, jitter, seed = 1) {
  const random = makeRandom(seed);
  let ship = createShip();
  let t = 0;
  while (t < DURATION) {
    const dt = (1 / hz) * (1 + (random() * 2 - 1) * jitter);
    ship = integrate(ship, HOLD, Math.min(dt, DURATION - t));
    t += dt;
  }
  return ship;
}

const distance = (a, b) => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.hypot(Math.min(dx, WORLD.width - dx), Math.min(dy, WORLD.height - dy));
};

const reference = simulateFixed(60);
const cases = [
  ["фіксований 60 Гц (еталон)", reference],
  ["фіксований 60 Гц, повтор", simulateFixed(60)],
  ["акумулятор, рендер 144 Гц", simulateAccumulated(144, 0)],
  ["акумулятор, рендер 30 Гц ±40% jitter", simulateAccumulated(30, 0.4)],
  ["змінний крок @144 Гц", simulateVariable(144, 0)],
  ["змінний крок @60 Гц", simulateVariable(60, 0)],
  ["змінний крок @30 Гц", simulateVariable(30, 0)],
  ["змінний крок @60 Гц ±30% jitter", simulateVariable(60, 0.3)],
  ["змінний крок @60 Гц ±30% jitter, інший seed", simulateVariable(60, 0.3, 77)],
];

console.log(`Тримаємо "вправо + тяга" ${DURATION} с, порівнюємо кінцеву позицію з еталоном.\n`);
console.log("| Схема кроку | x | y | кут, ° | відхилення від еталона, од. |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const [name, ship] of cases) {
  const deg = (((ship.angle * 180) / Math.PI) % 360).toFixed(1);
  console.log(
    `| ${name} | ${ship.x.toFixed(1)} | ${ship.y.toFixed(1)} | ${deg} | ${distance(reference, ship).toFixed(1)} |`,
  );
}

// Тунелювання: один довгий кадр проти серії коротких.
const wallAt = 200;
const fast = { ...createShip(), x: 0, y: 450, vx: WORLD.maxSpeed, vy: 0, angle: 0 };
const crossedFixed = [];
let s = fast;
for (let i = 0; i < 30; i += 1) {
  s = integrate(s, { left: false, right: false, thrust: false, brake: false, fire: false }, 1 / 60);
  if (s.x >= wallAt) crossedFixed.push(i);
}
const oneBigStep = integrate(
  fast,
  { left: false, right: false, thrust: false, brake: false, fire: false },
  0.5,
);
console.log(
  `\nТунелювання: стіна на x=${wallAt}, швидкість ${WORLD.maxSpeed} од./с.\nФіксований крок 1/60: перетин зафіксовано на кроці #${crossedFixed[0]}, тобто у корабля було ${crossedFixed[0]} проміжних позицій до стіни.`,
);
console.log(
  `Один кадр dt=0.5 c — корабель одразу в x=${oneBigStep.x.toFixed(0)}: стіну пройдено без жодної проміжної перевірки.`,
);
