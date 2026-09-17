import { WORLD } from "../sim/arena.js";
import { Explosion } from "../sim/explosion.js";
import { getAsteroidSprite } from "./asteroid-sprite.js";
import { createCanvas } from "./canvas.js";

/**
 * Малювання світу. Налаштування canvas і DPR живуть у canvas.js —
 * тут лише те, ЩО малюємо.
 *
 * Важливо: рендер нічого не вирішує про симуляцію. Він отримує готовий
 * стан і коефіцієнт інтерполяції, і лише малює.
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

  /** Лінійна інтерполяція позиції між двома кроками симуляції (з лаби 1). */
  function lerpPosition(entity, alpha) {
    const a = entity.previousPos ?? entity.pos;
    const b = entity.pos;
    const lerp = (from, to, max) => {
      let delta = to - from;
      if (delta > max / 2) delta -= max;
      if (delta < -max / 2) delta += max;
      let value = from + delta * alpha;
      if (value < 0) value += max;
      if (value >= max) value -= max;
      return value;
    };
    return { x: lerp(a.x, b.x, WORLD.width), y: lerp(a.y, b.y, WORLD.height) };
  }

  /**
   * Інтерполяція кута найкоротшим шляхом. Без нормалізації різниці
   * корабель, що перейшов через 180°, робив би повний оберт у зворотний бік
   * за один кадр.
   */
  function lerpAngle(entity, alpha) {
    const from = entity.previousAngle ?? entity.angle;
    let delta = entity.angle - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta * alpha;
  }

  function drawShip(ship, x, y, time, ghost, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(SHIP_SCALE, SHIP_SCALE);
    // Після респауну корабель кілька секунд невразливий — блимає.
    const blink = ship.invulnerable && Math.floor(time / 110) % 2 === 0;
    ctx.globalAlpha = ghost ? 0.34 : blink ? 0.35 : 1;

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
    }

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
    ctx.stroke();

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

    ctx.fillStyle = "#ff7a6b";
    ctx.beginPath();
    ctx.arc(22, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBullet(bullet, x, y, _time, ghost, angle) {
    ctx.save();
    ctx.globalAlpha = ghost ? 0.3 : 1;
    ctx.translate(x, y);
    // Самонавідна куля інша на вигляд — гравець має бачити, що бонус працює.
    const colour = bullet.homingEnabled ? "#b388ff" : "#9fe6ff";
    ctx.rotate(angle);
    const trail = ctx.createLinearGradient(2, 0, -16, 0);
    trail.addColorStop(0, colour);
    trail.addColorStop(1, "rgba(159, 230, 255, 0)");
    ctx.fillStyle = trail;
    ctx.fillRect(-16, -1.6, 18, 3.2);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(2, 0, bullet.radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Астероїд: готовий спрайт із asteroid-sprite.js, повернутий на свій кут.
   * Увесь рельєф намальований один раз при появі каменя — кадр лише
   * виводить картинку, тому деталізація не коштує часу кадру.
   */
  function drawAsteroid(asteroid, x, y, _time, ghost, angle) {
    const sprite = getAsteroidSprite(asteroid);
    ctx.save();
    ctx.globalAlpha = ghost ? 0.3 : 1;
    ctx.translate(x, y);

    // Тінь під каменем малюється до повороту — вона «лежить» на площині
    // і не має крутитися разом із самим астероїдом.
    const shadow = ctx.createRadialGradient(
      asteroid.radius * 0.16,
      asteroid.radius * 0.2,
      asteroid.radius * 0.2,
      asteroid.radius * 0.16,
      asteroid.radius * 0.2,
      asteroid.radius * 1.15,
    );
    shadow.addColorStop(0, "rgba(0, 0, 0, 0.5)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(
      -asteroid.radius * 1.4,
      -asteroid.radius * 1.4,
      asteroid.radius * 2.8,
      asteroid.radius * 2.8,
    );

    if (asteroid.hunting) {
      ctx.shadowColor = "rgba(255, 110, 150, 0.45)";
      ctx.shadowBlur = 12;
    }

    ctx.rotate(angle);
    ctx.drawImage(sprite.canvas, -sprite.half, -sprite.half, sprite.half * 2, sprite.half * 2);
    ctx.restore();
  }

  function drawPickup(item, x, y, _time, ghost) {
    ctx.save();
    ctx.globalAlpha = ghost ? 0.3 : 1;
    ctx.translate(x, y);
    const pulse = 1 + 0.12 * Math.sin((item.phase ?? 0) * 4);
    ctx.scale(pulse, pulse);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "rgba(138, 255, 193, 0.18)";
    ctx.strokeStyle = "#8affc1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-11, -11, 22, 22);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = "#8affc1";
    ctx.font = "600 11px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.label === "+1 HP" ? "+" : "H", 0, 0.5);
    ctx.restore();
  }

  /** Вибух малюється як пучок власних частинок — без вкладених сутностей. */
  function drawExplosion(explosion) {
    ctx.save();
    ctx.fillStyle = explosion.color;
    for (const p of explosion.particles) {
      const fade = Explosion.fade(p);
      if (fade <= 0) continue;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4 * fade + 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Вектор швидкості — службова підказка, добре читає фізику. */
  function drawVelocity(ship, at) {
    const speed = ship.vel.length;
    if (speed < 20) return;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.strokeStyle = "rgba(126, 224, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ship.vel.x * 0.12, ship.vel.y * 0.12);
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

  /** Малює одну сутність у 9 копіях (3x3) — через «загортання» арени. */
  function drawWrapped(draw, pos, time) {
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const gx = pos.x + ox * WORLD.width;
        const gy = pos.y + oy * WORLD.height;
        if (gx < -80 || gx > WORLD.width + 80) continue;
        if (gy < -80 || gy > WORLD.height + 80) continue;
        draw(gx, gy, time, ox !== 0 || oy !== 0);
      }
    }
  }

  /**
   * Рендер отримує світ і коефіцієнт інтерполяції. Він НЕ питає у сутностей
   * їхній клас через instanceof — вистачає поля kind. Так рендер лишається
   * незалежним від дерева класів: з'явиться новий вид — тут один case.
   */
  function render(world, alpha = 1) {
    const time = performance.now();

    surface.useScreenSpace();
    ctx.fillStyle = "#04060e";
    ctx.fillRect(0, 0, surface.cssWidth, surface.cssHeight);

    surface.useWorldSpace();
    drawBackground(time);

    for (const entity of world) {
      const at = lerpPosition(entity, alpha);
      const angle = lerpAngle(entity, alpha);
      switch (entity.kind) {
        case "explosion":
          drawExplosion(entity);
          break;
        case "bullet":
          drawWrapped((x, y, t, ghost) => drawBullet(entity, x, y, t, ghost, angle), at, time);
          break;
        case "asteroid":
          drawWrapped((x, y, t, ghost) => drawAsteroid(entity, x, y, t, ghost, angle), at, time);
          break;
        case "pickup":
          drawWrapped((x, y, t, ghost) => drawPickup(entity, x, y, t, ghost), at, time);
          break;
        case "ship":
          if (showVelocity) drawVelocity(entity, at);
          drawWrapped((x, y, t, ghost) => drawShip(entity, x, y, t, ghost, angle), at, time);
          break;
        default:
          break;
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
