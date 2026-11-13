/**
 * Запис відео-розбору проєкту.
 *
 * Playwright веде справжній браузер по живій адресі й записує вікно у
 * відео. Пояснення накладаються на сторінку як підписи — голосу тут
 * немає, і це свідомо: озвучку краще начитати людині поверх готового
 * запису (текст — у docs/video-script.md).
 *
 * Запуск:
 *   node tools/record-demo.mjs [адреса]
 *
 * Результат: docs/demo.webm (далі ffmpeg робить mp4).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const SITE = process.argv[2] ?? "https://starfall-rty8.onrender.com";
const ROOM = process.env.DEMO_ROOM ?? "quiet";
const OUT = resolve(import.meta.dirname, "../../docs/video");

/**
 * Підписи живуть у самій сторінці — інакше їх не було б у кадрі.
 *
 * Елементи створюються ЛІНИВО, на першому виклику: init-скрипт
 * Playwright виконується до розбору HTML, і `document.body` там ще
 * дорівнює null — перша версія цього коду саме на цьому й падала.
 */
const CAPTION_SCRIPT = () => {
  let caption = null;
  let chapter = null;

  function ensure() {
    if (caption || !document.body) return caption;

    const style = document.createElement("style");
    style.textContent = `
      #demo-caption {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 99999;
        padding: 22px 40px 26px;
        background: linear-gradient(transparent, rgba(4, 6, 14, 0.93) 38%);
        color: #e8eefc; font: 500 27px/1.4 ui-sans-serif, system-ui, sans-serif;
        text-align: center; pointer-events: none;
        opacity: 0; transition: opacity .35s ease;
      }
      #demo-caption.on { opacity: 1; }
      #demo-caption b { color: #7ee0ff; font-weight: 600; }
      #demo-chapter {
        position: fixed; right: 28px; top: 68px; z-index: 99999;
        padding: 7px 15px; border-radius: 999px;
        background: rgba(126, 224, 255, 0.14);
        border: 1px solid rgba(126, 224, 255, 0.4);
        color: #7ee0ff; font: 600 15px/1 ui-monospace, Menlo, monospace;
        letter-spacing: .06em; pointer-events: none;
        opacity: 0; transition: opacity .35s ease;
      }
      #demo-chapter.on { opacity: 1; }
    `;
    document.head.append(style);

    caption = document.createElement("div");
    caption.id = "demo-caption";
    chapter = document.createElement("div");
    chapter.id = "demo-chapter";
    document.body.append(caption, chapter);
    return caption;
  }

  Object.assign(window, {
    __say(html) {
      if (!ensure()) return;
      caption.innerHTML = html;
      caption.classList.toggle("on", Boolean(html));
    },
    __chapter(text) {
      if (!ensure()) return;
      chapter.textContent = text;
      chapter.classList.toggle("on", Boolean(text));
    },
  });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1600, height: 900 } },
    locale: "uk-UA",
  });
  await context.addInitScript(CAPTION_SCRIPT);
  const page = await context.newPage();

  /** Показати підпис і протримати його задану кількість секунд. */
  const say = async (html, seconds) => {
    await page.evaluate((h) => window.__say(h), html);
    await sleep(seconds * 1000);
  };
  const chapter = (text) => page.evaluate((t) => window.__chapter(t), text);
  const hold = (seconds) => sleep(seconds * 1000);

  /**
   * Живі числа з гри.
   *
   * Підпис, у якому стоїть справжній RTT цієї секунди, переконує
   * незрівнянно більше за «затримка стала більшою».
   */
  const netStats = () =>
    page.evaluate(() => {
      const s = window.starfall?.netcode?.stats ?? {};
      return {
        rtt: Math.round(s.rttMs ?? 0),
        correction: Number(s.correctionUnits ?? 0).toFixed(1),
        entities: s.entities ?? 0,
        snapshots: s.snapshotsPerSecond ?? 0,
      };
    });

  /** Політати: натискання приходять так само, як від людини. */
  async function fly(seconds, { fire = true } = {}) {
    const until = Date.now() + seconds * 1000;
    let turn = "ArrowRight";
    while (Date.now() < until) {
      await page.keyboard.down("KeyW");
      await page.keyboard.down(turn);
      if (fire) await page.keyboard.press("Space");
      await sleep(420);
      await page.keyboard.up(turn);
      turn = turn === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
    }
    await page.keyboard.up("KeyW");
  }

  /* --- 1. Що це таке ------------------------------------------- */
  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  await chapter("STARFALL");
  await say(
    "<b>Starfall</b> — мультиплеєрна аркада в реальному часі.<br>" +
      "Семестровий проєкт: вісім лабораторних, один репозиторій.",
    7,
  );
  await say(
    `Жива адреса: <b>${SITE.replace("https://", "")}</b><br>` +
      "Сервер у Франкфурті, образ Docker, деплой за тегом версії.",
    7,
  );

  await page.waitForSelector("#lobby-rooms li", { timeout: 60_000 });
  await say("Лобі. Кімнати приходять від сервера, реєструватися не треба.", 5);

  await page.fill("#lobby-name", "Pilot");
  await page.locator("#lobby-rooms li", { hasText: ROOM }).first().locator("button").click();
  await page.waitForSelector("#chat-state", { timeout: 30_000 });

  /* --- 2. Гра й передбачення ------------------------------------ */
  await chapter("ЛАБА 5 · МЕРЕЖА");
  await say("Гру рахує сервер — тридцять кроків на секунду.", 5);
  await fly(5);
  await say(
    "Але корабель слухається миттєво, бо клієнт <b>передбачає</b> свій рух<br>" +
      "і звіряє його зі знімком від сервера.",
    7,
  );
  await fly(6);

  const calm = await netStats();
  await say(
    `Праворуч netgraph. Зараз <b>RTT ${calm.rtt} мс</b> до Франкфурта,<br>` +
      `а поправка звірки — <b>${calm.correction} одиниці</b>: передбачення збігається з сервером.`,
    8,
  );
  await fly(5);

  /* --- 3. Другий гравець ---------------------------------------- */
  await chapter("КІЛЬКА ГРАВЦІВ");
  const room = await page
    .locator("#chat-room")
    .innerText()
    .catch(() => "");
  await say(
    `У кімнаті не ми одні${room ? ` — <b>${room.trim()}</b>` : ""}.<br>` +
      "Чужі кораблі приходять зі знімків від сервера.",
    6,
  );
  await fly(5);
  await say(
    "Їх ми показуємо з навмисною затримкою <b>100 мілісекунд</b>:<br>" +
      "свій намір ми знаємо, чужий — ні, тож краще правда з запізненням, ніж вигадка.",
    8,
  );
  await fly(6);

  /* --- 4. Вимикаємо передбачення -------------------------------- */
  await chapter("БЕЗ ПЕРЕДБАЧЕННЯ");
  await say("Тепер вимкнемо передбачення — і стане видно, навіщо воно.", 5);
  await page.uncheck("#net-predict");
  await fly(7);
  await say(
    "Корабель тепер чекає відповіді сервера на кожне натискання.<br>" +
      "Це та сама гра, та сама мережа — різниця лише в передбаченні.",
    7,
  );
  await page.check("#net-predict");
  await say("Вмикаємо назад.", 3);
  await fly(4);

  /* --- 5. Штучна затримка --------------------------------------- */
  await chapter("ЗАТРИМКА 300 МС");
  await say("А тепер найцікавіше: додамо до мережі <b>300 мілісекунд</b>.", 5);
  await page.locator("#net-latency").fill("300");
  await page.locator("#net-latency").dispatchEvent("input");
  await fly(8);
  const slow = await netStats();
  await say(
    `<b>RTT ${slow.rtt} мс</b> — гірше за будь-який реальний мобільний інтернет.<br>` +
      `А поправка звірки: <b>${slow.correction} одиниці</b>. Керування лишилося миттєвим.`,
    9,
  );
  await fly(6);
  await page.locator("#net-latency").fill("0");
  await page.locator("#net-latency").dispatchEvent("input");

  /* --- 6. Сервер головний --------------------------------------- */
  await chapter("СЕРВЕР ГОЛОВНИЙ");
  await say("Клієнт не може надіслати координати — у протоколі їх немає.", 5);
  await page.click("#net-cheat");
  await say(
    "Спроба чіту шле лише <b>наміри</b>: газ, поворот, вогонь.<br>" +
      "Куди через це поїде корабель, вирішує сервер.",
    7,
  );
  await hold(3);

  /* --- 7. Експлуатація ------------------------------------------ */
  await chapter("ЛАБА 8 · ХОСТИНГ");
  await page.goto(`${SITE}/health`, { waitUntil: "domcontentloaded" });
  await say(
    "<b>/health</b> — чи живий процес. Поле <b>sha</b> — комміт, з якого зібрано:<br>" +
      "єдиний спосіб з вулиці перевірити, що розгорнуто саме цю версію.",
    9,
  );

  await page.goto(`${SITE}/metrics`, { waitUntil: "domcontentloaded" });
  await say(
    "<b>/metrics</b> у форматі Prometheus: гравці, час кроку, пам'ять,<br>" +
      "і зайнятість циклу подій — її не видно ні в CPU, ні в часі кроку.",
    9,
  );
  await page.mouse.wheel(0, 700);
  await hold(4);

  /* --- 8. Підсумок ---------------------------------------------- */
  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  await chapter("ПІДСУМОК");
  await say(
    "Один процес тримає <b>128 гравців</b>: крок 6.8 мс при бюджеті 33.<br>" +
      "Впирається не процесор, а трафік — 10.5 МБ/с.",
    8,
  );
  await say(
    "У лабі 7 профіль показав, що 40% часу кроку їли не зіткнення,<br>" +
      "а створення векторів усередині них. Після виправлення — <b>2.25 → 0.58 мс</b>.",
    9,
  );
  await say("Код і всі заміри — у README репозиторію. Дякую.", 6);
  await say("", 1);

  await context.close();
  await browser.close();
  console.log(`відео збережене в ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
