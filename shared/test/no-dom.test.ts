import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * shared/ має імпортуватися в Node так само, як у браузері.
 * Найпростіша перевірка цього — переконатися, що жодного браузерного
 * глобала просто немає, і при цьому пакет завантажується й працює.
 */
test("shared імпортується в Node без DOM", async () => {
  assert.equal(typeof globalThis.document, "undefined", "у Node немає document");
  assert.equal(typeof globalThis.window, "undefined", "у Node немає window");

  const shared = await import("../src/index.ts");

  assert.equal(typeof shared.createGame, "function");
  assert.equal(typeof shared.integrate, "function");
  assert.equal(shared.TICK_HZ, 30);

  const game = shared.createGame({ seed: 1 });
  game.step(shared.TICK_DT);
  assert.ok(game.world.stats.steps > 0, "крок симуляції виконався");
});

test("у коді shared немає звернень до DOM", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const forbidden = /\b(document|window|localStorage|requestAnimationFrame)\b/;
  const root = new URL("../src/", import.meta.url).pathname;

  async function* files(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) yield* files(full);
      else if (entry.name.endsWith(".ts")) yield full;
    }
  }

  for await (const file of files(root)) {
    const text = await readFile(file, "utf8");
    // Коментарі не рахуємо: там ці слова згадуються як пояснення.
    const code = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    assert.ok(!forbidden.test(code), `${file} звертається до DOM`);
  }
});
