import { WORLD } from "@starfall/shared";
import { createCanvas } from "./canvas.js";

/**
 * Екран завантаження малюється на тому самому canvas, що й гра.
 * Прогрес справжній: сюди приходить частка завершених файлів із loadAll,
 * а не анімація «для вигляду».
 */
export function createLoadingScreen(element) {
  const surface = createCanvas(element);
  const ctx = surface.ctx;

  function draw({ ratio = 0, label = "", items = [], error = null }) {
    surface.useScreenSpace();
    ctx.fillStyle = "#04060e";
    ctx.fillRect(0, 0, surface.cssWidth, surface.cssHeight);

    surface.useWorldSpace();
    const cx = WORLD.width / 2;
    const cy = WORLD.height / 2;

    ctx.textAlign = "center";
    ctx.fillStyle = "#e6efff";
    ctx.font = "600 52px Inter, system-ui, sans-serif";
    ctx.fillText("STARFALL", cx, cy - 90);

    ctx.fillStyle = error ? "#ff6b7d" : "#8ba0c8";
    ctx.font = "400 22px ui-monospace, Menlo, monospace";
    ctx.fillText(error ? `збій: ${error}` : label, cx, cy - 46);

    // Смуга прогресу.
    const barWidth = 620;
    const barHeight = 14;
    const x = cx - barWidth / 2;
    const y = cy - 6;
    ctx.fillStyle = "rgba(126, 224, 255, 0.12)";
    ctx.fillRect(x, y, barWidth, barHeight);
    const fill = ctx.createLinearGradient(x, 0, x + barWidth, 0);
    fill.addColorStop(0, "#7ee0ff");
    fill.addColorStop(1, "#a98cff");
    ctx.fillStyle = error ? "#ff6b7d" : fill;
    ctx.fillRect(x, y, barWidth * Math.min(1, Math.max(0, ratio)), barHeight);
    ctx.strokeStyle = "rgba(126, 224, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, barWidth - 1, barHeight - 1);

    ctx.fillStyle = "#8ba0c8";
    ctx.font = "400 18px ui-monospace, Menlo, monospace";
    ctx.fillText(`${Math.round(ratio * 100)}%`, cx, y + barHeight + 34);

    // Список файлів: видно, що саме їде паралельно.
    ctx.font = "400 16px ui-monospace, Menlo, monospace";
    items.forEach((item, i) => {
      const row = y + barHeight + 72 + i * 24;
      ctx.textAlign = "right";
      ctx.fillStyle = item.value >= 1 ? "#8affc1" : "#5d719c";
      ctx.fillText(item.value >= 1 ? "✓" : "…", cx - 12, row);
      ctx.textAlign = "left";
      ctx.fillStyle = item.value >= 1 ? "#dce6ff" : "#5d719c";
      ctx.fillText(item.id, cx + 12, row);
    });
    ctx.textAlign = "left";
  }

  return { draw, resize: surface.resize };
}
