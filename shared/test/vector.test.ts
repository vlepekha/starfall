import { describe, expect, test } from "vitest";
import { WORLD, wrap } from "../src/sim/arena.ts";
import { Vector2 } from "../src/sim/vector.ts";

describe("Vector2", () => {
  test("конструктор і нуль", () => {
    const v = new Vector2(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
    expect(Vector2.zero().x).toBe(0);
    expect(Vector2.zero().y).toBe(0);
  });

  test("довжина і кут", () => {
    expect(new Vector2(3, 4).length).toBe(5);
    expect(new Vector2(0, 0).length).toBe(0);
    expect(new Vector2(1, 0).angle).toBeCloseTo(0);
    expect(new Vector2(0, 1).angle).toBeCloseTo(Math.PI / 2);
  });

  test("методи не мутують вихідний вектор", () => {
    const a = new Vector2(3, 4);
    a.add(new Vector2(10, 10));
    a.sub(new Vector2(1, 1));
    a.scale(100);
    a.normalize();
    expect(a.x).toBe(3);
    expect(a.y).toBe(4);
  });

  test("add, sub, scale", () => {
    const a = new Vector2(1, 2);
    const b = new Vector2(3, 4);
    expect(a.add(b)).toEqual(new Vector2(4, 6));
    expect(b.sub(a)).toEqual(new Vector2(2, 2));
    expect(a.scale(3)).toEqual(new Vector2(3, 6));
  });

  test("normalize дає одиничний вектор, нуль лишається нулем", () => {
    expect(new Vector2(10, 0).normalize().length).toBeCloseTo(1);
    expect(new Vector2(0, 0).normalize().length).toBe(0);
  });

  test("clampLength обрізає лише довші", () => {
    expect(new Vector2(100, 0).clampLength(10).length).toBeCloseTo(10);
    const short = new Vector2(3, 4);
    expect(short.clampLength(100)).toBe(short);
  });

  test("fromAngle", () => {
    const v = Vector2.fromAngle(Math.PI / 2, 5);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(5);
  });

  test("distanceTo", () => {
    expect(new Vector2(0, 0).distanceTo(new Vector2(3, 4))).toBe(5);
  });

  test("shortestDeltaTo враховує загортання арени", () => {
    const left = new Vector2(10, 450);
    const right = new Vector2(WORLD.width - 10, 450);
    // Навпростець було б ~1580, через край — 20.
    expect(left.wrappedDistanceTo(right)).toBeCloseTo(20);
    expect(left.shortestDeltaTo(right).x).toBeCloseTo(-20);
  });

  test("toString читабельний", () => {
    expect(new Vector2(1.234, 5.678).toString()).toBe("Vector2(1.2, 5.7)");
  });
});

describe("wrap", () => {
  test("усередині діапазону не змінює", () => {
    expect(wrap(50, 100)).toBe(50);
  });

  test("за верхньою межею повертає на початок", () => {
    expect(wrap(100, 100)).toBe(0);
    expect(wrap(130, 100)).toBe(30);
  });

  test("від'ємні значення загортає з кінця", () => {
    expect(wrap(-10, 100)).toBe(90);
    expect(wrap(-130, 100)).toBe(70);
  });
});
