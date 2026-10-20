import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

/**
 * Конфігурація з оточення — через Zod.
 *
 * Раніше тут була купа ручних перевірок «чи ціле, чи в межах». Схема
 * описує те саме один раз, а тип конфігу виводиться з неї: додати поле
 * і забути його провалідувати тепер неможливо.
 */
/**
 * Число з оточення: усе приходить рядком, порожній рядок = «не задано».
 * `transform` підставляє типове значення, і далі вже звичайна перевірка.
 */
const intInRange = (min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : Number(value)))
    .pipe(z.number().int().min(min).max(max));

const envSchema = z.object({
  PORT: intInRange(1, 65535, 8080),
  HOST: z.string().default("127.0.0.1"),
  LOG_DIR: z.string().default("./logs"),
  CLIENT_DIR: z.string().default("../client/dist"),
  MAX_MESSAGE_BYTES: intInRange(64, 1 << 20, 4096),
  MESSAGES_PER_SECOND: intInRange(1, 1000, 20),
  JOIN_TIMEOUT_MS: intInRange(500, 60_000, 5_000),
  PING_INTERVAL_MS: intInRange(1_000, 120_000, 15_000),
  MISSED_PONG_LIMIT: intInRange(1, 10, 2),
  MAX_BUFFERED_BYTES: intInRange(1024, 16 << 20, 256 * 1024),
  ROOM_CAPACITY: intInRange(2, 256, 6),
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly logDir: string;
  readonly clientDir: string;
  readonly maxMessageBytes: number;
  readonly messagesPerSecond: number;
  readonly joinTimeoutMs: number;
  readonly pingIntervalMs: number;
  readonly missedPongLimit: number;
  readonly maxBufferedBytes: number;
  /** Скільки гравців уміщає кімната. Для навантажувальних тестів піднімають. */
  readonly roomCapacity: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") ?? "env";
    // Показуємо і те, що прийшло: «очікувалося число» без значення
    // змушує лізти в оточення руками.
    const received = where in env ? JSON.stringify(Reflect.get(env, where)) : "не задано";
    throw new ConfigError(
      `${where}: ${issue?.message ?? "невалідне значення"} (отримано ${received})`,
    );
  }

  const raw = parsed.data;
  const logDir = isAbsolute(raw.LOG_DIR) ? raw.LOG_DIR : resolve(process.cwd(), raw.LOG_DIR);

  const config: Config = {
    port: raw.PORT,
    host: raw.HOST,
    logDir,
    clientDir: resolve(process.cwd(), raw.CLIENT_DIR),
    maxMessageBytes: raw.MAX_MESSAGE_BYTES,
    messagesPerSecond: raw.MESSAGES_PER_SECOND,
    joinTimeoutMs: raw.JOIN_TIMEOUT_MS,
    pingIntervalMs: raw.PING_INTERVAL_MS,
    missedPongLimit: raw.MISSED_PONG_LIMIT,
    maxBufferedBytes: raw.MAX_BUFFERED_BYTES,
    roomCapacity: raw.ROOM_CAPACITY,
  };

  mkdirSync(config.logDir, { recursive: true });
  return Object.freeze(config);
}
