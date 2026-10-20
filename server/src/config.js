import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Конфігурація з оточення — і обов'язково з перевіркою.
 *
 * Сервер, який мовчки стартує з PORT="вісім тисяч", — це збій, відкладений
 * на потім. Краще впасти одразу з виразним повідомленням: у проді логи
 * читають, коли вже пізно.
 */
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function integer(name, raw, { min, max, fallback }) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${name}: очікувалося ціле число, отримано ${JSON.stringify(raw)}`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${name}: ${value} поза межами ${min}..${max}`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const port = integer("PORT", env.PORT, { min: 1, max: 65535, fallback: 8080 });
  const logDirRaw = env.LOG_DIR ?? "./logs";
  const logDir = isAbsolute(logDirRaw) ? logDirRaw : resolve(process.cwd(), logDirRaw);

  const config = {
    port,
    host: env.HOST ?? "127.0.0.1",
    logDir,
    clientDir: resolve(process.cwd(), env.CLIENT_DIR ?? "../client/dist"),
    // Ліміти протоколу — теж конфіг, а не магічні числа по коду.
    maxMessageBytes: integer("MAX_MESSAGE_BYTES", env.MAX_MESSAGE_BYTES, {
      min: 64,
      max: 1 << 20,
      fallback: 4096,
    }),
    messagesPerSecond: integer("MESSAGES_PER_SECOND", env.MESSAGES_PER_SECOND, {
      min: 1,
      max: 1000,
      fallback: 20,
    }),
    joinTimeoutMs: integer("JOIN_TIMEOUT_MS", env.JOIN_TIMEOUT_MS, {
      min: 500,
      max: 60_000,
      fallback: 5_000,
    }),
    pingIntervalMs: integer("PING_INTERVAL_MS", env.PING_INTERVAL_MS, {
      min: 1_000,
      max: 120_000,
      fallback: 15_000,
    }),
    // Скільки pong можна пропустити, перш ніж рвати з'єднання.
    missedPongLimit: integer("MISSED_PONG_LIMIT", env.MISSED_PONG_LIMIT, {
      min: 1,
      max: 10,
      fallback: 2,
    }),
    // Поріг backpressure: вище нього клієнту нічого не шлемо.
    maxBufferedBytes: integer("MAX_BUFFERED_BYTES", env.MAX_BUFFERED_BYTES, {
      min: 1024,
      max: 16 << 20,
      fallback: 256 * 1024,
    }),
  };

  mkdirSync(config.logDir, { recursive: true });
  return Object.freeze(config);
}

export { ConfigError };
