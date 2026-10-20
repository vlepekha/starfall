import { WORLD } from "./arena.js";
import { Asteroid } from "./asteroid.js";
import { findBehavior } from "./behaviors.js";
import { Bullet } from "./bullet.js";
import { defineCollision } from "./collision.js";
import { Explosion } from "./explosion.js";
import { Pickup } from "./pickup.js";
import { Ship } from "./ship.js";
import { Vector2 } from "./vector.js";
import { World } from "./world.js";

export const SCORE = { asteroid: 10, hunter: 25, pickup: 5 };

/**
 * Параметри арени. Приходять з assets/arena.json, а в лобі їх ще й
 * підкручує обраний режим кімнати (classic / dense / sparse).
 */
export const DEFAULT_CONFIG = {
  asteroidLimit: 12,
  pickupLimit: 2,
  asteroidInterval: [2.5, 4.5],
  pickupInterval: [9, 15],
};

const randomBetween = ([min, max]) => min + Math.random() * (max - min);
const RESPAWN_DELAY = 2; // секунди, за умовою лаби

/** Вибух: одна сутність із пучком частинок усередині. На рахунок не впливає. */
function explode(world, pos, options = {}) {
  world.spawn(new Explosion({ pos, ...options }));
  world.emit("exploded", { pos, big: (options.count ?? 14) >= 20 });
}

/**
 * Правила зіткнень живуть в одному місці. Додати новий вид сутності —
 * це дописати сюди рядок, а не лізти в саму систему зіткнень.
 */
function registerCollisionRules() {
  defineCollision("bullet", "asteroid", (bullet, asteroid, world) => {
    bullet.kill();
    asteroid.kill();
    for (const shard of asteroid.split()) world.spawn(shard);
    explode(world, asteroid.pos, { count: 10 + asteroid.size * 4 });
    world.stats.score += asteroid.hunting ? SCORE.hunter : SCORE.asteroid;
    world.emit("score", { amount: asteroid.hunting ? SCORE.hunter : SCORE.asteroid });
  });

  defineCollision("bullet", "ship", (bullet, ship, world) => {
    // Своя ж куля не шкодить власнику — інакше постріл уб'є стрільця
    // на першому ж кадрі, бо вона народжується біля носа.
    if (bullet.ownerId === ship.id) return;
    bullet.kill();
    ship.damage(1, world);
    explode(world, bullet.pos, { count: 6, color: "#7ee0ff", speed: 150 });
  });

  defineCollision("ship", "asteroid", (ship, asteroid, world) => {
    if (ship.invulnerable) return;
    asteroid.kill();
    explode(world, asteroid.pos, { count: 12 });
    ship.damage(1, world);
  });

  defineCollision("ship", "pickup", (ship, item, world) => {
    const behavior = findBehavior(item, "pickup");
    behavior?.apply(ship, world);
    item.kill();
    world.stats.score += SCORE.pickup;
    explode(world, item.pos, { count: 8, color: "#8affc1", speed: 120 });
    world.emit("pickup", { ship, label: item.label });
  });
}

registerCollisionRules();

const randomEdgePosition = () => {
  const onVertical = Math.random() < 0.5;
  return new Vector2(
    onVertical ? Math.random() * WORLD.width : Math.random() < 0.5 ? 0 : WORLD.width,
    onVertical ? (Math.random() < 0.5 ? 0 : WORLD.height) : Math.random() * WORLD.height,
  );
};

/**
 * Збирає гру: світ, корабель, стартові астероїди, таймери появи.
 * Повертає об'єкт із методом step(dt) — його і викликає ігровий цикл.
 */
export function createGame({ onEvent, bus, config = {} } = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };
  const world = new World({ bus });
  const ship = new Ship({ pos: new Vector2(WORLD.width / 2, WORLD.height / 2) });
  world.add(ship);

  let respawnTimer = 0;
  let asteroidTimer = 3;
  let pickupTimer = 6;

  for (const event of ["hit", "death", "score", "pickup", "fired", "exploded"]) {
    world.on(event, (payload) => onEvent?.(event, payload));
  }

  world.on("death", ({ entity }) => {
    if (entity !== ship) return;
    explode(world, entity.pos, { count: 26, color: "#ff6b7d", speed: 320 });
    respawnTimer = RESPAWN_DELAY;
  });

  function spawnAsteroid() {
    const pos = randomEdgePosition();
    const toCentre = pos
      .shortestDeltaTo(new Vector2(WORLD.width / 2, WORLD.height / 2))
      .normalize();
    const speed = 40 + Math.random() * 70;
    const hunter = Math.random() < 0.3;
    const options = { pos, vel: toCentre.scale(speed) };
    world.spawn(hunter ? Asteroid.hunter(options) : new Asteroid(options));
  }

  function spawnPickup() {
    const pos = new Vector2(
      120 + Math.random() * (WORLD.width - 240),
      120 + Math.random() * (WORLD.height - 240),
    );
    world.spawn(Math.random() < 0.5 ? Pickup.repair(pos) : Pickup.homingAmmo(pos));
  }

  for (let i = 0; i < 4; i += 1) spawnAsteroid();

  return {
    world,
    ship,
    get score() {
      return world.stats.score;
    },
    get respawnIn() {
      return respawnTimer;
    },

    step(dt) {
      // Респаун рівно через 2 секунди після смерті.
      if (!ship.alive) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) {
          ship.reset(new Vector2(WORLD.width / 2, WORLD.height / 2));
          world.add(ship);
          onEvent?.("respawn", { ship });
        }
      }

      asteroidTimer -= dt;
      if (asteroidTimer <= 0 && countOf(world, "asteroid") < settings.asteroidLimit) {
        asteroidTimer = randomBetween(settings.asteroidInterval);
        spawnAsteroid();
      }

      pickupTimer -= dt;
      if (pickupTimer <= 0 && countOf(world, "pickup") < settings.pickupLimit) {
        pickupTimer = randomBetween(settings.pickupInterval);
        spawnPickup();
      }

      world.step(dt);
    },

    reset() {
      world.clear();
      world.stats.score = 0;
      ship.reset(new Vector2(WORLD.width / 2, WORLD.height / 2));
      world.add(ship);
      for (let i = 0; i < 4; i += 1) spawnAsteroid();
    },
  };
}

function countOf(world, kind) {
  let n = 0;
  for (const _ of world.ofKind(kind)) n += 1;
  return n;
}

export { Asteroid, Bullet, Explosion, Pickup, Ship };
