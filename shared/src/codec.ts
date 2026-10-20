import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  type InputFrame,
  jsonCodec as jsonSnapshotCodec,
  type Snapshot,
  type SnapshotPayload,
} from "./protocol.ts";
import { millis } from "./types.ts";

/**
 * Кодек як інтерфейс, а не як набір вільних функцій.
 *
 * Сенс у тому, що бінарний і JSON-варіанти стають взаємозамінними:
 * клієнт і сервер працюють із `Codec`, а який саме — вирішує прапорець
 * `?proto=json`. Порівняння розмірів у README зроблене рівно так:
 * один і той самий код, дві реалізації.
 */
export interface Codec<TFrame> {
  readonly name: "binary" | "json";
  /** true — кадр треба слати як бінарний, false — як текст. */
  readonly binary: boolean;
  encodeInput(frame: InputFrame): TFrame;
  decodeInput(frame: unknown): InputFrame | null;
  encodeSnapshot(payload: SnapshotPayload): TFrame;
  decodeSnapshot(frame: unknown): Snapshot | null;
}

const isBytes = (value: unknown): value is ArrayBufferView | ArrayBuffer =>
  value instanceof ArrayBuffer || ArrayBuffer.isView(value);

export const binaryCodec: Codec<ArrayBuffer> = {
  name: "binary",
  binary: true,
  encodeInput,
  decodeInput: (frame) => (isBytes(frame) ? decodeInput(frame) : null),
  encodeSnapshot,
  decodeSnapshot: (frame) => (isBytes(frame) ? decodeSnapshot(frame) : null),
};

export const jsonCodec: Codec<string> = {
  name: "json",
  binary: false,
  encodeInput: jsonSnapshotCodec.encodeInput,
  decodeInput: (frame) => {
    if (typeof frame !== "string") return null;
    const parsed: Partial<InputFrame> & { type?: string } = JSON.parse(frame);
    if (parsed.type !== "input" || !parsed.input || parsed.seq === undefined) return null;
    return {
      seq: parsed.seq,
      clientTimeMs: parsed.clientTimeMs ?? millisZero,
      input: parsed.input,
    };
  },
  encodeSnapshot: jsonSnapshotCodec.encodeSnapshot,
  decodeSnapshot: (frame) => {
    if (typeof frame !== "string") return null;
    const parsed: Snapshot & { type?: string } = JSON.parse(frame);
    return parsed.type === "snapshot" ? { ...parsed, bytes: frame.length } : null;
  },
};

const millisZero = millis(0);

/** Обрати кодек за назвою. Нічого «розумного»: лише дві реалізації. */
export function pickCodec(name: string): Codec<ArrayBuffer> | Codec<string> {
  return name === "json" ? jsonCodec : binaryCodec;
}
