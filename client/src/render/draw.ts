import type { Particle } from "@starfall/shared";
import { Explosion, WORLD } from "@starfall/shared";
import type { ViewEntity } from "../net/netcode.ts";
import { createCanvas } from "./canvas.ts";

interface Sheet {
  bitmap: ImageBitmap;
  frameWidth: number;
  frameHeight: number;
  originX: number;
  originY: number;
}

export interface RenderAssets {
  images: Map<string, Sheet>;
}

/** Підпис функції, що малює одну копію сутності. */
type DrawOne = (
  entity: ViewEntity,
  x: number,
  y: number,
  time: number,
  ghost: boolean,
  angle: number,
) => void;

interface Point {
  x: number;
  y: number;
}

/**
 * Малювання світу. Налаштування canvas і DPR живуть у canvas.js —
 * тут лише те, ЩО малюємо.
 *
 * Важливо: рендер нічого не вирішує про симуляцію. Він отримує готовий
 * стан і коефіцієнт інтерполяції, і лише малює.
 */
/** Один піксель спрайта = стільки світових одиниць. */
const SHIP_SPRITE_SCALE = 1.5;
const BULLET_SPRITE_SCALE = 1;

export function createRenderer(
  element: HTMLCanvasElement,
  { assets }: { assets?: RenderAssets } = {},
) {
  const sheets: Map<string, Sheet> = assets?.images ?? new Map();
  const surface = createCanvas(element);
  const ctx = surface.ctx;
  let showVelocity = true;

  /** Детермінований псевдовипадковий шум — зірки не стрибають між перезапусками. */
  const noise = (i: number, seed: number): number => {
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

  function drawBackground(time: number): void {
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

  function drawArenaFrame(): void {
    ctx.save();
    ctx.strokeStyle = "rgba(126, 224, 255, 0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, WORLD.width - 2, WORLD.height - 2);

    // Кутові маркери — акуратний "приладовий" вигляд межі.
    const arm = 46;
    ctx.strokeStyle = "rgba(126, 224, 255, 0.55)";
    ctx.lineWidth = 3;
    // Кортежі явно типізовані: інакше noUncheckedIndexedAccess
    // вважає кожен елемент можливо-undefined.
    const corners: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, 0, 1, 1],
      [WORLD.width, 0, -1, 1],
      [0, WORLD.height, 1, -1],
      [WORLD.width, WORLD.height, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Одна точка на весь рендер.
   *
   * Було: новий об'єкт і два замикання `lerp` на кожну сутність кожного
   * кадру — при 37 сутностях це 111 об'єктів за кадр лише тут.
   * Тепер координати пишуться в цю саму точку; вона читається одразу
   * ж, до наступного виклику, тому спільний стан безпечний.
   */
  const scratch: { x: number; y: number } = { x: 0, y: 0 };

  function lerpAxis(from: number, to: number, max: number, alpha: number): number {
    let delta = to - from;
    if (delta > max / 2) delta -= max;
    if (delta < -max / 2) delta += max;
    let value = from + delta * alpha;
    if (value < 0) value += max;
    if (value >= max) value -= max;
    return value;
  }

  /** Лінійна інтерполяція позиції між двома кроками симуляції (з лаби 1). */
  function lerpPosition(entity: ViewEntity, alpha: number): Point {
    const a = entity.previousPos ?? entity.pos;
    const b = entity.pos;
    scratch.x = lerpAxis(a.x, b.x, WORLD.width, alpha);
    scratch.y = lerpAxis(a.y, b.y, WORLD.height, alpha);
    return scratch;
  }

  /**
   * Інтерполяція кута найкоротшим шляхом. Без нормалізації різниці
   * корабель, що перейшов через 180°, робив би повний оберт у зворотний бік
   * за один кадр.
   */
  function lerpAngle(entity: ViewEntity, alpha: number): number {
    const from = entity.previousAngle ?? entity.angle;
    let delta = entity.angle - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta * alpha;
  }

  /**
   * Корабель зі спрайтшита. Кадр обирається за станом, а не за часом:
   * 0 — без тяги, 1-2 — тяга (чергуються), 3 — щойно отримав урон.
   */
  function drawShip(
    ship: ViewEntity,
    x: number,
    y: number,
    time: number,
    ghost: boolean,
    angle: number,
  ): void {
    const sheet = sheets.get("ships");
    if (!sheet) return;
    const frame = ship.invulnerable ? 3 : ship.thrusting ? 1 + (Math.floor(time / 70) % 2) : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const blink = ship.invulnerable && Math.floor(time / 110) % 2 === 0;
    ctx.globalAlpha = ghost ? 0.34 : blink ? 0.45 : 1;
    drawFrame(sheet, frame, SHIP_SPRITE_SCALE);
    ctx.restore();
  }

  /** Спільна частина: вирізати кадр зі шита й покласти його навколо origin. */
  function drawFrame(sheet: Sheet, frame: number, scale: number): void {
    const { bitmap, frameWidth, frameHeight, originX, originY } = sheet;
    ctx.drawImage(
      bitmap,
      frame * frameWidth,
      0,
      frameWidth,
      frameHeight,
      -originX * scale,
      -originY * scale,
      frameWidth * scale,
      frameHeight * scale,
    );
  }

  function drawBullet(
    bullet: ViewEntity,
    x: number,
    y: number,
    _time: number,
    ghost: boolean,
    angle: number,
  ): void {
    const sheet = sheets.get("bullets");
    if (!sheet) return;
    ctx.save();
    ctx.globalAlpha = ghost ? 0.3 : 1;
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Другий кадр — самонавідна: гравець має бачити, що бонус працює.
    drawFrame(sheet, bullet.homingEnabled ? 1 : 0, BULLET_SPRITE_SCALE);
    ctx.restore();
  }

  /**
   * Астероїд зі спрайтшита. Варіант обирається за id, тому камінь
   * виглядає однаково від появи до розпаду, а шість варіантів не дають
   * відчуття штампування.
   */
  function drawAsteroid(
    asteroid: ViewEntity,
    x: number,
    y: number,
    _time: number,
    ghost: boolean,
    angle: number,
  ): void {
    const sheet = sheets.get("asteroids");
    if (!sheet) return;
    const frame = asteroid.hunting ? 4 + (asteroid.id % 2) : asteroid.id % 4;
    // У спрайті камінь займає 42% кадру — звідси перерахунок у світові одиниці.
    const scale = asteroid.radius / (sheet.frameWidth * 0.42);

    ctx.save();
    ctx.globalAlpha = ghost ? 0.3 : 1;
    ctx.translate(x, y);

    // Тінь під каменем не обертається разом із ним: вона лежить на площині.
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
    drawFrame(sheet, frame, scale);
    ctx.restore();
  }

  function drawPickup(item: ViewEntity, x: number, y: number, _time: number, ghost: boolean): void {
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
  function drawExplosion(explosion: ViewEntity & { particles?: Particle[]; color?: string }): void {
    ctx.save();
    ctx.fillStyle = explosion.color ?? "#ffb648";
    for (const p of explosion.particles ?? []) {
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
  function drawVelocity(ship: ViewEntity, at: Point): void {
    const speed = Math.hypot(ship.vel.x, ship.vel.y);
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

  function drawVignette(): void {
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

  /**
   * Малює одну сутність у 9 копіях (3x3) — через «загортання» арени.
   *
   * Сутність і кут передаємо аргументами, а не через замикання: раніше
   * кожен виклик створював нову стрілочну функцію, тобто ще 37 об'єктів
   * за кадр.
   */
  function drawWrapped(
    draw: DrawOne,
    entity: ViewEntity,
    angle: number,
    pos: Point,
    time: number,
  ): void {
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const gx = pos.x + ox * WORLD.width;
        const gy = pos.y + oy * WORLD.height;
        if (gx < -80 || gx > WORLD.width + 80) continue;
        if (gy < -80 || gy > WORLD.height + 80) continue;
        draw(entity, gx, gy, time, ox !== 0 || oy !== 0, angle);
      }
    }
  }

  /**
   * Рендер отримує світ і коефіцієнт інтерполяції. Він НЕ питає у сутностей
   * їхній клас через instanceof — вистачає поля kind. Так рендер лишається
   * незалежним від дерева класів: з'явиться новий вид — тут один case.
   */
  function render(world: Iterable<ViewEntity>, alpha = 1): void {
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
          drawWrapped(drawBullet, entity, angle, at, time);
          break;
        case "asteroid":
          drawWrapped(drawAsteroid, entity, angle, at, time);
          break;
        case "pickup":
          drawWrapped(drawPickup, entity, angle, at, time);
          break;
        case "ship":
          if (showVelocity) drawVelocity(entity, at);
          drawWrapped(drawShip, entity, angle, at, time);
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
