import { expect, test } from "vitest";

/**
 * shared/ має імпортуватися в Node так само, як у браузері.
 * Найпростіша перевірка цього — переконатися, що жодного браузерного
 * глобала просто немає, і при цьому пакет завантажується й працює.
 */
test("shared імпортується в Node без DOM", async () => {
  expect(typeof globalThis.document).toBe("undefined", "у Node немає document");
  expect(typeof globalThis.window).toBe("undefined", "у Node немає window");

  const shared = await import("../src/index.ts");

  expect(typeof shared.createGame).toBe("function");
  expect(typeof shared.integrate).toBe("function");
  expect(shared.TICK_HZ).toBe(30);

  const game = shared.createGame({ seed: 1 });
  game.step(shared.TICK_DT);
  expect(game.world.stats.steps > 0, "крок симуляції виконався").toBeTruthy();
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
    expect(!forbidden.test(code), `${file} звертається до DOM`).toBeTruthy();
  }
});
