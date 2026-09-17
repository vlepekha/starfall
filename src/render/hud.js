const LABELS = {
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
const ORDER = [
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

export function createHud(root) {
  const fields = {};
  for (const key of ORDER) {
    const cell = document.createElement("div");
    cell.className = "hud__cell";
    cell.innerHTML = `<span class="hud__label"></span><span class="hud__value">—</span>`;
    cell.querySelector(".hud__label").textContent = LABELS[key];
    root.appendChild(cell);
    fields[key] = cell.querySelector(".hud__value");
  }

  let lastPaint = 0;
  return {
    /** HUD оновлюємо ~10 разів/с: 60 разів/с це зайва робота для layout. */
    update(stats, game, modeLabel, timestamp) {
      if (timestamp - lastPaint < 100) return;
      lastPaint = timestamp;

      const { ship, world } = game;
      fields.score.textContent = String(world.stats.score);
      fields.hp.textContent = ship.alive
        ? `${"▮".repeat(ship.hp)}${"▯".repeat(ship.maxHp - ship.hp)}`
        : `respawn ${game.respawnIn.toFixed(1)}s`;
      fields.ammo.textContent = String(ship.homingShots ?? 0);
      fields.entities.textContent = String(world.stats.entities);

      fields.steps.textContent = `${stats.stepsPerSecond} /s`;
      fields.frames.textContent = `${stats.framesPerSecond} /s`;
      fields.frame.textContent = `${stats.frameTimeMs.toFixed(2)} ms`;
      fields.worst.textContent = `${stats.longestFrameMs.toFixed(2)} ms`;
      fields.acc.textContent = `${stats.accumulatorMs.toFixed(2)} ms`;
      fields.mode.textContent = modeLabel;

      fields.steps.classList.toggle("is-bad", Math.abs(stats.stepsPerSecond - 60) > 3);
      fields.hp.classList.toggle("is-bad", !ship.alive || ship.hp <= 1);
      fields.ammo.classList.toggle("is-good", (ship.homingShots ?? 0) > 0);
    },
  };
}
