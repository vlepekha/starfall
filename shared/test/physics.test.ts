import { describe, expect, test } from "vitest";
import { WORLD } from "../src/sim/arena.ts";
import { createShip, integrate, interpolate } from "../src/sim/ship.ts";
import type { InputState } from "../src/types.ts";

const NONE: InputState = { left: false, right: false, thrust: false, brake: false, fire: false };
const DT = 1 / 60;

describe("integrate", () => {
  test("без вводу корабель лише гальмується тертям", () => {
    const ship = { ...createShip(), vx: 100, vy: 0 };
    const next = integrate(ship, NONE, DT);
    expect(next.x).toBeGreaterThan(ship.x);
    expect(next.vx).toBeLessThan(100);
    expect(next.vx).toBeGreaterThan(95);
  });

  test("не мутує вхідний стан", () => {
    const ship = createShip();
    const copy = { ...ship };
    integrate(ship, { ...NONE, thrust: true }, DT);
    expect(ship).toEqual(copy);
  });

  test("тяга додає швидкість у напрямку носа", () => {
    const ship = { ...createShip(), angle: 0, vx: 0, vy: 0 };
    const next = integrate(ship, { ...NONE, thrust: true }, DT);
    expect(next.vx).toBeGreaterThan(0);
    expect(next.vy).toBeCloseTo(0);
  });

  test("поворот змінює кут у потрібний бік", () => {
    const ship = { ...createShip(), angle: 0 };
    expect(integrate(ship, { ...NONE, right: true }, DT).angle).toBeGreaterThan(0);
    expect(integrate(ship, { ...NONE, left: true }, DT).angle).toBeLessThan(0);
  });

  test("гальмо гасить швидкість швидше за тертя", () => {
    const ship = { ...createShip(), vx: 300, vy: 0 };
    const drifting = integrate(ship, NONE, DT);
    const braking = integrate(ship, { ...NONE, brake: true }, DT);
    expect(braking.vx).toBeLessThan(drifting.vx);
  });

  test("швидкість обмежена maxSpeed", () => {
    let ship = { ...createShip(), angle: 0 };
    for (let i = 0; i < 600; i += 1) ship = integrate(ship, { ...NONE, thrust: true }, DT);
    expect(Math.hypot(ship.vx, ship.vy)).toBeLessThanOrEqual(WORLD.maxSpeed + 1e-9);
  });

  test("однаковий вхід дає однаковий вихід", () => {
    const ship = createShip();
    const input = { ...NONE, thrust: true, right: true };
    expect(integrate(ship, input, DT)).toEqual(integrate(ship, input, DT));
  });

  test("прапорець thrusting відображає ввід", () => {
    expect(integrate(createShip(), { ...NONE, thrust: true }, DT).thrusting).toBe(true);
    expect(integrate(createShip(), NONE, DT).thrusting).toBe(false);
  });

  test("корабель загортається через край арени", () => {
    const ship = { ...createShip(), x: WORLD.width - 1, y: 450, vx: 600, vy: 0, angle: 0 };
    const next = integrate(ship, NONE, DT);
    expect(next.x).toBeLessThan(100);
  });
});

describe("interpolate", () => {
  test("alpha 0 і 1 дають кінці відрізка", () => {
    const a = { ...createShip(), x: 100, y: 100 };
    const b = { ...createShip(), x: 200, y: 100 };
    expect(interpolate(a, b, 0).x).toBeCloseTo(100);
    expect(interpolate(a, b, 1).x).toBeCloseTo(200);
  });

  test("середина — посередині", () => {
    const a = { ...createShip(), x: 100, y: 0 };
    const b = { ...createShip(), x: 200, y: 0 };
    expect(interpolate(a, b, 0.5).x).toBeCloseTo(150);
  });

  test("через край іде коротким шляхом, а не через усю арену", () => {
    const a = { ...createShip(), x: WORLD.width - 10, y: 0 };
    const b = { ...createShip(), x: 10, y: 0 };
    const mid = interpolate(a, b, 0.5).x;
    // Коротким шляхом середина — на самій межі, а не в центрі арени.
    expect(mid > WORLD.width - 10 || mid < 10).toBe(true);
  });

  test("кут інтерполюється найкоротшим шляхом", () => {
    const a = { ...createShip(), angle: 3.0 };
    const b = { ...createShip(), angle: -3.0 };
    const mid = interpolate(a, b, 0.5).angle;
    // Через ±π, а не через нуль: модуль має бути близьким до π.
    expect(Math.abs(mid)).toBeGreaterThan(3.0);
  });
});
