import { beforeEach, describe, expect, test, vi } from "vitest";
import { Asteroid } from "../src/sim/asteroid.ts";
import { findBehavior, isPickupBehavior, ttl } from "../src/sim/behaviors.ts";
import { Bullet } from "../src/sim/bullet.ts";
import { Entity } from "../src/sim/entity.ts";
import { Explosion } from "../src/sim/explosion.ts";
import { Pickup } from "../src/sim/pickup.ts";
import { createGame } from "../src/sim/rules.ts";
import { Ship } from "../src/sim/ship.ts";
import { Vector2 } from "../src/sim/vector.ts";
import { World } from "../src/sim/world.ts";
import type { InputState } from "../src/types.ts";

const DT = 1 / 30;
const NONE: InputState = { left: false, right: false, thrust: false, brake: false, fire: false };

describe("World", () => {
  let world: World;

  beforeEach(() => {
    world = new World({ seed: 1 });
  });

  test("add кладе сутність одразу, spawn — у чергу до кінця кроку", () => {
    world.add(new Entity({ kind: "asteroid" }));
    expect(world.size).toBe(1);

    world.spawn(new Entity({ kind: "bullet" }));
    expect(world.size).toBe(1, "spawn не має додавати всередині кроку");

    world.step(DT);
    expect(world.size).toBe(2);
  });

  test("мертві прибираються в кінці кроку, а не одразу", () => {
    const entity = world.add(new Entity({ kind: "asteroid" }));
    entity.kill();
    expect(world.size).toBe(1);
    world.step(DT);
    expect(world.size).toBe(0);
  });

  test("ітерація віддає всі сутності", () => {
    world.add(new Entity({ kind: "ship" }));
    world.add(new Entity({ kind: "bullet" }));
    expect([...world].length).toBe(2);
  });

  test("ofKind — генератор, що фільтрує вид і мертвих", () => {
    world.add(new Entity({ kind: "asteroid" }));
    const dead = world.add(new Entity({ kind: "asteroid" }));
    world.add(new Entity({ kind: "bullet" }));
    dead.kill();
    expect([...world.ofKind("asteroid")].length).toBe(1);
  });

  test("nearestOfKind знаходить найближчу ціль", () => {
    const near = world.add(new Entity({ kind: "asteroid", pos: new Vector2(100, 0) }));
    world.add(new Entity({ kind: "asteroid", pos: new Vector2(400, 0) }));
    expect(world.nearestOfKind("asteroid", new Vector2(0, 0))?.id).toBe(near.id);
  });

  test("nearestOfKind поважає максимальну відстань", () => {
    world.add(new Entity({ kind: "asteroid", pos: new Vector2(500, 0) }));
    expect(world.nearestOfKind("asteroid", new Vector2(0, 0), 100)).toBeNull();
  });

  test("get і despawn за id", () => {
    const entity = world.add(new Entity({ kind: "ship" }));
    expect(world.get(entity.id)).toBe(entity);
    world.despawn(entity.id);
    expect(entity.alive).toBe(false);
  });

  test("on/emit доставляють подію з типізованим payload", () => {
    const handler = vi.fn();
    world.on("score", handler);
    world.emit("score", { amount: 10 });
    expect(handler).toHaveBeenCalledWith({ amount: 10 });
  });

  test("відписка працює", () => {
    const handler = vi.fn();
    const off = world.on("score", handler);
    off();
    world.emit("score", { amount: 10 });
    expect(handler).not.toHaveBeenCalled();
  });

  test("clear очищає світ", () => {
    world.add(new Entity({}));
    world.clear();
    expect(world.size).toBe(0);
  });

  test("крок рахує сутності й кроки", () => {
    world.add(new Entity({}));
    world.step(DT);
    expect(world.stats.steps).toBe(1);
    expect(world.stats.entities).toBe(1);
  });
});

describe("Поведінки", () => {
  test("ttl вбиває сутність після закінчення часу", () => {
    const world = new World({ seed: 1 });
    const entity = world.add(new Entity({ behaviors: [ttl(0.1)] }));
    world.step(0.05);
    expect(entity.alive).toBe(true);
    world.step(0.06);
    expect(entity.alive).toBe(false);
  });

  test("findBehavior знаходить за іменем", () => {
    const entity = new Entity({ behaviors: [ttl(1)] });
    expect(findBehavior(entity, "ttl")?.name).toBe("ttl");
    expect(findBehavior(entity, "homing")).toBeNull();
  });

  test("isPickupBehavior звужує тип", () => {
    const item = Pickup.repair(new Vector2(0, 0));
    expect(isPickupBehavior(findBehavior(item, "pickup"))).toBe(true);
    expect(isPickupBehavior(findBehavior(item, "ttl"))).toBe(false);
  });

  test("homing довертає кулю до цілі", () => {
    const world = new World({ seed: 1 });
    world.add(new Asteroid({ pos: new Vector2(100, 0), vel: Vector2.zero() }));
    const bullet = world.add(
      Bullet.homing({ pos: new Vector2(0, 0), vel: new Vector2(0, 300) }),
    );
    const before = Math.abs(bullet.vel.angle);
    for (let i = 0; i < 10; i += 1) world.step(DT);
    expect(Math.abs(bullet.vel.angle)).toBeLessThan(before);
  });

  test("spin обертає астероїд", () => {
    const world = new World({ seed: 1 });
    const rock = world.add(new Asteroid({ size: 2 }));
    const before = rock.angle;
    world.step(DT);
    expect(rock.angle).not.toBe(before);
  });
});

describe("Сутності", () => {
  test("id унікальні й зростають", () => {
    const a = new Entity({});
    const b = new Entity({});
    expect(b.id).toBeGreaterThan(a.id);
  });

  test("Ship: hp лише читається ззовні", () => {
    const ship = new Ship({});
    expect(ship.hp).toBe(3);
    expect(Object.keys(ship)).not.toContain("hp");
  });

  test("damage зменшує hp і вбиває на нулі", () => {
    const world = new World({ seed: 1 });
    const ship = world.add(new Ship({}));
    ship.damage(1, world);
    expect(ship.hp).toBe(2);
    ship.damage(5, world);
    expect(ship.hp).toBe(0);
    expect(ship.alive).toBe(false);
  });

  test("невразливий корабель не отримує урону", () => {
    const ship = new Ship({});
    ship.invulnerableFor = 1;
    ship.damage(1);
    expect(ship.hp).toBe(3);
  });

  test("heal не перевищує максимум", () => {
    const ship = new Ship({});
    ship.damage(1);
    expect(ship.heal(10)).toBe(3);
  });

  test("fire створює кулю і ставить кулдаун", () => {
    const world = new World({ seed: 1 });
    const ship = world.add(new Ship({}));
    expect(ship.fire(world)).not.toBeNull();
    expect(ship.fire(world)).toBeNull();
  });

  test("відірваний fire падає на приватному полі", () => {
    const world = new World({ seed: 1 });
    const ship = new Ship({});
    const detached = ship.fire;
    expect(() => detached(world)).toThrow(TypeError);
  });

  test("homing-боєприпас витрачається", () => {
    const world = new World({ seed: 1 });
    const ship = world.add(new Ship({}));
    ship.homingShots = 1;
    expect(ship.fire(world)?.homingEnabled).toBe(true);
    ship.update(0.5, world);
    expect(ship.homingShots).toBe(0);
  });

  test("Asteroid розпадається на два менші уламки", () => {
    const rock = new Asteroid({ size: 3, vel: new Vector2(10, 0) });
    const shards = rock.split();
    expect(shards.length).toBe(2);
    expect(shards[0]?.size).toBe(2);
  });

  test("найменший астероїд не розпадається", () => {
    expect(new Asteroid({ size: 1 }).split().length).toBe(0);
  });

  test("Asteroid.hunter має поведінку наведення", () => {
    const hunter = Asteroid.hunter({});
    expect(hunter.hunting).toBe(true);
    expect(findBehavior(hunter, "homing")).not.toBeNull();
  });

  test("Explosion живе, поки живі частинки", () => {
    const world = new World({ seed: 1 });
    const boom = world.add(new Explosion({ count: 4, lifetime: 0.4, rng: world.rng }));
    expect(boom.particles.length).toBe(4);
    for (let i = 0; i < 40; i += 1) world.step(DT);
    expect(boom.alive).toBe(false);
  });

  test("Pickup.repair лікує, Pickup.homingAmmo дає набої", () => {
    const ship = new Ship({});
    ship.damage(1);
    const world = new World({ seed: 1 });

    const repair = findBehavior(Pickup.repair(new Vector2(0, 0)), "pickup");
    if (isPickupBehavior(repair)) repair.apply(ship, world);
    expect(ship.hp).toBe(3);

    const ammo = findBehavior(Pickup.homingAmmo(new Vector2(0, 0)), "pickup");
    if (isPickupBehavior(ammo)) ammo.apply(ship, world);
    expect(ship.homingShots).toBe(12);
  });
});

describe("Правила гри", () => {
  test("куля знищує астероїд і дає очки", () => {
    const game = createGame({ seed: 5 });
    game.world.clear();
    game.world.add(game.ship);

    const rock = game.world.add(
      new Asteroid({ size: 2, pos: game.ship.pos.add(new Vector2(60, 0)), vel: Vector2.zero() }),
    );
    game.ship.angle = 0;
    game.ship.controller = () => ({ ...NONE, fire: true });

    for (let i = 0; i < 20; i += 1) game.step(DT);
    expect(rock.alive).toBe(false);
    expect(game.score).toBeGreaterThan(0);
  });

  test("зіткнення з астероїдом знімає одне HP", () => {
    const game = createGame({ seed: 5 });
    game.world.clear();
    game.world.add(game.ship);
    game.ship.invulnerableFor = 0;

    game.world.add(new Asteroid({ size: 2, pos: game.ship.pos, vel: Vector2.zero() }));
    game.step(DT);
    expect(game.ship.hp).toBe(2);
    expect(game.ship.alive).toBe(true);
  });

  test("корабель гине на нулі HP і відроджується рівно через 2 с", () => {
    const game = createGame({ seed: 5 });
    game.world.clear();
    game.world.add(game.ship);
    game.ship.invulnerableFor = 0;

    // Знімаємо все здоров'я, крім останнього, і віддаємо корабель астероїду.
    game.ship.damage(2, game.world);
    game.world.add(new Asteroid({ size: 2, pos: game.ship.pos, vel: Vector2.zero() }));
    game.step(DT);

    expect(game.ship.alive).toBe(false);
    expect(game.respawnIn).toBeGreaterThan(1.9);

    // 2 секунди при кроці 1/30 — це 60 тіків; беремо з запасом.
    for (let i = 0; i < 65; i += 1) game.step(DT);
    expect(game.ship.alive).toBe(true);
    expect(game.ship.hp).toBe(3);
  });

  test("власна куля не шкодить власнику", () => {
    const game = createGame({ seed: 5 });
    game.world.clear();
    game.world.add(game.ship);
    game.ship.invulnerableFor = 0;
    game.ship.controller = () => ({ ...NONE, fire: true });

    for (let i = 0; i < 10; i += 1) game.step(DT);
    expect(game.ship.hp).toBe(3);
  });

  test("reset повертає світ у початковий стан", () => {
    const game = createGame({ seed: 5 });
    for (let i = 0; i < 30; i += 1) game.step(DT);
    game.reset();
    expect(game.score).toBe(0);
    expect(game.ship.hp).toBe(3);
  });
});
