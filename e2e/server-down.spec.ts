import { expect, test } from "@playwright/test";

/**
 * Зв'язок обірвався посеред матчу — гравець має опинитися в лобі.
 *
 * Це сценарій «сервер убили»: SIGKILL, впав контейнер, обірвалася
 * мережа. Від планової зупинки він відрізняється тим, що клієнт не
 * отримує НІЧОГО — ні повідомлення shutdown, ні коду 1001.
 *
 * Обрив робимо через перехоплення самого з'єднання
 * (`page.routeWebSocket`): Playwright проксує сокет до справжнього
 * сервера, матч іде як звичайно, а потім ми рвемо канал.
 *
 * Дві попередні спроби не працювали, і обидві повчальні:
 *   - закривати сокет зсередини сторінки через підмінений конструктор
 *     WebSocket — нестабільно: тест чіплявся до внутрішнього об'єкта
 *     застосунку й міг зловити не той екземпляр;
 *   - `context.setOffline(true)` — узагалі не рве вже встановлений
 *     WebSocket: сторінка продовжувала вважати, що вона онлайн.
 */
test("після обриву з'єднання гравець повертається в лобі", async ({ page }) => {
  let cut: (() => void) | null = null;

  await page.routeWebSocket("**/ws", (ws) => {
    // Проксуємо до справжнього сервера: нам потрібен справжній матч,
    // а не заглушка.
    ws.connectToServer();
    cut = () => ws.close();
  });

  await page.goto("/");

  await expect(page.locator("#lobby-rooms li")).not.toHaveCount(0, { timeout: 20_000 });
  await page.fill("#lobby-name", "Тест");
  await page.locator("#lobby-rooms li", { hasText: "alpha" }).first().locator("button").click();

  // Вхід підтверджений сервером — матч справді почався.
  await expect(page.locator("#chat-state")).toHaveText("онлайн");
  await expect(page.locator(".stage")).toBeVisible();

  expect(cut, "сокет не був перехоплений").not.toBeNull();
  cut?.();

  // Лобі має повернутися саме, без жодних дій гравця.
  await expect(page.locator(".stage")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("#lobby")).toBeVisible();
  await expect(page.locator("#lobby-notice")).toContainText(/з'єднання/i);
});
