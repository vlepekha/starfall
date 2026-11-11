import type { IncomingMessage } from "node:http";
import { describe, expect, test } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";
import { clientIp, isOriginAllowed } from "../src/ws-server.ts";

const base = { LOG_DIR: "/tmp/starfall-test-logs" };

describe("isOriginAllowed", () => {
  const allowed = ["https://starfall.example.com", "http://localhost:5173"];

  test("пропускає точний збіг", () => {
    expect(isOriginAllowed("https://starfall.example.com", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
  });

  test("відхиляє чужий сайт", () => {
    expect(isOriginAllowed("https://evil.example.net", allowed)).toBe(false);
  });

  /**
   * Класична помилка: перевірка «закінчується на домен». Саме під неї
   * зловмисник реєструє evil-starfall.example.com.
   */
  test("відхиляє домен, що лише закінчується на дозволений", () => {
    expect(isOriginAllowed("https://evil-starfall.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://starfall.example.com.evil.net", allowed)).toBe(false);
  });

  test("розрізняє схему й порт", () => {
    expect(isOriginAllowed("http://starfall.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:5174", allowed)).toBe(false);
  });

  test("порожній список дозволених вимикає перевірку", () => {
    expect(isOriginAllowed("https://evil.example.net", [])).toBe(true);
  });

  /** Боти й навантажувальний тест Origin не надсилають — і це нормально. */
  test("відсутній Origin пропускається", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
    expect(isOriginAllowed("", allowed)).toBe(true);
  });
});

describe("clientIp", () => {
  const request = (headers: Record<string, string | string[]>, remote = "10.0.0.1") =>
    ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

  test("бере remoteAddress, коли проксі немає", () => {
    expect(clientIp(request({}))).toBe("10.0.0.1");
  });

  test("за проксі бере ПЕРШУ адресу зі списку", () => {
    // Далі в списку йдуть самі проксі; початковий клієнт — перший.
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }))).toBe("203.0.113.7");
  });

  test("не падає на порожньому заголовку", () => {
    expect(clientIp(request({ "x-forwarded-for": "" }))).toBe("10.0.0.1");
  });
});

describe("конфіг публічного запуску", () => {
  test("розбирає список Origin через кому", () => {
    const config = loadConfig({
      ...base,
      ALLOWED_ORIGINS: "https://a.example.com, https://b.example.com ",
    });
    expect(config.allowedOrigins).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  /**
   * Найважливіша перевірка цієї лаби: у production сервер із порожнім
   * списком Origin не має піднятися взагалі.
   */
  test("production без ALLOWED_ORIGINS не стартує", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/ALLOWED_ORIGINS/);
  });

  test("production з Origin стартує", () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://starfall.example.com",
    });
    expect(config.nodeEnv).toBe("production");
    expect(config.gitSha).toBe("dev");
  });

  test("ліміти мають типові значення", () => {
    const config = loadConfig({ ...base });
    expect(config.maxConnectionsPerIp).toBe(8);
    expect(config.maxRooms).toBe(32);
    expect(config.maxPlayers).toBe(128);
  });

  test("ліміт з'єднань з IP поза діапазоном — помилка", () => {
    expect(() => loadConfig({ ...base, MAX_CONNECTIONS_PER_IP: "0" })).toThrow(ConfigError);
  });
});
