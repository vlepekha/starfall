import { expect, test } from "@playwright/test";

/**
 * Перевірка, що гру справді можна встановити на телефон.
 *
 * Чому не проти dev-сервера: service worker навмисно вимкнений у
 * розробці (інакше він показував би вчорашній код). Тому тест іде
 * на вузол, який віддає ЗІБРАНОГО клієнта — тобто рівно те, що
 * потрапить у контейнер.
 */
const PROD = "http://127.0.0.1:8099";

test("манифест віддається з правильним типом і містить обидві іконки", async ({ request }) => {
  const response = await request.get(`${PROD}/manifest.webmanifest`);

  expect(response.status()).toBe(200);
  // Chrome ігнорує манифест із будь-яким іншим типом.
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = await response.json();
  expect(manifest.name).toBeTruthy();
  expect(manifest.start_url).toBe("/");

  const purposes = manifest.icons.map((icon: { purpose: string }) => icon.purpose);
  expect(purposes).toContain("any");
  // maskable потрібна Android: без неї іконку обріжуть по квадрату.
  expect(purposes).toContain("maskable");

  for (const icon of manifest.icons) {
    const file = await request.get(`${PROD}${icon.src}`);
    expect(file.status(), `іконка ${icon.src}`).toBe(200);
    expect(file.headers()["content-type"]).toContain("image/png");
  }
});

test("service worker реєструється й бере сторінку під контроль", async ({ page }) => {
  await page.goto(PROD);

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });

  expect(scope).toContain("127.0.0.1:8099");

  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state ?? null;
  });
  expect(state).toBe("activated");
});

test("service worker не чіпає /ws, /api і /health", async ({ page }) => {
  await page.goto(PROD);
  await page.evaluate(() => navigator.serviceWorker.ready);

  /**
   * Стан не можна кешувати: інакше після деплою клієнт показував би
   * список кімнат із минулого життя сервера, а /health брехав би
   * про версію.
   */
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const found: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) found.push(new URL(request.url).pathname);
    }
    return found;
  });

  expect(cached.some((path) => path.startsWith("/api/"))).toBe(false);
  expect(cached).not.toContain("/health");
  expect(cached).not.toContain("/metrics");
});
