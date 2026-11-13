import { monitorEventLoopDelay, performance } from "node:perf_hooks";

/**
 * Метрики процесу у форматі Prometheus.
 *
 * Чому текстовий формат Prometheus, а не свій JSON: у нас уже є
 * /api/stats із JSON для нашої ж панелі. /metrics потрібен іншому
 * читачеві — системі моніторингу, і вона очікує рівно цей формат.
 * Писати експозицію руками тут дешевше, ніж тягнути prom-client:
 * метрик дванадцять, а залежність лишилася б назавжди.
 */

export interface MetricsSources {
  /** Скільки гравців зараз у матчах. */
  players: () => number;
  rooms: () => number;
  connections: () => number;
  /** Повідомлень і байтів від старту — лічильники, не швидкості. */
  messagesIn: () => number;
  messagesOut: () => number;
  bytesIn: () => number;
  bytesOut: () => number;
  /** Час кроку симуляції по матчах, мс. */
  tickMs: () => { avg: number; p95: number };
  droppedInputs: () => number;
  closedByRateLimit: () => number;
  closedByOrigin: () => number;
  ready: () => boolean;
  /** Швидкості по ковзному вікну — див. createRateTracker. */
  messagesPerSecond: () => number;
  bytesInPerSecond: () => number;
  bytesOutPerSecond: () => number;
}

/**
 * Зайнятість циклу подій.
 *
 * `eventLoopUtilization` відповідає на питання, якого не видно ні в
 * CPU, ні в часі кроку: яка частка часу цикл подій узагалі щось
 * робив. 1.0 означає, що процес не встигає нічого — і це єдина
 * метрика, за якою видно, що пора додавати другий процес.
 */
export function createEventLoopProbe() {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  let last = performance.eventLoopUtilization();

  return {
    /** Частка 0..1 за час від попереднього виклику. */
    utilization(): number {
      const current = performance.eventLoopUtilization();
      const delta = performance.eventLoopUtilization(current, last);
      last = current;
      return +delta.utilization.toFixed(4);
    },
    /** Затримка циклу подій, мс. p99 тут важливіший за середнє. */
    delay(): { p50: number; p99: number; max: number } {
      return {
        p50: +(histogram.percentile(50) / 1e6).toFixed(2),
        p99: +(histogram.percentile(99) / 1e6).toFixed(2),
        max: +(histogram.max / 1e6).toFixed(2),
      };
    },
    reset(): void {
      histogram.reset();
    },
  };
}

/**
 * Швидкості — окремо від лічильників.
 *
 * За Prometheus правильно віддавати лічильники, а `rate()` рахує сам
 * запит. Але подивитися «скільки зараз повідомлень за секунду» треба
 * і без Prometheus — у тій же curl під час навантаження. Тому поруч
 * із `_total` є гейджі, пораховані по ковзному вікну.
 *
 * Вікно 10 с: менше — і число стрибає від одного знімка, більше —
 * і сплеск розмазується так, що його не видно.
 */
const WINDOW_SECONDS = 10;

export function createRateTracker(
  read: () => { messages: number; bytesIn: number; bytesOut: number },
) {
  interface Sample {
    at: number;
    messages: number;
    bytesIn: number;
    bytesOut: number;
  }

  const samples: Sample[] = [];
  const push = (): void => {
    const current = read();
    samples.push({ at: Date.now(), ...current });
    while (samples.length > WINDOW_SECONDS + 1) samples.shift();
  };

  /**
   * Першу вибірку НЕ беремо одразу — і це не дрібниця.
   *
   * `read()` тягнеться до ws-шару, який у index.ts оголошений нижче:
   * виклик під час створення падав із «Cannot access 'ws' before
   * initialization», і сервер не піднімався взагалі. Перша вибірка
   * тепер на першому тіку, коли все вже існує.
   *
   * unref(), щоб таймер не тримав процес живим під час зупинки.
   */
  const timer = setInterval(push, 1000);
  timer.unref();

  const rate = (pick: (s: Sample) => number): number => {
    const first = samples[0];
    const last = samples.at(-1);
    if (!first || !last || last.at === first.at) return 0;
    const seconds = (last.at - first.at) / 1000;
    return +((pick(last) - pick(first)) / seconds).toFixed(1);
  };

  return {
    messagesPerSecond: () => rate((s) => s.messages),
    bytesInPerSecond: () => rate((s) => s.bytesIn),
    bytesOutPerSecond: () => rate((s) => s.bytesOut),
    stop: () => clearInterval(timer),
  };
}

type Line = { name: string; help: string; type: "counter" | "gauge"; value: number };

/** Один рядок експозиції. Назви — за угодою Prometheus: snake_case з одиницями. */
function render({ name, help, type, value }: Line): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

export function renderMetrics(
  sources: MetricsSources,
  loop: ReturnType<typeof createEventLoopProbe>,
  startedAt: number,
): string {
  const memory = process.memoryUsage();
  const tick = sources.tickMs();
  const delay = loop.delay();

  const lines: Line[] = [
    {
      name: "starfall_up",
      help: "1, поки процес відповідає",
      type: "gauge",
      value: 1,
    },
    {
      name: "starfall_ready",
      help: "1, поки процес пускає нових гравців",
      type: "gauge",
      value: sources.ready() ? 1 : 0,
    },
    {
      name: "starfall_uptime_seconds",
      help: "Скільки процес живий",
      type: "gauge",
      value: Math.round((Date.now() - startedAt) / 1000),
    },
    {
      name: "starfall_players",
      help: "Гравців у матчах зараз",
      type: "gauge",
      value: sources.players(),
    },
    {
      name: "starfall_rooms",
      help: "Кімнат зараз",
      type: "gauge",
      value: sources.rooms(),
    },
    {
      name: "starfall_connections",
      help: "Відкритих WebSocket-з'єднань",
      type: "gauge",
      value: sources.connections(),
    },
    {
      name: "starfall_messages_in_total",
      help: "Повідомлень від клієнтів від старту",
      type: "counter",
      value: sources.messagesIn(),
    },
    {
      name: "starfall_messages_out_total",
      help: "Повідомлень клієнтам від старту",
      type: "counter",
      value: sources.messagesOut(),
    },
    {
      name: "starfall_bytes_in_total",
      help: "Байтів від клієнтів від старту",
      type: "counter",
      value: sources.bytesIn(),
    },
    {
      name: "starfall_bytes_out_total",
      help: "Байтів клієнтам від старту",
      type: "counter",
      value: sources.bytesOut(),
    },
    {
      name: "starfall_messages_per_second",
      help: "Повідомлень за секунду (ковзне вікно 10 с)",
      type: "gauge",
      value: sources.messagesPerSecond(),
    },
    {
      name: "starfall_bytes_in_per_second",
      help: "Вхідних байтів за секунду (ковзне вікно 10 с)",
      type: "gauge",
      value: sources.bytesInPerSecond(),
    },
    {
      name: "starfall_bytes_out_per_second",
      help: "Вихідних байтів за секунду (ковзне вікно 10 с)",
      type: "gauge",
      value: sources.bytesOutPerSecond(),
    },
    {
      name: "starfall_tick_ms_avg",
      help: "Середній час кроку симуляції по матчах",
      type: "gauge",
      value: tick.avg,
    },
    {
      name: "starfall_tick_ms_p95",
      help: "95-й процентиль часу кроку симуляції",
      type: "gauge",
      value: tick.p95,
    },
    {
      name: "starfall_dropped_inputs_total",
      help: "Відкинутих input-кадрів (черга переповнена)",
      type: "counter",
      value: sources.droppedInputs(),
    },
    {
      name: "starfall_closed_rate_limit_total",
      help: "З'єднань, закритих за перевищення частоти",
      type: "counter",
      value: sources.closedByRateLimit(),
    },
    {
      name: "starfall_closed_bad_origin_total",
      help: "Рукостискань, відхилених через Origin",
      type: "counter",
      value: sources.closedByOrigin(),
    },
    {
      name: "starfall_event_loop_utilization",
      help: "Частка часу, коли цикл подій був зайнятий (0..1)",
      type: "gauge",
      value: loop.utilization(),
    },
    {
      name: "starfall_event_loop_delay_p99_ms",
      help: "99-й процентиль затримки циклу подій",
      type: "gauge",
      value: delay.p99,
    },
    {
      name: "starfall_event_loop_delay_max_ms",
      help: "Максимальна затримка циклу подій",
      type: "gauge",
      value: delay.max,
    },
    {
      name: "starfall_memory_rss_bytes",
      help: "Resident set size",
      type: "gauge",
      value: memory.rss,
    },
    {
      name: "starfall_memory_heap_used_bytes",
      help: "Використана купа V8",
      type: "gauge",
      value: memory.heapUsed,
    },
  ];

  return lines.map(render).join("");
}
