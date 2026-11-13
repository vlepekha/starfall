import { expect, test } from "@playwright/test";

/**
 * Сервер зник посеред матчу — гравець має опинитися в лобі.
 *
 * Перевіряти це ботом не можна: питання саме про те, що БАЧИТЬ людина.
 * Тому справжній браузер і справжній матч.
 *
 * Сам сервер ми не вбиваємо — він спільний для всіх тестів. Обрив
 * імітуємо так, як він виглядає з боку клієнта при SIGKILL: сокет
 * закривається без кадру закриття, тобто код 1006 і жодного
 * попередження від сервера.
 *
 * Перехоплення WebSocket живе в тесті, а не в коді гри: тестовий
 * гачок у робочому коді — це те, що потім ніхто не наважиться прибрати.
 */
test("після обриву з'єднання гравець повертається в лобі", async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    const opened: WebSocket[] = [];
    (window as unknown as { __opened: WebSocket[] }).__opened = opened;

    class Recorded extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        opened.push(this);
      }
    }
    window.WebSocket = Recorded as unknown as typeof WebSocket;
  });

  await page.goto("/");

  // Лобі з'являється лише після завантаження ассетів.
  await expect(page.locator("#lobby-rooms li")).not.toHaveCount(0, { timeout: 20_000 });
  await page.fill("#lobby-name", "Тест");
  await page.locator("#lobby-rooms li", { hasText: "alpha" }).first().locator("button").click();

  // Вхід підтверджений сервером — матч справді почався.
  await expect(page.locator("#chat-state")).toHaveText("онлайн");
  await expect(page.locator(".stage")).toBeVisible();

  // Рвемо з'єднання зсередини сторінки, без кадру закриття.
  await page.evaluate(() => {
    const opened = (window as unknown as { __opened: WebSocket[] }).__opened;
    for (const socket of opened) {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
  });

  // Лобі має повернутися саме, без дій гравця.
  await expect(page.locator("#lobby")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#lobby-notice")).toContainText(/з'єднання/i);
});
