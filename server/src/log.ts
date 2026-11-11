import { pino } from "pino";
import type { Config } from "./config.ts";

/**
 * Логер процесу.
 *
 * До цієї лаби сервер писав `console.log` — і на хостингу це одразу
 * стало проблемою: збирачі логів (Railway, Fly, Loki, CloudWatch)
 * розбирають рядки JSON, а вільний текст лишається «просто текстом»,
 * за яким не можна ні відфільтрувати кімнату, ні побудувати графік.
 *
 * pino пише один рядок JSON на подію, причому синхронно в stdout —
 * саме те, що треба в контейнері: логи забирає докер, а не ми.
 *
 * NDJSON-логи матчів із лаби 4 нікуди не поділися: там інша задача —
 * повний запис подій кімнати для реплею. Тут — операційні логи процесу.
 */

/**
 * Поля, які НЕ мають потрапити в лог навіть випадково.
 *
 * Це не паранойя: у лабі 6 конфіг валідується Zod і містить
 * METRICS_TOKEN, а логер легко викликати з усім об'єктом конфігу.
 * Один `log.info({ config })` — і токен назавжди в агрегаторі логів.
 */
const REDACT = [
  "token",
  "metricsToken",
  "password",
  "pass",
  "secret",
  "key",
  "authorization",
  "cookie",
  "*.token",
  "*.password",
  "*.authorization",
];

export type Logger = pino.Logger;

/**
 * `destination` потрібен тестам: pino пише напряму у файловий
 * дескриптор (через sonic-boom), а не через process.stdout.write,
 * тому підмінити вивід шпигуном не вийде — лише передати потік.
 */
export function createLogger(
  config: Pick<Config, "nodeEnv" | "gitSha">,
  destination?: NodeJS.WritableStream,
): Logger {
  const options: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL ?? (config.nodeEnv === "test" ? "silent" : "info"),
    redact: { paths: REDACT, censor: "[приховано]" },
    base: { service: "starfall", sha: config.gitSha, pid: process.pid },
    // Час у ISO, а не в мілісекундах від епохи: логи читають люди.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // За замовчуванням pino пише level: 30. Збирачам логів потрібне слово.
      level: (label) => ({ level: label }),
    },
  };

  return destination ? pino(options, destination) : pino(options);
}

/** Логер «нічого не пише» — для тестів, які не перевіряють логи. */
export const silentLogger: Logger = pino({ level: "silent" });
