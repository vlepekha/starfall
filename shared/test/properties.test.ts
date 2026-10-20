import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { binaryCodec } from "../src/codec.ts";
import { parseClientMessage } from "../src/messages.ts";
import { decodeInput, decodeSnapshot, SIZES } from "../src/protocol.ts";
import { WORLD } from "../src/sim/arena.ts";
import { integrate } from "../src/sim/ship.ts";
import { Vector2 } from "../src/sim/vector.ts";
import { entityId, millis, seq, tick } from "../src/types.ts";

/**
 * Property-тести: перевіряємо не окремі приклади, а твердження на
 * тисячах згенерованих входах. Приклад показує, що код працює для
 * одного випадку; property — що він не ламається на жодному.
 */

const arbInput = fc.record({
  left: fc.boolean(),
  right: fc.boolean(),
  thrust: fc.boolean(),
  brake: fc.boolean(),
  fire: fc.boolean(),
});

const arbEntity = fc.record({
  id: fc.integer({ min: 1, max: 65535 }).map(entityId),
  kind: fc.constantFrom("ship" as const, "bullet" as const, "asteroid" as const, "pickup" as const),
  x: fc.double({ min: 0, max: WORLD.width, noNaN: true }),
  y: fc.double({ min: 0, max: WORLD.height, noNaN: true }),
  vx: fc.double({ min: -700, max: 700, noNaN: true }),
  vy: fc.double({ min: -700, max: 700, noNaN: true }),
  angle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  hp: fc.integer({ min: 0, max: 255 }),
  radius: fc.integer({ min: 0, max: 255 }),
});

describe("property: кодек", () => {
  test("1. input після кодування і розкодування той самий", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.integer({ min: 0, max: 2 ** 31 }),
        arbInput,
        (sequence, time, input) => {
          const frame = { seq: seq(sequence), clientTimeMs: millis(time), input };
          const decoded = binaryCodec.decodeInput(binaryCodec.encodeInput(frame));
          expect(decoded).not.toBeNull();
          expect(decoded?.seq).toBe(frame.seq);
          expect(decoded?.clientTimeMs).toBe(frame.clientTimeMs);
          expect(decoded?.input).toEqual(input);
        },
      ),
      { numRuns: 300 },
    );
  });

  test("2. знімок повертається з обіцяною точністю (кут — з округленням)", () => {
    fc.assert(
      fc.property(fc.array(arbEntity, { minLength: 0, maxLength: 24 }), (entities) => {
        const payload = {
          tick: tick(1),
          serverTimeMs: millis(1000),
          ackSeq: seq(1),
          rngState: 42,
          youId: entityId(1),
          entities: entities.map((e) => ({
            ...e,
            pos: new Vector2(e.x, e.y),
            vel: new Vector2(e.vx, e.vy),
          })),
        };

        const decoded = decodeSnapshot(binaryCodec.encodeSnapshot(payload));
        expect(decoded).not.toBeNull();
        expect(decoded?.entities.length).toBe(entities.length);

        decoded?.entities.forEach((got, i) => {
          const want = entities[i];
          if (!want) throw new Error("пропущена сутність");
          // Позиція пакується з кроком 1/8, швидкість — 1/16,
          // кут — ~0.0001 рад. Саме ці межі протокол і обіцяє.
          expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(1 / 8);
          expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(1 / 8);
          expect(Math.abs(got.vx - want.vx)).toBeLessThanOrEqual(1 / 16);
          expect(Math.abs(got.vy - want.vy)).toBeLessThanOrEqual(1 / 16);
          expect(Math.abs(got.angle - want.angle)).toBeLessThan(0.0002);
        });
      }),
      { numRuns: 200 },
    );
  });

  test("3. довжина кадру точно відповідає опису формату", () => {
    fc.assert(
      fc.property(fc.array(arbEntity, { maxLength: 40 }), (entities) => {
        const buffer = binaryCodec.encodeSnapshot({
          tick: tick(0),
          serverTimeMs: millis(0),
          ackSeq: seq(0),
          rngState: 0,
          youId: entityId(1),
          entities: entities.map((e) => ({
            ...e,
            pos: new Vector2(e.x, e.y),
            vel: new Vector2(e.vx, e.vy),
          })),
        });
        expect(buffer.byteLength).toBe(
          SIZES.HEADER_BYTES + entities.length * SIZES.ENTITY_BYTES,
        );
      }),
      { numRuns: 200 },
    );
  });

  test("4. будь-який сміттєвий буфер дає null, а не виняток", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 200 }), (bytes) => {
        // Жодного throw: процес не має падати від кривого пакета.
        expect(() => decodeInput(bytes)).not.toThrow();
        expect(() => decodeSnapshot(bytes)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});

describe("property: симуляція", () => {
  test("5. корабель ніколи не виходить за межі арени", () => {
    fc.assert(
      fc.property(fc.array(arbInput, { minLength: 1, maxLength: 60 }), (inputs) => {
        let ship = { x: 800, y: 450, vx: 0, vy: 0, angle: 0 };
        // 1000 кроків випадкового вводу — умова лаби.
        for (let i = 0; i < 1000; i += 1) {
          const input = inputs[i % inputs.length];
          if (!input) continue;
          ship = integrate(ship, input, 1 / 60);
          expect(Number.isFinite(ship.x)).toBe(true);
          expect(Number.isFinite(ship.y)).toBe(true);
          expect(ship.x).toBeGreaterThanOrEqual(0);
          expect(ship.x).toBeLessThan(WORLD.width);
          expect(ship.y).toBeGreaterThanOrEqual(0);
          expect(ship.y).toBeLessThan(WORLD.height);
          expect(Math.hypot(ship.vx, ship.vy)).toBeLessThanOrEqual(WORLD.maxSpeed + 1e-6);
        }
      }),
      { numRuns: 20 },
    );
  });
});

describe("property: розбір повідомлень", () => {
  test("6. коректне приймається, зіпсоване відхиляється без винятку", () => {
    const valid = fc.oneof(
      fc.record({
        type: fc.constant("join" as const),
        room: fc.string({ minLength: 1, maxLength: 32 }),
        name: fc.string({ minLength: 1, maxLength: 16 }),
      }),
      fc.record({
        type: fc.constant("chat" as const),
        text: fc.string({ minLength: 1, maxLength: 240 }),
      }),
      fc.record({ type: fc.constant("leave" as const) }),
    );

    fc.assert(
      fc.property(valid, (message) => {
        const result = parseClientMessage(JSON.stringify(message), { maxBytes: 4096 });
        expect(result.ok).toBe(true);
      }),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(fc.anything(), (anything) => {
        let text: string;
        try {
          text = JSON.stringify(anything) ?? "undefined";
        } catch {
          return; // циклічні структури нас не цікавлять
        }
        const result = parseClientMessage(text, { maxBytes: 4096 });
        // Головне: функція завжди ПОВЕРТАЄ результат, а не кидає.
        expect(typeof result.ok).toBe("boolean");
        if (!result.ok) expect(typeof result.code).toBe("number");
      }),
      { numRuns: 300 },
    );
  });
});
