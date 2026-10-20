import { WORLD } from "@starfall/shared";

/**
 * Налаштування canvas з урахуванням devicePixelRatio.
 *
 * Буфер тримаємо у ФІЗИЧНИХ пікселях, CSS-розмір — у логічних. Без цього
 * на Retina (dpr = 2) браузер розтягує вдвічі менший буфер, і все розмито.
 *
 * Два простори координат:
 *  - екранний (CSS-пікселі) — для суцільних заливок;
 *  - світовий (1600x900 арени) — для всього ігрового.
 * Перемикання між ними — єдине місце в коді, де є setTransform.
 */
export function createCanvas(element) {
  const ctx = element.getContext("2d", { alpha: false });
  let dpr = 1;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let cssWidth = 0;
  let cssHeight = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const rect = element.getBoundingClientRect();
    cssWidth = rect.width;
    cssHeight = rect.height;
    element.width = Math.round(rect.width * dpr);
    element.height = Math.round(rect.height * dpr);

    // Вписуємо арену в доступну область зі збереженням пропорцій.
    scale = Math.min(rect.width / WORLD.width, rect.height / WORLD.height);
    offsetX = (rect.width - WORLD.width * scale) / 2;
    offsetY = (rect.height - WORLD.height * scale) / 2;
  }

  resize();
  window.addEventListener("resize", resize);

  return {
    ctx,
    resize,
    useScreenSpace() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    useWorldSpace() {
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
    },
    get dpr() {
      return dpr;
    },
    get cssWidth() {
      return cssWidth;
    },
    get cssHeight() {
      return cssHeight;
    },
  };
}
