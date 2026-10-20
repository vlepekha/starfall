import type { Game } from "@starfall/shared";
import { el } from "../dom.ts";
import type { LoopStats } from "../loop.ts";

export interface Hud {
  update(stats: LoopStats, game: Game, modeLabel: string, timestamp: number): void;
}

const LABELS: Record<string, string> = {
  steps: "steps/s",
  frames: "frames/s",
  frame: "frame time",
  worst: "worst frame (1s)",
  acc: "accumulator",
  mode: "mode",
  score: "score",
  hp: "hull",
  entities: "entities",
  ammo: "homing ammo",
};

/** Порядок комірок у рядку HUD. */
const ORDER: string[] = [
  "score",
  "hp",
  "ammo",
  "entities",
  "steps",
  "frames",
  "frame",
  "worst",
  "acc",
  "mode",
];

export function createHud(root: HTMLElement): Hud {
  /**
   * Map, а не об'єкт: із `noUncheckedIndexedAccess` звичайне
   * `fields.score` вважається можливо-undefined, і кожен рядок
   * обростає знаками питання. Map із явним get() читається краще.
   */
  const fields = new Map<string, HTMLElement>();

  for (const key of ORDER) {
    const cell = document.createElement("div");
    cell.className = "hud__cell";
    cell.innerHTML = `<span class="hud__label"></span><span class="hud__value">—</span>`;
    el(".hud__label", cell).textContent = LABELS[key] ?? key;
    root.appendChild(cell);
    fields.set(key, el(".hud__value", cell));
  }

  let lastPaint = 0;

  return {
    /** HUD оновлюємо ~10 разів/с: 60 разів/с — зайва робота для layout. */
    update(stats: LoopStats, game: Game, modeLabel: string, timestamp: number): void {
      if (timestamp - lastPaint < 100) return;
      lastPaint = timestamp;

      const set = (key: string, text: string): void => {
        const node = fields.get(key);
        if (node) node.textContent = text;
      };
      const toggle = (key: string, className: string, on: boolean): void => {
        fields.get(key)?.classList.toggle(className, on);
      };

      const { ship, world } = game;

      set("score", String(world.stats.score));
      set(
        "hp",
        ship.alive
          ? `${"▮".repeat(ship.hp)}${"▯".repeat(ship.maxHp - ship.hp)}`
          : `respawn ${game.respawnIn.toFixed(1)}s`,
      );
      set("ammo", String(ship.homingShots));
      set("entities", String(world.stats.entities));

      set("steps", `${stats.stepsPerSecond} /s`);
      set("frames", `${stats.framesPerSecond} /s`);
      set("frame", `${stats.frameTimeMs.toFixed(2)} ms`);
      set("worst", `${stats.longestFrameMs.toFixed(2)} ms`);
      set("acc", `${stats.accumulatorMs.toFixed(2)} ms`);
      set("mode", modeLabel);

      toggle("steps", "is-bad", Math.abs(stats.stepsPerSecond - 60) > 3);
      toggle("hp", "is-bad", !ship.alive || ship.hp <= 1);
      toggle("ammo", "is-good", ship.homingShots > 0);
    },
  };
}
