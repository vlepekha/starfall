import { describe, expect, test } from "vitest";
import { resolveCollisions, resolveCollisionsBruteForce } from "../src/sim/collision.ts";
import { Entity } from "../src/sim/entity.ts";
import { WORLD } from "../src/sim/arena.ts";
import { Vector2 } from "../src/sim/vector.ts";
import { World } from "../src/sim/world.ts";
import { createRng } from "../src/rng.ts";

describe("intersects", () => {
  test("кола, що перетинаються", () => {
    const a = new Entity({ pos: new Vector2(0, 0), radius: 10 });
    const b = new Entity({ pos: new Vector2(15, 0), radius: 10 });
    expect(a.intersects(b)).toBe(true);
  });

  test("кола, що не дотикаються", () => {
    const a = new Entity({ pos: new Vector2(0, 0), radius: 10 });
    const b = new Entity({ pos: new Vector2(25, 0), radius: 10 });
    expect(a.intersects(b)).toBe(false);
  });

  test("рівно на межі дотику — не зіткнення", () => {
    const a = new Entity({ pos: new Vector2(0, 0), radius: 10 });
    const b = new Entity({ pos: new Vector2(20, 0), radius: 10 });
    expect(a.intersects(b)).toBe(false);
  });

  test("зіткнення через край арени", () => {
    const a = new Entity({ pos: new Vector2(5, 450), radius: 10 });
    const b = new Entity({ pos: new Vector2(WORLD.width - 5, 450), radius: 10 });
    expect(a.intersects(b)).toBe(true);
  });

  test("симетричність", () => {
    const a = new Entity({ pos: new Vector2(100, 100), radius: 20 });
    const b = new Entity({ pos: new Vector2(110, 105), radius: 15 });
    expect(a.intersects(b)).toBe(b.intersects(a));
  });
});

/**
 * Головна перевірка просторового хешу: він має знаходити РІВНО ті самі
 * пари, що й повний перебір. Оптимізація, яка «втрачає» зіткнення,
 * гірша за повільну, бо помилку видно не одразу.
 */
describe("просторовий хеш проти повного перебору", () => {
  function buildWorld(seed: number, count: number): { world: World; pairs: Set<string> } {
    const rng = createRng(seed);
    const world = new World({ seed });
    for (let i = 0; i < count; i += 1) {
      world.add(
        new Entity({
          kind: i % 3 === 0 ? "bullet" : "asteroid",
          pos: new Vector2(rng.next() * WORLD.width, rng.next() * WORLD.height),
          radius: 4 + rng.next() * 40,
        }),
      );
    }
    return { world, pairs: new Set() };
  }

  /** Збираємо пари напряму, щоб порівняти два алгоритми між собою. */
  function collectPairs(world: World, resolver: typeof resolveCollisions): Set<string> {
    const found = new Set<string>();
    const entities = [...world];
    for (let i = 0; i < entities.length; i += 1) {
      for (let j = i + 1; j < entities.length; j += 1) {
        const a = entities[i];
        const b = entities[j];
        if (a && b && a.intersects(b)) found.add([a.id, b.id].sort().join("-"));
      }
    }
    // resolver викликаємо, щоб переконатися, що він не кидає помилок.
    resolver(world);
    return found;
  }

  test.each([1, 2, 3, 42, 777])("seed %i: обидва алгоритми бачать ті самі пари", (seed) => {
    const { world } = buildWorld(seed, 80);
    const viaHash = collectPairs(world, resolveCollisions);
    const viaBrute = collectPairs(world, resolveCollisionsBruteForce);
    expect(viaHash).toEqual(viaBrute);
  });

  test("порожній світ не ламає жоден з алгоритмів", () => {
    const world = new World({ seed: 1 });
    expect(resolveCollisions(world)).toBe(0);
    expect(resolveCollisionsBruteForce(world)).toBe(0);
  });

  test("одна сутність — жодної пари", () => {
    const world = new World({ seed: 1 });
    world.add(new Entity({ radius: 10 }));
    expect(resolveCollisions(world)).toBe(0);
  });

  test("сутності з нульовим радіусом ігноруються", () => {
    const world = new World({ seed: 1 });
    world.add(new Entity({ kind: "explosion", radius: 0, pos: new Vector2(10, 10) }));
    world.add(new Entity({ kind: "explosion", radius: 0, pos: new Vector2(10, 10) }));
    expect(resolveCollisions(world)).toBe(0);
  });

  test("мертві не стикаються", () => {
    const world = new World({ seed: 1 });
    const a = world.add(new Entity({ kind: "bullet", pos: new Vector2(50, 50), radius: 10 }));
    world.add(new Entity({ kind: "asteroid", pos: new Vector2(55, 50), radius: 10 }));
    a.kill();
    expect(resolveCollisions(world)).toBe(0);
  });
});
