import { describe, expect, test } from "vitest";
import { Match } from "../src/match.ts";

/**
 * Скільки кораблів бачить гравець у кімнаті.
 *
 * Цей тест з'явився після справжнього бага на живому сервері: гравець
 * заходив сам і бачив ДВА кораблі, другий стояв посеред арени й не
 * рухався. Це був «нічий» корабель із createGame — той, яким керують
 * у режимі одного гравця.
 *
 * Match намагався прибрати його через `world.despawn()`, але правила
 * одиночної гри відроджують такий корабель на наступному ж кроці:
 * для одиночної гри це правильно, для сервера — ні. Тому корабля
 * тепер не існує взагалі (`soloShip: false`).
 */
function shipsInWorld(match: Match): number {
  let ships = 0;
  for (const entity of match.game.world) if (entity.kind === "ship") ships += 1;
  return ships;
}

describe("кораблі в матчі", () => {
  test("порожній матч не має жодного корабля", () => {
    const match = new Match({ roomId: "t1", seed: 1 });
    expect(shipsInWorld(match)).toBe(0);
    match.stop();
  });

  test("один гравець — рівно один корабель", () => {
    const match = new Match({ roomId: "t2", seed: 1 });
    match.addPlayer("p1", "Pilot");
    expect(shipsInWorld(match)).toBe(1);
    match.stop();
  });

  /**
   * Головна перевірка: «нічий» корабель відроджувався не одразу, а за
   * кілька кроків — тому одного погляду після створення було мало.
   */
  test("після кількох секунд гри кораблів не побільшало", () => {
    const match = new Match({ roomId: "t3", seed: 1 });
    match.addPlayer("p1", "Pilot");

    // 150 кроків по 1/30 с — це п'ять секунд, удвічі більше за затримку
    // відродження.
    for (let i = 0; i < 150; i += 1) match.game.step(1 / 30);

    expect(shipsInWorld(match)).toBe(1);
    match.stop();
  });

  test("троє гравців — три кораблі", () => {
    const match = new Match({ roomId: "t4", seed: 1 });
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.addPlayer("c", "C");

    for (let i = 0; i < 150; i += 1) match.game.step(1 / 30);

    expect(shipsInWorld(match)).toBe(3);
    match.stop();
  });

  test("гравець вийшов — його корабель зник", () => {
    const match = new Match({ roomId: "t5", seed: 1 });
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.removePlayer("b");
    match.game.step(1 / 30);

    expect(shipsInWorld(match)).toBe(1);
    match.stop();
  });

  /** Астероїди при цьому мають з'являтися як і раніше. */
  test("астероїди на місці", () => {
    const match = new Match({ roomId: "t6", seed: 1 });
    let asteroids = 0;
    for (const entity of match.game.world) if (entity.kind === "asteroid") asteroids += 1;
    expect(asteroids).toBeGreaterThan(0);
    match.stop();
  });
});
