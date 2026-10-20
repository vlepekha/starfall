import { expect, test, type Page } from "@playwright/test";

/**
 * Сценарій захисту: двоє в одній кімнаті бачать одне одного.
 *
 * Перевіряємо не «сторінка відкрилася», а дві речі, заради яких
 * написані лаби 4–5: рух одного клієнта доходить до другого, і чат
 * доходить теж.
 */

/** Імена кімнат приходять від сервера (server/src/index.ts), не з макета. */
const ROOM_ID = "alpha";

async function joinRoom(page: Page, name: string): Promise<void> {
  await page.goto("/");

  // Чекаємо, доки завантажаться ассети й з'явиться лобі.
  await expect(page.locator("#lobby-rooms li")).not.toHaveCount(0, { timeout: 20_000 });

  await page.fill("#lobby-name", name);
  const room = page.locator("#lobby-rooms li", { hasText: ROOM_ID }).first();
  await room.locator("button").click();

  // Вхід підтверджено сервером — у чаті з'явився рядок про це.
  await expect(page.locator("#chat-log")).toContainText(`ви увійшли як ${name}`);
  await expect(page.locator("#chat-state")).toHaveText("онлайн");
}

/** Позиція чужого корабля очима цього клієнта. */
async function remoteShipPosition(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const starfall = window.starfall as
      | { netcode?: { buildView(): { kind: string; mine?: boolean; pos: { x: number; y: number } }[] } }
      | undefined;
    const view = starfall?.netcode?.buildView() ?? [];
    const remote = view.find((entity) => entity.kind === "ship" && !entity.mine);
    return remote ? { x: remote.pos.x, y: remote.pos.y } : null;
  });
}

test("двоє в одній кімнаті: рух і чат доходять", async ({ browser }) => {
  // Два НЕЗАЛЕЖНІ контексти: окремі cookie, storage і сокети —
  // це справді два гравці, а не дві вкладки одного.
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const pageA = await alice.newPage();
  const pageB = await bob.newPage();

  try {
    await joinRoom(pageA, "Alice");
    await joinRoom(pageB, "Bob");

    // Кожен бачить, що в кімнаті вже двоє.
    await expect(pageA.locator("#chat-room")).toContainText("2/", { timeout: 10_000 });
    await expect(pageA.locator("#chat-log")).toContainText("Bob приєднався");

    // Другий клієнт бачить корабель першого.
    await expect.poll(() => remoteShipPosition(pageB), { timeout: 10_000 }).not.toBeNull();
    const before = await remoteShipPosition(pageB);
    expect(before).not.toBeNull();

    // Alice тисне газ і поворот.
    await pageA.locator("#arena").click({ position: { x: 10, y: 10 } });
    await pageA.keyboard.down("w");
    await pageA.keyboard.down("d");

    // Рух має дійти до Bob. Умова лаби — впродовж 500 мс;
    // беремо запас на старт браузера, але крок перевірки малий.
    await expect
      .poll(
        async () => {
          const now = await remoteShipPosition(pageB);
          if (!now || !before) return 0;
          return Math.hypot(now.x - before.x, now.y - before.y);
        },
        { timeout: 5_000, intervals: [100, 100, 100, 200] },
      )
      .toBeGreaterThan(20);

    await pageA.keyboard.up("w");
    await pageA.keyboard.up("d");

    // Чат в інший бік: від Bob до Alice.
    await pageB.fill("#chat-input", "бачу тебе");
    await pageB.press("#chat-input", "Enter");
    await expect(pageA.locator("#chat-log")).toContainText("Bob: бачу тебе", { timeout: 5_000 });

    // І назад, щоб переконатися, що канал двосторонній.
    await pageA.fill("#chat-input", "і я тебе");
    await pageA.press("#chat-input", "Enter");
    await expect(pageB.locator("#chat-log")).toContainText("Alice: і я тебе", { timeout: 5_000 });
  } finally {
    await alice.close();
    await bob.close();
  }
});

test("вихід із кімнати помітний іншому гравцеві", async ({ browser }) => {
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const pageA = await alice.newPage();
  const pageB = await bob.newPage();

  try {
    await joinRoom(pageA, "Alice");
    await joinRoom(pageB, "Bob");
    await expect(pageA.locator("#chat-log")).toContainText("Bob приєднався");

    await pageB.click("#leave");
    await expect(pageA.locator("#chat-log")).toContainText("Bob вийшов", { timeout: 10_000 });
  } finally {
    await alice.close();
    await bob.close();
  }
});
