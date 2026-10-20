import { integrate, type InputState, Vector2 } from "@starfall/shared";
import { describe, expect, test } from "vitest";
import { reconcile, type ShipSnapshot } from "../src/net/reconcile.ts";

const NONE: InputState = { left: false, right: false, thrust: false, brake: false, fire: false };
const THRUST: InputState = { ...NONE, thrust: true };

/** Міст між чистою integrate() і формою, в якій живе звірка. */
const step = (state: ShipSnapshot, input: InputState, dt: number): ShipSnapshot => {
  const next = integrate(
    { x: state.pos.x, y: state.pos.y, vx: state.vel.x, vy: state.vel.y, angle: state.angle },
    input,
    dt,
  );
  return { pos: new Vector2(next.x, next.y), vel: new Vector2(next.vx, next.vy), angle: next.angle };
};

const at = (x: number, y: number, angle = 0): ShipSnapshot => ({
  pos: new Vector2(x, y),
  vel: Vector2.zero(),
  angle,
});

describe("reconcile", () => {
  test("без непідтверджених input стан стає серверним", () => {
    const result = reconcile({
      predicted: at(150, 100),
      authoritative: at(100, 100),
      pending: [],
      ackSeq: 0,
      step,
    });
    expect(result.state.pos.x).toBe(100);
    expect(result.replayed).toBe(0);
  });

  test("поправка дорівнює різниці між передбаченим і звіреним", () => {
    const result = reconcile({
      predicted: at(150, 100),
      authoritative: at(100, 100),
      pending: [],
      ackSeq: 0,
      step,
    });
    expect(result.correction.x).toBe(50);
    expect(result.correction.y).toBe(0);
  });

  test("непідтверджені input програються заново", () => {
    const pending = [
      { seq: 1, input: THRUST },
      { seq: 2, input: THRUST },
      { seq: 3, input: THRUST },
    ];
    const result = reconcile({
      predicted: at(100, 100),
      authoritative: at(100, 100),
      pending,
      ackSeq: 1,
      step,
    });
    // seq 1 сервер уже врахував — переграються лише 2 і 3.
    expect(result.replayed).toBe(2);
    expect(result.state.pos.x).toBeGreaterThan(100);
  });

  test("підтверджені input не враховуються двічі", () => {
    const pending = [
      { seq: 1, input: THRUST },
      { seq: 2, input: THRUST },
    ];
    const all = reconcile({ predicted: at(0, 0), authoritative: at(100, 100), pending, ackSeq: 0, step });
    const half = reconcile({ predicted: at(0, 0), authoritative: at(100, 100), pending, ackSeq: 1, step });
    expect(all.state.pos.x).toBeGreaterThan(half.state.pos.x);
  });

  test("коли клієнт і сервер згодні, поправка нульова", () => {
    const pending = [{ seq: 1, input: THRUST }];
    const authoritative = at(100, 100);
    // Передбачення — це той самий крок із того самого стану.
    const predicted = step(authoritative, THRUST, 1 / 30);

    const result = reconcile({ predicted, authoritative, pending, ackSeq: 0, step });
    expect(result.correction.length).toBeCloseTo(0, 10);
  });

  test("розсинхрон дає ненульову поправку", () => {
    const authoritative = at(100, 100);
    const predicted = step(authoritative, THRUST, 1 / 30);
    // Сервер вважає, що гравець нічого не натискав.
    const result = reconcile({
      predicted,
      authoritative,
      pending: [{ seq: 1, input: NONE }],
      ackSeq: 0,
      step,
    });
    expect(result.correction.length).toBeGreaterThan(0);
  });

  test("функція чиста: входи не мутуються", () => {
    const pending = [{ seq: 1, input: THRUST }];
    const authoritative = at(100, 100);
    const copy = { x: authoritative.pos.x, y: authoritative.pos.y };

    reconcile({ predicted: at(0, 0), authoritative, pending, ackSeq: 0, step });
    expect(authoritative.pos.x).toBe(copy.x);
    expect(pending.length).toBe(1);
  });

  test("однакові аргументи дають однаковий результат", () => {
    const args = {
      predicted: at(0, 0),
      authoritative: at(100, 100),
      pending: [{ seq: 1, input: THRUST }],
      ackSeq: 0,
      step,
    };
    expect(reconcile(args).state.pos.x).toBe(reconcile(args).state.pos.x);
  });
});
