export function createHud(root) {
  const fields = {};
  for (const key of ["steps", "frames", "frame", "worst", "acc", "speed", "mode"]) {
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
    update(stats, ship, modeLabel, timestamp) {
      if (timestamp - lastPaint < 100) return;
      lastPaint = timestamp;
      fields.steps.textContent = `${stats.stepsPerSecond} /s`;
      fields.frames.textContent = `${stats.framesPerSecond} /s`;
      fields.frame.textContent = `${stats.frameTimeMs.toFixed(2)} ms`;
      fields.worst.textContent = `${stats.longestFrameMs.toFixed(2)} ms`;
      fields.acc.textContent = `${stats.accumulatorMs.toFixed(2)} ms`;
      fields.speed.textContent = `${Math.round(Math.hypot(ship.vx, ship.vy))} u/s`;
      fields.mode.textContent = modeLabel;
      fields.steps.classList.toggle("is-bad", Math.abs(stats.stepsPerSecond - 60) > 3);
    },
  };
}

const LABELS = {
  steps: "steps/s",
  frames: "frames/s",
  frame: "frame time",
  worst: "worst frame (1s)",
  acc: "accumulator",
  speed: "speed",
  mode: "mode",
};
