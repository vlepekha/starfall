/**
 * Service worker.
 *
 * Задача тут одна й вузька: щоб гра відкривалася з домашнього екрана
 * телефона миттєво й не падала, якщо мережа моргнула на старті.
 * Грати офлайн Starfall не може за визначенням — гру рахує сервер.
 *
 * Тому стратегії дві, і вони різні за призначенням:
 *   - навігація (сам HTML) — спершу мережа. Інакше після деплою
 *     гравець лишався б на старій версії, поки не почистить кеш;
 *   - статика зі збірки (JS, CSS, спрайти, звуки) — спершу кеш.
 *     Її імена містять хеш вмісту, тож стара версія просто не
 *     запитується, а нова завантажується один раз.
 *
 * /ws і /api не кешуються ніколи: це стан, а не файли.
 */

/** Версію підставляє збірка; будь-яка зміна очищає старий кеш. */
const VERSION = "v1";
const CACHE = `starfall-${VERSION}`;

/** Мінімум для першого екрана. Решта потрапляє в кеш у міру запитів. */
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  // addAll падає цілком, якщо хоч один файл не завантажився, тому
  // кладемо кожен окремо: краще неповний кеш, ніж зламана установка.
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      // Не чекаємо закриття старих вкладок: нова версія має стати
      // активною одразу після деплою.
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Чуже походження, сокети й API повз кеш — і повз нас узагалі.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return;
  if (url.pathname === "/health" || url.pathname === "/ready" || url.pathname === "/metrics") return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put("/", fresh.clone());
          return fresh;
        } catch {
          // Немає мережі — віддаємо збережену сторінку. Гра покаже
          // лобі й сама повідомить, що сервер недоступний.
          const cached = await caches.match("/");
          if (cached) return cached;
          throw new Error("офлайн і немає збереженої сторінки");
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      // Кешуємо лише вдалі відповіді: 404 у кеші жив би вічно.
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
