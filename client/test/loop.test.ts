import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createLoop } from "../src/loop.ts";

/**
 * Цикл перевіряється з фейковими таймерами: справжній
 * requestAnimationFrame довелося б чекати в реальному часі, а тут
 * кадри «настають» тоді, коли ми скажемо.
 */
function fakeRaf() {
  let now = 0;
  let nextId = 1;
  const queue = new Map<number, (t: number) => void>();

  return {
    now: () => now,
    schedule: (cb: (t: number) => void): number => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    // Скасування має справді скасовувати: інакше тест на stop() пройшов би
    // лише тому, що фейк не вміє того, що вміє браузер.
    cancel: (id: number) => {
      queue.delete(id);
    },
    /** Прокрутити один кадр заданої тривалості. */
    frame(deltaMs: number) {
      now += deltaMs;
      const pending = [...queue.entries()];
      queue.clear();
      for (const [, cb] of pending) cb(now);
    },
  };
}

describe("createLoop (фейкові таймери)", () => {
  test("при 16.7 мс на кадр робить один крок симуляції", () => {
    const raf = fakeRaf();
    const update = vi.fn();
    const render = vi.fn();
    const loop = createLoop({
      update,
      render,
      stepHz: 60,
      now: raf.now,
      schedule: raf.schedule,
      cancel: raf.cancel,
    });

    loop.start();
    raf.frame(16.7);
    expect(update).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  test("повільний кадр надолужує кількома кроками", () => {
    const raf = fakeRaf();
    const update = vi.fn();
    const loop = createLoop({
      update,
      render: () => {},
      stepHz: 60,
      now: raf.now,
      schedule: raf.schedule,
      cancel: raf.cancel,
    });

    loop.start();
    raf.frame(100); // шість кроків по 16.7 мс
    expect(update).toHaveBeenCalledTimes(6);
  });

  test("крок симуляції завжди однаковий, яким би не був кадр", () => {
    const raf = fakeRaf();
    const steps: number[] = [];
    const loop = createLoop({
      update: (dt) => steps.push(dt),
      render: () => {},
      stepHz: 60,
      now: raf.now,
      schedule: raf.schedule,
      cancel: raf.cancel,
    });

    loop.start();
    raf.frame(7);
    raf.frame(50);
    raf.frame(33);
    expect(new Set(steps).size).toBe(1);
    expect(steps[0]).toBeCloseTo(1 / 60);
  });

  test("величезний кадр обрізається — без спіралі смерті", () => {
    const raf = fakeRaf();
    const update = vi.fn();
    const loop = createLoop({
      update,
      render: () => {},
      stepHz: 60,
      maxFrameTime: 0.25,
      now: raf.now,
      schedule: raf.schedule,
      cancel: raf.cancel,
    });

    loop.start();
    raf.frame(10_000); // вкладка була згорнута десять секунд
    // 0.25 с / (1/60) = 15 кроків, а не 600.
    expect(update.mock.calls.length).toBeLessThanOrEqual(15);
    expect(loop.stats.panics).toBe(1);
  });

  test("alpha в рендері лежить у [0, 1)", () => {
    const raf = fakeRaf();
    const alphas: number[] = [];
    const loop = createLoop({
      update: () => {},
      render: (alpha) => alphas.push(alpha),
      stepHz: 60,
      now: raf.now,
      schedule: raf.schedule,
      cancel: raf.cancel,
    });

    loop.start();
    for (const ms of [5, 9, 20, 33, 7]) raf.frame(ms);
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  test("stop зупиняє цикл", () => {
    const raf = fakeRaf();
    const update = vi.fn();
    const loop = createLoop({
      update,
      render: () => {},
      now: raf.now,
      schedule: raf.schedule,
      cancel: raf.cancel,
    });

    loop.start();
    raf.frame(16.7);
    loop.stop();
    raf.frame(16.7);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("статистика рахує кроки й кадри за секунду", () => {
    const raf = fakeRaf();
    const loop = createLoop({
      update: () => {},
      render: () => {},
      stepHz: 60,
      now: raf.now,
      schedule: raf.schedule,
      cancel: raf.cancel,
    });

    loop.start();
    for (let i = 0; i < 61; i += 1) raf.frame(16.67);
    expect(loop.stats.stepsPerSecond).toBeGreaterThan(55);
    expect(loop.stats.framesPerSecond).toBeGreaterThan(55);
  });
});

describe("heartbeat (фейкові таймери)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Та сама логіка, що в ws-server: два пропущені pong — розрив. */
  function createHeartbeat(intervalMs: number, limit: number, onDead: () => void) {
    let missed = 0;
    const timer = setInterval(() => {
      if (missed >= limit) {
        onDead();
        clearInterval(timer);
        return;
      }
      missed += 1;
    }, intervalMs);
    return { pong: () => (missed = 0), stop: () => clearInterval(timer) };
  }

  test("живе з'єднання не розривається", () => {
    const onDead = vi.fn();
    const hb = createHeartbeat(15_000, 2, onDead);

    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(15_000);
      hb.pong();
    }
    expect(onDead).not.toHaveBeenCalled();
    hb.stop();
  });

  test("два пропущені pong рвуть з'єднання", () => {
    const onDead = vi.fn();
    createHeartbeat(15_000, 2, onDead);

    vi.advanceTimersByTime(15_000);
    expect(onDead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(onDead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  test("pong посеред простою скидає лічильник", () => {
    const onDead = vi.fn();
    const hb = createHeartbeat(15_000, 2, onDead);

    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(15_000);
    hb.pong();
    vi.advanceTimersByTime(15_000);
    expect(onDead).not.toHaveBeenCalled();
    hb.stop();
  });
});
