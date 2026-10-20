/**
 * Вимірювання кадру на клієнті.
 *
 * Використовує performance.mark/measure, а не власні лічильники: ті самі
 * мітки видно в Chrome DevTools у доріжці Timings, тож цифри звідси
 * і картинку з профайлера можна покласти поруч і звірити.
 */

export interface FrameReport {
  frames: number;
  seconds: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Кадри, довші за бюджет 16.7 мс. */
  overBudget: number;
  /**
   * Довгі паузи (> 50 мс). У браузері немає прямого доступу до пауз
   * збирача сміття, тому орієнтуємося на найнадійнішу ознаку:
   * кадр, що раптово став у кілька разів довшим за сусідні.
   */
  longPauses: number;
  longestPauseMs: number;
  /** Приріст купи за час заміру, якщо браузер його показує. */
  heapGrowthMb: number | null;
  updateP95: number;
  renderP95: number;
}

interface HeapCapableMemory {
  usedJSHeapSize: number;
}

const percentile = (sorted: number[], p: number): number =>
  sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0) : 0;

export function createPerfRecorder() {
  const frames: number[] = [];
  const updates: number[] = [];
  const renders: number[] = [];

  let recording = false;
  let startedAt = 0;
  let lastFrameAt = 0;
  let heapAtStart: number | null = null;

  const heap = (): number | null => {
    const memory = (performance as Performance & { memory?: HeapCapableMemory }).memory;
    return memory ? memory.usedJSHeapSize : null;
  };

  return {
    get recording() {
      return recording;
    },

    start(): void {
      frames.length = 0;
      updates.length = 0;
      renders.length = 0;
      recording = true;
      startedAt = performance.now();
      lastFrameAt = startedAt;
      heapAtStart = heap();
      performance.mark("starfall:capture-start");
    },

    /** Викликається на початку кроку симуляції. */
    markUpdateStart(): void {
      if (recording) performance.mark("starfall:update-start");
    },

    markUpdateEnd(): void {
      if (!recording) return;
      performance.mark("starfall:update-end");
      const measure = performance.measure(
        "starfall:update",
        "starfall:update-start",
        "starfall:update-end",
      );
      updates.push(measure.duration);
    },

    markRenderStart(): void {
      if (recording) performance.mark("starfall:render-start");
    },

    markRenderEnd(): void {
      if (!recording) return;
      performance.mark("starfall:render-end");
      const measure = performance.measure(
        "starfall:render",
        "starfall:render-start",
        "starfall:render-end",
      );
      renders.push(measure.duration);

      const now = performance.now();
      frames.push(now - lastFrameAt);
      lastFrameAt = now;
    },

    stop(): FrameReport {
      recording = false;
      performance.mark("starfall:capture-end");

      const seconds = (performance.now() - startedAt) / 1000;
      const sorted = [...frames].sort((a, b) => a - b);
      const sortedUpdates = [...updates].sort((a, b) => a - b);
      const sortedRenders = [...renders].sort((a, b) => a - b);

      // «Довга пауза» — кадр, утричі довший за медіану і понад 50 мс.
      const median = percentile(sorted, 0.5);
      const pauses = frames.filter((ms) => ms > 50 && ms > median * 3);

      const heapNow = heap();
      const growth =
        heapAtStart !== null && heapNow !== null
          ? +((heapNow - heapAtStart) / 1024 / 1024).toFixed(2)
          : null;

      const round = (value: number): number => +value.toFixed(2);

      return {
        frames: frames.length,
        seconds: +seconds.toFixed(1),
        fps: +(frames.length / seconds).toFixed(1),
        p50: round(median),
        p95: round(percentile(sorted, 0.95)),
        p99: round(percentile(sorted, 0.99)),
        max: round(sorted.at(-1) ?? 0),
        overBudget: frames.filter((ms) => ms > 16.7).length,
        longPauses: pauses.length,
        longestPauseMs: round(pauses.length ? Math.max(...pauses) : 0),
        heapGrowthMb: growth,
        updateP95: round(percentile(sortedUpdates, 0.95)),
        renderP95: round(percentile(sortedRenders, 0.95)),
      };
    },
  };
}
