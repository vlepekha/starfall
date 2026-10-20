/**
 * Три керовані поломки для розділу "Experiments" у README.
 * Кожна — окрема ілюстрація того, як працює event loop.
 */
export interface Experiment {
  readonly label: string;
  readonly description: string;
}

/**
 * Список режимів — джерело правди, тип виводиться з нього.
 * Так не можна забути додати режим в одне з двох місць.
 */
export const EXPERIMENT_MODES = ["none", "block", "interval", "variable"] as const;
export type ExperimentMode = (typeof EXPERIMENT_MODES)[number];

export const EXPERIMENTS: Record<ExperimentMode, Experiment> = {
  none: {
    label: "baseline (rAF + fixed step)",
    description: "Еталон: requestAnimationFrame + акумулятор.",
  },
  block: {
    label: "blocking work in frame",
    description: "Синхронний цикл на ~20 мс всередині кадру — блокує стек викликів.",
  },
  interval: {
    label: "setInterval(16) instead of rAF",
    description: "Цикл на таймері: task queue не синхронізована з кадрами екрана.",
  },
  variable: {
    label: "variable timestep",
    description: "dt = час між кадрами, без акумулятора.",
  },
};

/** Експеримент 1: зайняти головний потік чистими обчисленнями. */
export function burnMilliseconds(ms: number): number {
  const end = performance.now() + ms;
  let sink = 0;
  while (performance.now() < end) {
    sink += Math.sqrt(sink + 1);
  }
  return sink;
}
