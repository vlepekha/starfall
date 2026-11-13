import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { createEventLoopProbe, type MetricsSources, renderMetrics } from "../src/metrics.ts";

function sources(overrides: Partial<MetricsSources> = {}): MetricsSources {
  return {
    players: () => 3,
    rooms: () => 2,
    connections: () => 4,
    messagesIn: () => 1200,
    messagesOut: () => 3400,
    bytesIn: () => 56_000,
    bytesOut: () => 890_000,
    tickMs: () => ({ avg: 0.7, p95: 1.2 }),
    droppedInputs: () => 5,
    closedByRateLimit: () => 1,
    closedByOrigin: () => 2,
    ready: () => true,
    messagesPerSecond: () => 640,
    bytesInPerSecond: () => 12_800,
    bytesOutPerSecond: () => 98_000,
    ...overrides,
  };
}

describe("renderMetrics", () => {
  const probe = createEventLoopProbe();
  const body = renderMetrics(sources(), probe, Date.now() - 42_000);

  test("формат Prometheus: HELP, TYPE і значення для кожної метрики", () => {
    const names = [...body.matchAll(/^# TYPE (\S+) /gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(15);
    for (const name of names) {
      expect(body).toContain(`# HELP ${name} `);
      expect(body).toMatch(new RegExp(`^${name} -?[\\d.]+$`, "m"));
    }
  });

  test("віддає підключені джерела", () => {
    expect(body).toMatch(/^starfall_players 3$/m);
    expect(body).toMatch(/^starfall_rooms 2$/m);
    expect(body).toMatch(/^starfall_connections 4$/m);
    expect(body).toMatch(/^starfall_bytes_out_total 890000$/m);
    expect(body).toMatch(/^starfall_tick_ms_p95 1.2$/m);
    expect(body).toMatch(/^starfall_closed_bad_origin_total 2$/m);
    // Швидкості — поруч із лічильниками: подивитися «скільки зараз»
    // треба і без Prometheus, простим curl під навантаженням.
    expect(body).toMatch(/^starfall_messages_per_second 640$/m);
    expect(body).toMatch(/^starfall_bytes_out_per_second 98000$/m);
  });

  test("uptime рахується від startedAt", () => {
    expect(body).toMatch(/^starfall_uptime_seconds 42$/m);
  });

  test("ready відображається нулем, коли процес зупиняється", () => {
    const stopping = renderMetrics(sources({ ready: () => false }), probe, Date.now());
    expect(stopping).toMatch(/^starfall_ready 0$/m);
    // up лишається одиницею: процес іще відповідає, і це різні речі.
    expect(stopping).toMatch(/^starfall_up 1$/m);
  });

  test("лічильники позначені counter, поточні значення — gauge", () => {
    expect(body).toContain("# TYPE starfall_messages_in_total counter");
    expect(body).toContain("# TYPE starfall_players gauge");
  });

  test("у відповіді немає значень із пробілами чи переносами", () => {
    for (const line of body.trim().split("\n")) {
      if (line.startsWith("#")) continue;
      expect(line).toMatch(/^\S+ -?[\d.e+]+$/);
    }
  });
});

describe("createRateTracker", () => {
  test("рахує приріст за секунду по ковзному вікну", async () => {
    const { createRateTracker } = await import("../src/metrics.ts");
    let messages = 0;
    const tracker = createRateTracker(() => ({ messages, bytesIn: 0, bytesOut: 0 }));

    // Одна вибірка — швидкості ще немає, і це правильна відповідь:
    // приросту ні з чим порівнювати.
    expect(tracker.messagesPerSecond()).toBe(0);
    messages = 100;
    expect(tracker.messagesPerSecond()).toBe(0);
    tracker.stop();
  });
});

describe("createEventLoopProbe", () => {
  test("зайнятість у межах 0..1", () => {
    const probe = createEventLoopProbe();
    const value = probe.utilization();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  test("зайнятий цикл подій дає більшу частку, ніж простій", async () => {
    const probe = createEventLoopProbe();
    probe.utilization(); // скидаємо відлік

    // Блокуємо цикл подій синхронною роботою.
    const until = Date.now() + 60;
    while (Date.now() < until) {
      // навмисне блокування
    }
    const busy = probe.utilization();

    await new Promise((resolve) => setTimeout(resolve, 60));
    const idle = probe.utilization();

    expect(busy).toBeGreaterThan(idle);
  });

  test("затримка має три процентилі", () => {
    const probe = createEventLoopProbe();
    const delay = probe.delay();
    expect(delay).toHaveProperty("p50");
    expect(delay).toHaveProperty("p99");
    expect(delay).toHaveProperty("max");
  });
});

describe("журналювання", () => {
  test("логер приховує токени", async () => {
    const { createLogger } = await import("../src/log.ts");
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });

    const log = createLogger({ nodeEnv: "development", gitSha: "abc" }, sink);
    log.info({ event: "test", metricsToken: "s3cret", nested: { token: "s3cret" } });

    const output = lines.join("");
    expect(output).not.toContain("s3cret");
    expect(output).toContain("[приховано]");
    // Поля, які не є секретами, лишаються як були.
    expect(output).toContain('"event":"test"');
    // Рядок має лишатися валідним JSON — інакше збирач логів його не візьме.
    expect(() => JSON.parse(output.trim())).not.toThrow();
  });
});
