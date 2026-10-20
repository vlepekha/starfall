/**
 * Фіксований крок симуляції + рендер з інтерполяцією.
 * Стаття-першоджерело: "Fix Your Timestep!" (Glenn Fiedler).
 *
 * Ідея: requestAnimationFrame викликає нас з частотою монітора (60/120/144 Гц),
 * але фізика має рахуватись рівно STEP_HZ разів на секунду. Тому різницю часу
 * між кадрами ми складаємо в акумулятор і "з'їдаємо" його цілими кроками.
 */
export interface LoopStats {
  stepsPerSecond: number;
  framesPerSecond: number;
  frameTimeMs: number;
  longestFrameMs: number;
  accumulatorMs: number;
  panics: number;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running?: boolean;
  readonly stats: LoopStats;
}

export interface LoopOptions {
  update: (dt: number) => void;
  render: (alpha: number) => void;
  stepHz?: number;
  maxFrameTime?: number;
  now?: () => number;
  schedule?: (cb: (timestamp: number) => void) => number;
  cancel?: (id: number) => void;
}

export function createLoop({
  update,
  render,
  stepHz = 60,
  maxFrameTime = 0.25,
  now = () => performance.now(),
  schedule = (cb) => requestAnimationFrame(cb),
  cancel = (id) => cancelAnimationFrame(id),
}: LoopOptions): Loop {
  const dt = 1 / stepHz;

  // Все, що нижче — у замиканні: зовні змінити ці значення напряму неможливо.
  let rafId: number | null = null;
  let running = false;
  let previous = 0;
  let accumulator = 0;

  // Лічильники для HUD.
  let steps = 0;
  let frames = 0;
  let statWindowStart = 0;
  let frameTimeMs = 0;
  let longestFrameMs = 0;
  const stats: LoopStats = {
    stepsPerSecond: 0,
    framesPerSecond: 0,
    frameTimeMs: 0,
    longestFrameMs: 0,
    accumulatorMs: 0,
    panics: 0,
  };

  function tick(timestamp: number): void {
    rafId = schedule(tick);

    let frameTime = (timestamp - previous) / 1000;
    previous = timestamp;

    // Захист від "спіралі смерті": якщо вкладка була згорнута або кадр
    // підвис на секунду — не намагаємось наздогнати 60 кроків одразу.
    if (frameTime > maxFrameTime) {
      frameTime = maxFrameTime;
      stats.panics += 1;
    }

    accumulator += frameTime;

    const frameStart = now();
    while (accumulator >= dt) {
      update(dt);
      accumulator -= dt;
      steps += 1;
    }

    // alpha ∈ [0,1) — наскільки ми "між" двома станами симуляції.
    render(accumulator / dt);
    frames += 1;

    frameTimeMs = now() - frameStart;
    if (frameTimeMs > longestFrameMs) longestFrameMs = frameTimeMs;

    if (timestamp - statWindowStart >= 1000) {
      const seconds = (timestamp - statWindowStart) / 1000;
      stats.stepsPerSecond = Math.round(steps / seconds);
      stats.framesPerSecond = Math.round(frames / seconds);
      stats.longestFrameMs = longestFrameMs;
      steps = 0;
      frames = 0;
      longestFrameMs = 0;
      statWindowStart = timestamp;
    }
    stats.frameTimeMs = frameTimeMs;
    stats.accumulatorMs = accumulator * 1000;
  }

  return {
    start() {
      if (running) return;
      running = true;
      previous = now();
      statWindowStart = previous;
      accumulator = 0;
      rafId = schedule(tick);
    },
    stop() {
      if (!running) return;
      running = false;
      if (rafId !== null) cancel(rafId);
      rafId = null;
    },
    get running() {
      return running;
    },
    stats,
  };
}
