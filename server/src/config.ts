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

  /* --- Лаба 8: усе, що стосується публічного запуску --- */

  /**
   * Дозволені Origin — список через кому.
   *
   * Чому це не «про всяк випадок»: WebSocket НЕ підпадає під
   * same-origin policy. Браузер спокійно відкриє з'єднання до нашого
   * сервера зі будь-якої сторінки в інтернеті, і кукі користувача
   * поїдуть разом із рукостисканням. Єдине місце, де це можна
   * зупинити, — перевірка заголовка Origin на сервері.
   *
   * Порожній список означає «не перевіряти» і дозволений лише
   * в розробці: у production схема нижче цього не пропустить.
   */
  ALLOWED_ORIGINS: z.string().default(""),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Скільки одночасних з'єднань з однієї IP. */
  MAX_CONNECTIONS_PER_IP: intInRange(1, 1000, 8),
  MAX_ROOMS: intInRange(1, 1024, 32),
  /** Стеля гравців на процес — за межею падає якість у всіх. */
  MAX_PLAYERS: intInRange(2, 4096, 128),
  /** SHA збірки: підставляє Docker/CI, видно в /health. */
  GIT_SHA: z.string().default("dev"),
  /** Чи віддавати /metrics без авторизації (у production — за токеном). */
  METRICS_TOKEN: z.string().default(""),
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
  readonly allowedOrigins: readonly string[];
  readonly nodeEnv: "development" | "production" | "test";
  readonly maxConnectionsPerIp: number;
  readonly maxRooms: number;
  readonly maxPlayers: number;
  readonly gitSha: string;
  readonly metricsToken: string;
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
    allowedOrigins: Object.freeze(
      raw.ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    nodeEnv: raw.NODE_ENV,
    maxConnectionsPerIp: raw.MAX_CONNECTIONS_PER_IP,
    maxRooms: raw.MAX_ROOMS,
    maxPlayers: raw.MAX_PLAYERS,
    gitSha: raw.GIT_SHA,
    metricsToken: raw.METRICS_TOKEN,
  };

  /**
   * Єдина перевірка, якої не вміє схема: вона залежить від іншого поля.
   *
   * У розробці порожній ALLOWED_ORIGINS зручний. У production це
   * означає «пускаємо будь-який сайт» — і краще не піднятися зовсім,
   * ніж піднятися відкритим. Падаємо на старті, а не колись потім.
   */
  if (config.nodeEnv === "production" && config.allowedOrigins.length === 0) {
    throw new ConfigError(
      "ALLOWED_ORIGINS: у production потрібен хоча б один Origin " +
        "(наприклад https://starfall.example.com)",
    );
  }

  mkdirSync(config.logDir, { recursive: true });
  return Object.freeze(config);
}
