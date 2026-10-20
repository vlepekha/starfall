import { WORLD } from "./arena.ts";
import { Asteroid } from "./asteroid.ts";
import { findBehavior, isPickupBehavior } from "./behaviors.ts";
import { Bullet } from "./bullet.ts";
import { defineCollision } from "./collision.ts";
import type { Entity } from "./entity.ts";
import { Explosion } from "./explosion.ts";
import { Pickup } from "./pickup.ts";
import { Ship } from "./ship.ts";
import { Vector2 } from "./vector.ts";
import { type EventSink, World } from "./world.ts";

export const SCORE = { asteroid: 10, hunter: 25, pickup: 5 } as const;

export interface ArenaConfig {
  asteroidLimit: number;
  pickupLimit: number;
  asteroidInterval: readonly [number, number];
  pickupInterval: readonly [number, number];
}

export const DEFAULT_CONFIG: ArenaConfig = {
  asteroidLimit: 12,
  pickupLimit: 2,
  asteroidInterval: [2.5, 4.5],
  pickupInterval: [9, 15],
};

const RESPAWN_DELAY = 2;

const randomBetween = (world: World, [min, max]: readonly [number, number]): number =>
  min + world.rng.next() * (max - min);

/**
 * Перевірки, що звужують тип.
 *
 * Система зіткнень віддає Entity, а правилу потрібен конкретний клас.
 * `instanceof` тут не просто перевірка — для TypeScript це звуження
 * типу, тож далі по коду `asteroid.split()` вже коректний без `as`.
 */
const isAsteroid = (entity: Entity): entity is Asteroid => entity instanceof Asteroid;
const isShip = (entity: Entity): entity is Ship => entity instanceof Ship;
const isBullet = (entity: Entity): entity is Bullet => entity instanceof Bullet;

function explode(
  world: World,
  pos: Vector2,
  options: { count?: number; color?: string; speed?: number } = {},
): void {
  world.spawn(Explosion.take({ pos, rng: world.rng, ...options }));
  world.emit("exploded", { pos, big: (options.count ?? 14) >= 20 });
}

function registerCollisionRules(): void {
  defineCollision("bullet", "asteroid", (bullet, asteroid, world) => {
    if (!isAsteroid(asteroid) || !(world instanceof World)) return;
    bullet.kill();
    asteroid.kill();
    for (const shard of asteroid.split()) world.spawn(shard);
    explode(world, asteroid.pos, { count: 10 + asteroid.size * 4 });
    const amount = asteroid.hunting ? SCORE.hunter : SCORE.asteroid;
    world.stats.score += amount;
    world.emit("score", { amount });
  });

  defineCollision("bullet", "ship", (bullet, ship, world) => {
    if (!isBullet(bullet) || !isShip(ship) || !(world instanceof World)) return;
    // Своя ж куля не шкодить власнику: вона народжується біля носа.
    if (bullet.ownerId === ship.id) return;
    bullet.kill();
    ship.damage(1, world);
    explode(world, bullet.pos, { count: 6, color: "#7ee0ff", speed: 150 });
  });

  defineCollision("ship", "asteroid", (ship, asteroid, world) => {
    if (!isShip(ship) || !(world instanceof World)) return;
    if (ship.invulnerable) return;
    asteroid.kill();
    explode(world, asteroid.pos, { count: 12 });
    ship.damage(1, world);
  });

  defineCollision("ship", "pickup", (ship, item, world) => {
    if (!isShip(ship) || !(world instanceof World)) return;
    const behavior = findBehavior(item, "pickup");
    if (isPickupBehavior(behavior)) behavior.apply(ship, world);
    item.kill();
    world.stats.score += SCORE.pickup;
    world.emit("pickup", { ship, label: item instanceof Pickup ? item.label : "" });
  });
}

registerCollisionRules();

const randomEdgePosition = (world: World): Vector2 => {
  const onVertical = world.rng.chance(0.5);
  return new Vector2(
    onVertical ? world.rng.next() * WORLD.width : world.rng.chance(0.5) ? 0 : WORLD.width,
    onVertical ? (world.rng.chance(0.5) ? 0 : WORLD.height) : world.rng.next() * WORLD.height,
  );
};

export interface Game {
  readonly world: World;
  readonly ship: Ship;
  readonly score: number;
  readonly respawnIn: number;
  step(dt: number): void;
  reset(): void;
}

export interface GameOptions {
  onEvent?: (type: string, payload?: unknown) => void;
  bus?: EventSink | null;
  config?: Partial<ArenaConfig>;
  seed?: number;
}

export function createGame({ onEvent, bus, config = {}, seed = 1 }: GameOptions = {}): Game {
  const settings: ArenaConfig = { ...DEFAULT_CONFIG, ...config };
  const world = new World({ bus, seed });
  const ship = new Ship({ pos: new Vector2(WORLD.width / 2, WORLD.height / 2) });
  world.add(ship);

  let respawnTimer = 0;
  let asteroidTimer = 3;
  let pickupTimer = 6;

  const FORWARDED = ["hit", "death", "score", "pickup", "fired", "exploded"] as const;
  for (const event of FORWARDED) {
    world.on(event, (payload) => onEvent?.(event, payload));
  }

  world.on("death", ({ entity }) => {
    if (entity !== ship) return;
    explode(world, ship.pos, { count: 26, color: "#ff6b7d", speed: 320 });
    respawnTimer = RESPAWN_DELAY;
  });

  function spawnAsteroid(): void {
    const pos = randomEdgePosition(world);
    const toCentre = pos
      .shortestDeltaTo(new Vector2(WORLD.width / 2, WORLD.height / 2))
      .normalize();
    const speed = 40 + world.rng.next() * 70;
    const options = { pos, vel: toCentre.scale(speed) };
    world.spawn(world.rng.chance(0.3) ? Asteroid.hunter(options) : new Asteroid(options));
  }

  function spawnPickup(): void {
    const pos = new Vector2(
      120 + world.rng.next() * (WORLD.width - 240),
      120 + world.rng.next() * (WORLD.height - 240),
    );
    world.spawn(world.rng.chance(0.5) ? Pickup.repair(pos) : Pickup.homingAmmo(pos));
  }

  function countOf(kind: Parameters<World["ofKind"]>[0]): number {
    let n = 0;
    for (const _ of world.ofKind(kind)) n += 1;
    return n;
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

    step(dt: number): void {
      if (!ship.alive) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) {
          ship.reset(new Vector2(WORLD.width / 2, WORLD.height / 2));
          world.add(ship);
          onEvent?.("respawn", { ship });
        }
      }

      asteroidTimer -= dt;
      if (asteroidTimer <= 0 && countOf("asteroid") < settings.asteroidLimit) {
        asteroidTimer = randomBetween(world, settings.asteroidInterval);
        spawnAsteroid();
      }

      pickupTimer -= dt;
      if (pickupTimer <= 0 && countOf("pickup") < settings.pickupLimit) {
        pickupTimer = randomBetween(world, settings.pickupInterval);
        spawnPickup();
      }

      world.step(dt);
    },

    reset(): void {
      world.clear();
      world.stats.score = 0;
      ship.reset(new Vector2(WORLD.width / 2, WORLD.height / 2));
      world.add(ship);
      for (let i = 0; i < 4; i += 1) spawnAsteroid();
    },
  };
}

export { Asteroid, Bullet, Explosion, Pickup, Ship };
