import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { installFatalHandlers } from "../src/fatal.ts";
import { createLogger } from "../src/log.ts";

/**
 * Поведінка при необробленій помилці.
 *
 * Перевіряємо дві речі, які вимагає лаба 8: помилка потрапляє в лог
 * (а не глушиться порожнім обробником) і процес завершується
 * НЕНУЛЬОВИМ кодом — інакше хостинг вважатиме зупинку штатною й
 * може не підняти новий процес.
 */
function harness() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });

  const handlers = new Map<string, (reason: unknown) => void>();
  const exits: number[] = [];

  installFatalHandlers({
    log: createLogger({ nodeEnv: "development", gitSha: "test" }, sink),
    exit: (code) => exits.push(code),
    on: (event, handler) => handlers.set(event, handler),
  });

  return { lines, handlers, exits };
}

describe("installFatalHandlers", () => {
  test("підписується на обидві події", () => {
    const { handlers } = harness();
    expect([...handlers.keys()].sort()).toEqual(["uncaughtException", "unhandledRejection"]);
  });

  test("uncaughtException: пише в лог і виходить з кодом 1", () => {
    const { lines, handlers, exits } = harness();
    handlers.get("uncaughtException")?.(new Error("все пропало"));

    const output = lines.join("");
    expect(output).toContain("uncaughtException");
    expect(output).toContain("все пропало");
    expect(output).toContain('"level":"fatal"');
    // Саме 1: нуль хостинг вважав би штатним завершенням.
    expect(exits).toEqual([1]);
  });

  test("unhandledRejection: так само", () => {
    const { lines, handlers, exits } = harness();
    handlers.get("unhandledRejection")?.(new Error("обіцянка без catch"));

    expect(lines.join("")).toContain("unhandledRejection");
    expect(exits).toEqual([1]);
  });

  test("кинути можна будь-що, не лише Error", () => {
    const { lines, handlers, exits } = harness();
    // `throw "рядок"` — валідний JavaScript, і обробник не має на ньому падати.
    handlers.get("uncaughtException")?.("просто рядок");

    expect(lines.join("")).toContain("просто рядок");
    expect(exits).toEqual([1]);
  });

  test("стек потрапляє в лог, коли він є", () => {
    const { lines, handlers } = harness();
    handlers.get("uncaughtException")?.(new Error("з деталями"));

    const entry = JSON.parse(lines.join("").trim());
    expect(entry.stack).toContain("Error: з деталями");
  });
});
