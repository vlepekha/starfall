import assert from "node:assert/strict";
import { test } from "node:test";
import { createRng } from "../src/rng.ts";
import { createGame } from "../src/sim/rules.ts";
import type { InputState } from "../src/types.ts";
import { TICK_DT } from "../src/index.ts";

const HOLD: InputState = { left: false, right: true, thrust: true, brake: false, fire: true };

/**
 * «Хеш» стану світу: усе, що впливає на гру, зведене в один рядок.
 *
 * id сутностей свідомо НЕ входять до хешу. Лічильник Entity.#nextId
 * спільний на весь процес, тож друга симуляція в тому ж процесі
 * отримає інші номери — при однаковій фізиці до шостого знака.
 * Саме тому протокол передає id сервера: клієнт не може їх вгадати,
 * і не повинен.
 */
function hashWorld(game: ReturnType<typeof createGame>): string {
  const parts: string[] = [];
  for (const entity of game.world) {
    parts.push(
      [
        entity.kind,
        entity.pos.x.toFixed(6),
        entity.pos.y.toFixed(6),
        entity.vel.x.toFixed(6),
        entity.vel.y.toFixed(6),
        entity.angle.toFixed(6),
      ].join(":"),
    );
  }
  return `${game.world.rng.state}|${parts.sort().join("|")}`;
}

function run(seed: number, steps: number): string {
  const game = createGame({ seed });
  game.ship.controller = () => HOLD;
  for (let i = 0; i < steps; i += 1) game.step(TICK_DT);
  return hashWorld(game);
}

test("той самий seed і той самий вхід дають той самий стан", () => {
  assert.equal(run(1234, 300), run(1234, 300));
});

test("інший seed дає інший стан", () => {
  assert.notEqual(run(1234, 300), run(5678, 300));
});

test("генератор відтворюється зі збереженого стану", () => {
  const a = createRng(99);
  for (let i = 0; i < 10; i += 1) a.next();
  const saved = a.state;
  const expected = [a.next(), a.next(), a.next()];

  const b = createRng(1);
  b.state = saved;
  assert.deepEqual([b.next(), b.next(), b.next()], expected);
});

test("симуляція не використовує Math.random", () => {
  const original = Math.random;
  // Будь-яке звернення до Math.random у кроці — це розсинхрон клієнта
  // й сервера. Тут воно одразу падає, а не спливає через півгодини гри.
  Math.random = () => {
    throw new Error("Math.random у спільній симуляції заборонений");
  };
  try {
    const game = createGame({ seed: 7 });
    game.ship.controller = () => HOLD;
    for (let i = 0; i < 200; i += 1) game.step(TICK_DT);
  } finally {
    Math.random = original;
  }
});
