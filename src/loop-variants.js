/**
 * "Неправильні" цикли — існують лише заради вимірювань у README.
 * У продакшн-коді так робити не треба, і нижче пояснено чому.
 */

/**
 * Експеримент 2: setInterval(16) замість rAF.
 * Колбек потрапляє в task queue незалежно від того, коли браузер
 * реально збирається малювати кадр. Результат: дрижання (jitter),
 * пропущені й здвоєні кадри, робота у фоновій вкладці зі здушеним таймером.
 */
export function createIntervalLoop({ update, render, stepHz = 60, intervalMs = 16 }) {
  const dt = 1 / stepHz;
  let id = null;
  let previous = 0;
  let accumulator = 0;
  let steps = 0;
  let frames = 0;
  let windowStart = 0;
  let longest = 0;
  const stats = {
    stepsPerSecond: 0,
    framesPerSecond: 0,
    frameTimeMs: 0,
    longestFrameMs: 0,
    accumulatorMs: 0,
    panics: 0,
  };

  function tick() {
    const timestamp = performance.now();
    accumulator += Math.min((timestamp - previous) / 1000, 0.25);
    previous = timestamp;

    const start = performance.now();
    while (accumulator >= dt) {
      update(dt);
      accumulator -= dt;
      steps += 1;
    }
    render(accumulator / dt);
    frames += 1;
    stats.frameTimeMs = performance.now() - start;
    if (stats.frameTimeMs > longest) longest = stats.frameTimeMs;

    if (timestamp - windowStart >= 1000) {
      const seconds = (timestamp - windowStart) / 1000;
      stats.stepsPerSecond = Math.round(steps / seconds);
      stats.framesPerSecond = Math.round(frames / seconds);
      stats.longestFrameMs = longest;
      steps = 0;
      frames = 0;
      longest = 0;
      windowStart = timestamp;
    }
    stats.accumulatorMs = accumulator * 1000;
  }

  return {
    start() {
      previous = performance.now();
      windowStart = previous;
      id = setInterval(tick, intervalMs);
    },
    stop() {
      clearInterval(id);
      id = null;
    },
    stats,
  };
}

/**
 * Експеримент 3: змінний крок.
 * update() отримує реальний час кадру. Симуляція перестає бути
 * детермінованою: на 144 Гц і на 60 Гц траєкторія різна, а один
 * довгий кадр здатен протягнути корабель крізь стіну (tunneling).
 */
export function createVariableLoop({ update, render, maxFrameTime = 0.25 }) {
  let rafId = null;
  let previous = 0;
  let steps = 0;
  let frames = 0;
  let windowStart = 0;
  let longest = 0;
  const stats = {
    stepsPerSecond: 0,
    framesPerSecond: 0,
    frameTimeMs: 0,
    longestFrameMs: 0,
    accumulatorMs: 0,
    panics: 0,
  };

  function tick(timestamp) {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min((timestamp - previous) / 1000, maxFrameTime);
    previous = timestamp;

    const start = performance.now();
    update(dt);
    steps += 1;
    render(1); // інтерполювати нічого: стан завжди "свіжий"
    frames += 1;
    stats.frameTimeMs = performance.now() - start;
    if (stats.frameTimeMs > longest) longest = stats.frameTimeMs;

    if (timestamp - windowStart >= 1000) {
      const seconds = (timestamp - windowStart) / 1000;
      stats.stepsPerSecond = Math.round(steps / seconds);
      stats.framesPerSecond = Math.round(frames / seconds);
      stats.longestFrameMs = longest;
      steps = 0;
      frames = 0;
      longest = 0;
      windowStart = timestamp;
    }
  }

  return {
    start() {
      previous = performance.now();
      windowStart = previous;
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(rafId);
      rafId = null;
    },
    stats,
  };
}
