import { z } from "zod";

/**
 * Схеми вхідних повідомлень.
 *
 * Типи під час збірки стираються, тож на межі процесу вони ні від чого
 * не захищають: з мережі прилетить що завгодно. Zod перевіряє дані
 * в рантаймі, а тип виводиться зі схеми — одне джерело правди замість
 * окремо написаного інтерфейсу й окремо написаної перевірки, які
 * рано чи пізно розходяться.
 */

export const joinMessage = z.object({
  type: z.literal("join"),
  room: z.string().min(1).max(32),
  name: z.string().min(1).max(16),
});

export const chatMessage = z.object({
  type: z.literal("chat"),
  text: z.string().min(1).max(240),
});

export const leaveMessage = z.object({ type: z.literal("leave") });
export const pongMessage = z.object({ type: z.literal("pong") });

/**
 * Об'єднання з полем-дискримінантом. Саме завдяки `type` компілятор
 * уміє звужувати тип у switch, а Zod — обрати потрібну схему, не
 * перевіряючи всі підряд.
 */
export const clientMessage = z.discriminatedUnion("type", [
  joinMessage,
  chatMessage,
  leaveMessage,
  pongMessage,
]);

export type JoinMessage = z.infer<typeof joinMessage>;
export type ChatMessage = z.infer<typeof chatMessage>;
export type ClientMessage = z.infer<typeof clientMessage>;
export type ClientMessageType = ClientMessage["type"];

/** Коди закриття. 4000+ — простір застосунку (RFC 6455). */
export const CLOSE = {
  TOO_LARGE: 1009,
  BAD_JSON: 4000,
  UNKNOWN_TYPE: 4001,
  BAD_SHAPE: 4002,
  RATE_LIMIT: 4003,
  JOIN_TIMEOUT: 4004,
  NOT_JOINED: 4005,
  SERVER_SHUTDOWN: 1001,
} as const;

export type CloseCode = (typeof CLOSE)[keyof typeof CLOSE];

export type ParseResult =
  | { ok: true; message: ClientMessage; bytes: number }
  | { ok: false; code: CloseCode; reason: string };

/**
 * Єдина точка входу для всього, що прийшло текстом.
 *
 * Приймає `unknown`, а не `any`: з `any` компілятор мовчки пропустив би
 * будь-яке звернення до полів, і сенс перевірки зник би.
 */
export function parseClientMessage(raw: unknown, { maxBytes }: { maxBytes: number }): ParseResult {
  const bytes =
    typeof raw === "string"
      ? new TextEncoder().encode(raw).length
      : raw instanceof Uint8Array
        ? raw.byteLength
        : 0;

  // Довжину перевіряємо ДО розбору: парсити 10 МБ сміття, щоб потім
  // відмовити, — це і є вектор атаки.
  if (bytes > maxBytes) {
    return { ok: false, code: CLOSE.TOO_LARGE, reason: `повідомлення ${bytes} Б > ${maxBytes} Б` };
  }

  if (typeof raw !== "string" && !(raw instanceof Uint8Array)) {
    return { ok: false, code: CLOSE.BAD_SHAPE, reason: "очікувався текст або байти" };
  }
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Битий JSON не кидає виняток назовні: це звичайний результат.
    return { ok: false, code: CLOSE.BAD_JSON, reason: "не JSON" };
  }

  const result = clientMessage.safeParse(parsed);
  if (result.success) return { ok: true, message: result.data, bytes };

  // Невідомий тип і зламана форма — різні коди закриття, бо це різні
  // помилки клієнта: перший не знає протоколу, другий знає, але збрехав.
  const unknownType =
    typeof parsed === "object" &&
    parsed !== null &&
    !["join", "chat", "leave", "pong"].includes(String(Reflect.get(parsed, "type")));

  const issue = result.error.issues[0];
  return {
    ok: false,
    code: unknownType ? CLOSE.UNKNOWN_TYPE : CLOSE.BAD_SHAPE,
    reason: issue
      ? `${issue.path.join(".") || "root"}: ${issue.message}`
      : "невалідне повідомлення",
  };
}
