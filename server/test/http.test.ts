import { describe, expect, test } from "vitest";
import { resolveSafe } from "../src/http-server.ts";

const ROOT = "/srv/app/dist";

describe("resolveSafe", () => {
  test.each([
    ["/index.html", true],
    ["/assets/ships.png", true],
    ["/", true],
  ])("дозволяє %s", (path, allowed) => {
    expect(resolveSafe(ROOT, path) !== null).toBe(allowed);
  });

  test.each([
    "/../../../../etc/passwd",
    "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/assets/../../../etc/passwd",
    "/..%2f..%2fpackage.json",
    "/assets/..\\..\\secret",
    "/%00/etc/passwd",
    "/%zz",
  ])("відхиляє %s", (path) => {
    expect(resolveSafe(ROOT, path)).toBeNull();
  });

  test("дозволений шлях веде всередину каталогу", () => {
    expect(resolveSafe(ROOT, "/assets/x.png")).toBe("/srv/app/dist/assets/x.png");
  });
});
