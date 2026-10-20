import { describe, expect, test } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

const base = { LOG_DIR: "/tmp/starfall-test-logs" };

describe("loadConfig", () => {
  test("типові значення, коли оточення порожнє", () => {
    const config = loadConfig({ ...base });
    expect(config.port).toBe(8080);
    expect(config.messagesPerSecond).toBe(20);
    expect(config.missedPongLimit).toBe(2);
  });

  test("читає значення з оточення", () => {
    expect(loadConfig({ ...base, PORT: "9123" }).port).toBe(9123);
  });

  test("нечисловий порт — ConfigError із поясненням", () => {
    expect(() => loadConfig({ ...base, PORT: "вісім тисяч" })).toThrow(ConfigError);
    try {
      loadConfig({ ...base, PORT: "abc" });
    } catch (error) {
      expect(error instanceof ConfigError && error.message).toContain("PORT");
      expect(error instanceof ConfigError && error.message).toContain("abc");
    }
  });

  test("порт поза межами відхиляється", () => {
    expect(() => loadConfig({ ...base, PORT: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, PORT: "70000" })).toThrow(ConfigError);
  });

  test("конфіг заморожений — випадково не зміниш", () => {
    const config = loadConfig({ ...base });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("порожній рядок трактується як «не задано»", () => {
    expect(loadConfig({ ...base, PORT: "" }).port).toBe(8080);
  });
});
