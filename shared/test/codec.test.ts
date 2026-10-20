import { expect, test } from "vitest";
import { binaryCodec, jsonCodec } from "../src/codec.ts";
import { decodeInput, decodeSnapshot, encodeSnapshot, SIZES } from "../src/protocol.ts";
import { Vector2 } from "../src/sim/vector.ts";
import { entityId, millis, seq, tick } from "../src/types.ts";

const frame = {
  seq: seq(42),
  clientTimeMs: millis(123456),
  input: { left: false, right: true, thrust: true, brake: false, fire: true },
};

const payload = {
  tick: tick(7),
  serverTimeMs: millis(9999),
  ackSeq: seq(41),
  rngState: 123,
  youId: entityId(5),
  entities: [
    {
      id: entityId(5),
      kind: "ship" as const,
      pos: new Vector2(800.5, 450.25),
      vel: new Vector2(-120.5, 33),
      angle: Math.PI / 3,
      radius: 18,
      hp: 2,
      thrusting: true,
    },
  ],
};

test("input проходить кодування і розкодування без втрат", () => {
  const encoded = binaryCodec.encodeInput(frame);
  expect(encoded.byteLength).toBe(SIZES.INPUT_BYTES);

  const decoded = binaryCodec.decodeInput(encoded);
  expect(decoded).toBeTruthy();
  expect(decoded.seq).toBe(frame.seq);
  expect(decoded.clientTimeMs).toBe(frame.clientTimeMs);
  expect(decoded.input).toEqual(frame.input);
});

test("знімок повертається з тією точністю, яку обіцяє протокол", () => {
  const encoded = binaryCodec.encodeSnapshot(payload);
  expect(encoded.byteLength).toBe(SIZES.HEADER_BYTES + SIZES.ENTITY_BYTES);

  const decoded = binaryCodec.decodeSnapshot(encoded);
  expect(decoded).toBeTruthy();
  expect(decoded.tick).toBe(payload.tick);
  expect(decoded.ackSeq).toBe(payload.ackSeq);
  expect(decoded.rngState).toBe(payload.rngState);

  const entity = decoded.entities[0];
  expect(entity).toBeTruthy();
  // Позиція пакується з кроком 1/8 одиниці, кут — з кроком ~0.0001 рад.
  expect(Math.abs(entity.x - 800.5) <= 1 / 8).toBeTruthy();
  expect(Math.abs(entity.y - 450.25) <= 1 / 8).toBeTruthy();
  expect(Math.abs(entity.angle - Math.PI / 3) < 0.001).toBeTruthy();
  expect(entity.hp).toBe(2);
  expect(entity.thrusting).toBe(true);
  expect(entity.you).toBe(true, "власний корабель має бути позначений");
});

test("декодер відкидає кадр із чужим байтом версії", () => {
  const encoded = binaryCodec.encodeInput(frame);
  new DataView(encoded).setUint8(0, 99);
  expect(decodeInput(encoded)).toBe(null);
});

test("декодер відкидає обрізаний знімок", () => {
  const encoded = encodeSnapshot(payload);
  // Відрізаємо половину сутності: довжина більше не збігається з count.
  const truncated = encoded.slice(0, encoded.byteLength - 8);
  expect(decodeSnapshot(truncated)).toBe(null);
});

test("декодер відкидає невідомі біти кнопок", () => {
  const encoded = binaryCodec.encodeInput(frame);
  new DataView(encoded).setUint8(6, 0b11111111);
  expect(decodeInput(encoded)).toBe(null);
});

test("JSON-кодек дає ті самі дані, але більший обсяг", () => {
  const binary = binaryCodec.encodeSnapshot(payload);
  const json = jsonCodec.encodeSnapshot(payload);

  const fromJson = jsonCodec.decodeSnapshot(json);
  expect(fromJson).toBeTruthy();
  expect(fromJson.tick).toBe(payload.tick);
  expect(json.length > binary.byteLength * 3, "JSON має бути помітно більшим").toBeTruthy();
});
