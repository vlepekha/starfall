/**
 * Протокол і його перевірка.
 *
 * Усе, що приходить із мережі, — вороже доти, доки не перевірене. Тут
 * єдине місце, де повідомлення стає довіреним об'єктом; далі по коду
 * його форму вже не перевіряють.
 */

/** Коди закриття. 4000+ — простір для застосунку (RFC 6455). */
export const CLOSE = {
  TOO_LARGE: 1009, // стандартний «message too big»
  BAD_JSON: 4000,
  UNKNOWN_TYPE: 4001,
  BAD_SHAPE: 4002,
  RATE_LIMIT: 4003,
  JOIN_TIMEOUT: 4004,
  NOT_JOINED: 4005,
  SERVER_SHUTDOWN: 1001,
};

const isString = (value, max) =>
  typeof value === "string" && value.length > 0 && value.length <= max;

/**
 * Схеми вхідних повідомлень. Кожна повертає або нормалізований об'єкт,
 * або рядок із причиною відмови.
 */
const INBOUND = {
  join(message) {
    if (!isString(message.room, 32)) return "room: рядок 1..32 символів";
    if (!isString(message.name, 16)) return "name: рядок 1..16 символів";
    return { type: "join", room: message.room, name: message.name };
  },
  chat(message) {
    if (!isString(message.text, 240)) return "text: рядок 1..240 символів";
    return { type: "chat", text: message.text };
  },
  leave() {
    return { type: "leave" };
  },
  pong() {
    return { type: "pong" };
  },
};

export function parseMessage(raw, { maxBytes }) {
  // Довжину перевіряємо ДО JSON.parse: розбирати 10 МБ сміття,
  // щоб потім відмовити, — це і є вектор атаки.
  const bytes = typeof raw === "string" ? Buffer.byteLength(raw) : raw.length;
  if (bytes > maxBytes) {
    return { ok: false, code: CLOSE.TOO_LARGE, reason: `повідомлення ${bytes} Б > ${maxBytes} Б` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return { ok: false, code: CLOSE.BAD_JSON, reason: "не JSON" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, code: CLOSE.BAD_SHAPE, reason: "очікувався об'єкт" };
  }

  const schema = INBOUND[parsed.type];
  if (!schema) {
    return { ok: false, code: CLOSE.UNKNOWN_TYPE, reason: `невідомий тип ${parsed.type}` };
  }

  const result = schema(parsed);
  if (typeof result === "string") {
    return { ok: false, code: CLOSE.BAD_SHAPE, reason: result };
  }
  return { ok: true, message: result, bytes };
}

export const encode = (type, payload = {}) => JSON.stringify({ type, ...payload });
