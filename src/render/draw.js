import { WORLD } from "../sim/arena.js";
import { createCanvas } from "./canvas.js";

/**
 * Малювання. Налаштування canvas і DPR живуть у canvas.js — тут лише те,
 * ЩО малюємо.
 *
 * Важливо: рендер нічого не вирішує про симуляцію. Він отримує готовий
 * (уже проінтерпольований) стан і лише малює його.
 */
/** Корабель у світових одиницях ~25 од. — множник підбирався на око під арену 1600x900. */
const SHIP_SCALE = 1.5;

export function createRenderer(element) {
  const surface = createCanvas(element);
  const ctx = surface.ctx;
  let showVelocity = true;

  /** Детермінований псевдовипадковий шум — зірки не стрибають між перезапусками. */
  const noise = (i, seed) => {
    const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  // Три шари зірок різної яскравості — глибина без жодної текстури.
  const starLayers = [
    { count: 220, seed: 1, radius: 0.7, alpha: 0.28 },
    { count: 90, seed: 2, radius: 1.3, alpha: 0.5 },
    { count: 26, seed: 3, radius: 2.1, alpha: 0.85 },
  ].map((layer) => ({
    ...layer,
    stars: Array.from({ length: layer.count }, (_, i) => ({
      x: noise(i + 1, layer.seed) * WORLD.width,
      y: noise(i + 1, layer.seed + 10) * WORLD.height,
      r: layer.radius * (0.6 + noise(i + 1, layer.seed + 20) * 0.8),
    })),
  }));

  // Дві туманності — просто великі м'які радіальні градієнти.
  const nebulas = [
    { x: 340, y: 250, r: 460, color: "56, 110, 255" },
    { x: 1270, y: 660, r: 420, color: "168, 74, 220" },
  ];

  function drawBackground(time) {
    ctx.fillStyle = "#070a16";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    for (const n of nebulas) {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      g.addColorStop(0, `rgba(${n.color}, 0.16)`);
      g.addColorStop(0.55, `rgba(${n.color}, 0.05)`);
      g.addColorStop(1, `rgba(${n.color}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    }

    // Сітка арени — орієнтир для ока, щоб рух читався.
    ctx.strokeStyle = "rgba(126, 224, 255, 0.045)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 100; x < WORLD.width; x += 100) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD.height);
    }
    for (let y = 100; y < WORLD.height; y += 100) {
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.width, y);
    }
    ctx.stroke();

    for (const layer of starLayers) {
      ctx.fillStyle = `rgba(206, 226, 255, ${layer.alpha})`;
      for (const s of layer.stars) {
        // Дуже повільне "дихання" яскравості — рахується від часу рендера,
        // тому на симуляцію не впливає жодним чином.
        const twinkle = 0.75 + 0.25 * Math.sin(time * 0.0012 + s.x * 0.01);
        ctx.globalAlpha = twinkle;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawArenaFrame() {
    ctx.save();
    ctx.strokeStyle = "rgba(126, 224, 255, 0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, WORLD.width - 2, WORLD.height - 2);

    // Кутові маркери — акуратний "приладовий" вигляд межі.
    const arm = 46;
    ctx.strokeStyle = "rgba(126, 224, 255, 0.55)";
    ctx.lineWidth = 3;
    for (const [cx, cy, sx, sy] of [
      [0, 0, 1, 1],
      [WORLD.width, 0, -1, 1],
      [0, WORLD.height, 1, -1],
      [WORLD.width, WORLD.height, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawShip(ship, time, ghost) {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.scale(SHIP_SCALE, SHIP_SCALE);
    if (ghost) ctx.globalAlpha = 0.34;

    // Двигун: два конуси полум'я з пульсацією (тільки візуал).
    if (ship.thrusting) {
      const pulse = 0.82 + 0.18 * Math.sin(time * 0.045);
      const len = 34 * pulse;
      const flame = ctx.createLinearGradient(-16, 0, -16 - len, 0);
      flame.addColorStop(0, "rgba(255, 246, 214, 0.95)");
      flame.addColorStop(0.35, "rgba(255, 168, 66, 0.8)");
      flame.addColorStop(1, "rgba(255, 90, 40, 0)");
      ctx.fillStyle = flame;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-14, side * 3.5);
        ctx.lineTo(-16 - len, side * 1.5);
        ctx.lineTo(-14, side * 10);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowColor = "rgba(255, 150, 60, 0.75)";
      ctx.shadowBlur = 26;
      ctx.fillStyle = "rgba(255, 214, 150, 0.9)";
      ctx.beginPath();
      ctx.ellipse(-16, 0, 6 * pulse, 4.5 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Крила — темніші за корпус, дають силует.
    ctx.fillStyle = "#16203c";
    ctx.strokeStyle = "rgba(126, 224, 255, 0.45)";
    ctx.lineWidth = 1.6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(2, side * 5);
      ctx.lineTo(-10, side * 17);
      ctx.lineTo(-17, side * 15);
      ctx.lineTo(-12, side * 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Корпус: градієнт від носа до корми.
    const hull = ctx.createLinearGradient(24, 0, -18, 0);
    hull.addColorStop(0, "#e8f4ff");
    hull.addColorStop(0.45, "#8fb0d8");
    hull.addColorStop(1, "#243352");
    ctx.beginPath();
    ctx.moveTo(25, 0);
    ctx.lineTo(4, -9);
    ctx.lineTo(-15, -8);
    ctx.lineTo(-11, 0);
    ctx.lineTo(-15, 8);
    ctx.lineTo(4, 9);
    ctx.closePath();
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#9fe6ff";
    ctx.shadowColor = "rgba(126, 224, 255, 0.55)";
    ctx.shadowBlur = ghost ? 0 : 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Кабіна.
    const glass = ctx.createLinearGradient(12, -4, -2, 4);
    glass.addColorStop(0, "#bff3ff");
    glass.addColorStop(1, "#1d6fa8");
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(4, -4.5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(4, 4.5);
    ctx.closePath();
    ctx.fillStyle = glass;
    ctx.fill();

    // Носовий вогник.
    ctx.fillStyle = "#ff7a6b";
    ctx.beginPath();
    ctx.arc(22, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** Вектор швидкості — маленька службова підказка, добре читає фізику. */
  function drawVelocity(ship) {
    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed < 20) return;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.strokeStyle = "rgba(126, 224, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ship.vx * 0.12, ship.vy * 0.12);
    ctx.stroke();
    ctx.restore();
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(
      WORLD.width / 2,
      WORLD.height / 2,
      WORLD.height * 0.3,
      WORLD.width / 2,
      WORLD.height / 2,
      WORLD.width * 0.72,
    );
    g.addColorStop(0, "rgba(0, 0, 0, 0)");
    g.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }

  function render(ship) {
    const time = performance.now();

    surface.useScreenSpace();
    ctx.fillStyle = "#04060e";
    ctx.fillRect(0, 0, surface.cssWidth, surface.cssHeight);

    surface.useWorldSpace();
    drawBackground(time);
    if (showVelocity) drawVelocity(ship);

    // Малюємо корабель у 9 копіях (3x3): біля межі одразу видно двійника
    // з протилежного боку — візуальне підтвердження "загортання".
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const gx = ship.x + ox * WORLD.width;
        const gy = ship.y + oy * WORLD.height;
        if (gx < -60 || gx > WORLD.width + 60) continue;
        if (gy < -60 || gy > WORLD.height + 60) continue;
        drawShip({ ...ship, x: gx, y: gy }, time, ox !== 0 || oy !== 0);
      }
    }

    drawVignette();
    drawArenaFrame();
  }

  return {
    render,
    resize: surface.resize,
    /** Перемикається клавішею V — приклад дії-події, а не дії-стану. */
    toggleVelocity() {
      showVelocity = !showVelocity;
      return showVelocity;
    },
    get dpr() {
      return surface.dpr;
    },
  };
}
