/**
 * Чистий замір кроку симуляції — без мережі, без сокетів.
 *
 * Мережевий навантажувальний тест показує «скільки клієнтів тримає
 * сервер», а цей — скільки коштує сам крок при N кораблях. Саме тут
 * видно, чи впирається все в перевірку колізій.
 *
 * Запуск: node tools/bench-step.mjs [кількість кораблів]
 */
import { createGame, Ship, TICK_DT, Vector2, WORLD, World } from "@starfall/shared";

const SHIPS = Number(process.argv[2] ?? 32);
// STARFALL_BROADPHASE=brute — повний перебір, для таблиці «до/після».
if (process.env.STARFALL_BROADPHASE === "brute") World.useBruteForce();
const WARMUP = 300;
const STEPS = 2000;

const game = createGame({ seed: 1, config: { asteroidLimit: 12 } });
game.world.despawn(game.ship);
game.world.step(0);

const input = { left: false, right: true, thrust: true, brake: false, fire: true };
for (let i = 0; i < SHIPS; i += 1) {
  const angle = (i / SHIPS) * Math.PI * 2;
  const ship = new Ship({
    pos: new Vector2(
      WORLD.width / 2 + Math.cos(angle) * 300,
      WORLD.height / 2 + Math.sin(angle) * 250,
    ),
  });
  ship.controller = () => input;
  // Невразливі: інакше боти перестріляють одне одного за кілька секунд,
  // і замір покаже вартість кроку в порожньому світі, а не під навантаженням.
  ship.invulnerableFor = Number.MAX_SAFE_INTEGER;
  game.world.add(ship);
}

for (let i = 0; i < WARMUP; i += 1) game.step(TICK_DT);

const samples = new Float64Array(STEPS);
for (let i = 0; i < STEPS; i += 1) {
  const t0 = performance.now();
  game.step(TICK_DT);
  samples[i] = performance.now() - t0;
}

const sorted = Array.from(samples).sort((a, b) => a - b);
const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

let entities = 0;
for (const _ of game.world) entities += 1;

console.log(
  JSON.stringify({
    ships: SHIPS,
    entities,
    avgMs: +avg.toFixed(4),
    p50: +pick(0.5).toFixed(4),
    p95: +pick(0.95).toFixed(4),
    p99: +pick(0.99).toFixed(4),
    maxMs: +sorted.at(-1).toFixed(4),
    collisionsLastStep: game.world.stats.collisions,
  }),
);
