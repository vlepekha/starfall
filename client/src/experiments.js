/**
 * Три керовані поломки для розділу "Experiments" у README.
 * Кожна — окрема ілюстрація того, як працює event loop.
 */
export const EXPERIMENTS = {
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
export function burnMilliseconds(ms) {
  const end = performance.now() + ms;
  let sink = 0;
  while (performance.now() < end) {
    sink += Math.sqrt(sink + 1);
  }
  return sink;
}
