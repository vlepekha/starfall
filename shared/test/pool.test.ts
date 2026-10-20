import { describe, expect, test } from "vitest";
import { Pool } from "../src/sim/pool.ts";

describe("Pool", () => {
  test("перший виклик створює об'єкт", () => {
    const pool = new Pool(() => ({ value: 0 }));
    pool.take();
    expect(pool.stats.created).toBe(1);
    expect(pool.stats.reused).toBe(0);
  });

  test("повернутий об'єкт береться повторно, а не створюється", () => {
    const pool = new Pool(() => ({ value: 0 }));
    const first = pool.take();
    pool.release(first);
    const second = pool.take();

    expect(second).toBe(first);
    expect(pool.stats.created).toBe(1);
    expect(pool.stats.reused).toBe(1);
  });

  test("без повернення кожен виклик створює новий", () => {
    const pool = new Pool(() => ({ value: 0 }));
    for (let i = 0; i < 5; i += 1) pool.take();
    expect(pool.stats.created).toBe(5);
  });

  test("ліміт не дає пулу рости нескінченно", () => {
    const pool = new Pool(() => ({ value: 0 }), { limit: 3 });
    for (let i = 0; i < 10; i += 1) pool.release({ value: i });
    expect(pool.size).toBe(3);
    expect(pool.stats.released).toBe(10);
  });

  test("clear звільняє все", () => {
    const pool = new Pool(() => ({ value: 0 }));
    pool.release(pool.take());
    pool.clear();
    expect(pool.size).toBe(0);
  });

  test("за циклом «взяти-повернути» створюється рівно один об'єкт", () => {
    const pool = new Pool(() => ({ value: 0 }));
    for (let i = 0; i < 100; i += 1) {
      const item = pool.take();
      pool.release(item);
    }
    expect(pool.stats.created).toBe(1);
    expect(pool.stats.reused).toBe(99);
  });
});

import { Bullet, Explosion, Ship, Vector2, World } from "../src/index.ts";

describe("пули в грі", () => {
  test("відпрацьована куля повертається в пул і береться повторно", () => {
    const world = new World({ seed: 7 });
    const ship = world.add(new Ship({ pos: new Vector2(100, 100) }));
    (ship as Ship).fire(world);
    world.step(1 / 60);

    const before = Bullet.poolStats.reused;
    // Куля живе 1.4 с — проганяємо далі й даємо світу її прибрати.
    for (let i = 0; i < 120; i += 1) world.step(1 / 60);
    (ship as Ship).fire(world);
    world.step(1 / 60);

    expect(Bullet.poolStats.reused).toBeGreaterThan(before);
  });

  test("частинки вибуху повертаються в пул", () => {
    const world = new World({ seed: 7 });
    const explosion = world.add(Explosion.take({ pos: new Vector2(50, 50), rng: world.rng }));
    const released = Explosion.poolStats.particles.released;

    for (let i = 0; i < 120; i += 1) world.step(1 / 60);

    expect(explosion.alive).toBe(false);
    expect(Explosion.poolStats.particles.released).toBeGreaterThan(released);
  });

  test("куля з пулу отримує новий id", () => {
    const first = Bullet.take({ pos: new Vector2(1, 1) });
    const id = first.id;
    Bullet.release(first);
    const second = Bullet.take({ pos: new Vector2(2, 2) });

    expect(second).toBe(first);
    expect(second.id).not.toBe(id);
  });
});
