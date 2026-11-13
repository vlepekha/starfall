import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createHttpServer } from "../src/http-server.ts";
import { createEventLoopProbe } from "../src/metrics.ts";
import { RoomRegistry } from "../src/room.ts";

/**
 * Ці перевірки піднімають справжній сервер на випадковому порту.
 *
 * Юніт-тест на renderMetrics уже є; тут питання інше — чи правильні
 * коди, заголовки й доступ. Саме це ламається при зміні маршрутизації
 * і саме цього не видно з чистих функцій.
 */

const base = { LOG_DIR: "/tmp/starfall-test-logs", CLIENT_DIR: "/tmp/starfall-test-client" };

function start(env: Record<string, string> = {}, { ready = () => true } = {}) {
  const config = loadConfig({ ...base, ...env });
  const rooms = new RoomRegistry();
  const loopProbe = createEventLoopProbe();
  const server = createHttpServer({
    config,
    rooms,
    startedAt: Date.now(),
    getConnections: () => 0,
    isReady: ready,
    loopProbe,
    metrics: {
      players: () => 0,
      rooms: () => rooms.size,
      connections: () => 0,
      messagesIn: () => 0,
      messagesOut: () => 0,
      bytesIn: () => 0,
      bytesOut: () => 0,
      tickMs: () => ({ avg: 0, p95: 0 }),
      droppedInputs: () => 0,
      closedByRateLimit: () => 0,
      closedByOrigin: () => 0,
      ready,
      messagesPerSecond: () => 0,
      bytesInPerSecond: () => 0,
      bytesOutPerSecond: () => 0,
    },
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe("/health", () => {
  let app: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    app = await start({ GIT_SHA: "abc1234" });
  });
  afterAll(() => app.close());

  test("відповідає 200 і показує SHA збірки", async () => {
    const response = await fetch(`${app.url}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    // Саме за цим полем перевіряють, що на хостингу потрібний тег.
    expect(body.sha).toBe("abc1234");
    expect(typeof body.uptimeSeconds).toBe("number");
  });
});

describe("/ready", () => {
  test("200, поки процес приймає гравців", async () => {
    const app = await start();
    const response = await fetch(`${app.url}/ready`);
    expect(response.status).toBe(200);
    expect((await response.json()).ready).toBe(true);
    await app.close();
  });

  /**
   * Головна відмінність від /health: під час зупинки процес ЖИВИЙ
   * (і /health це підтверджує), але нових гравців уже не бере.
   */
  test("503, коли процес зупиняється, а /health лишається 200", async () => {
    const app = await start({}, { ready: () => false });
    const ready = await fetch(`${app.url}/ready`);
    const health = await fetch(`${app.url}/health`);

    expect(ready.status).toBe(503);
    expect((await ready.json()).ready).toBe(false);
    expect(health.status).toBe(200);
    await app.close();
  });
});

describe("/metrics", () => {
  test("віддає формат Prometheus із правильним content-type", async () => {
    const app = await start();
    const response = await fetch(`${app.url}/metrics`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toMatch(/^starfall_up 1$/m);
    await app.close();
  });

  test("з токеном у конфігу без токена в запиті — 401", async () => {
    const app = await start({ METRICS_TOKEN: "sekret" });

    expect((await fetch(`${app.url}/metrics`)).status).toBe(401);
    expect((await fetch(`${app.url}/metrics?token=wrong`)).status).toBe(401);
    expect((await fetch(`${app.url}/metrics?token=sekret`)).status).toBe(200);

    const withHeader = await fetch(`${app.url}/metrics`, {
      headers: { authorization: "Bearer sekret" },
    });
    expect(withHeader.status).toBe(200);
    await app.close();
  });
});
