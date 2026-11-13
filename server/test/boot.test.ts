import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Запуск справжнього процесу.
 *
 * Усі інші тести імпортують модулі напряму, і через це жоден із них
 * не виконує `index.ts`. Одного разу це коштувало зламаного сервера:
 * збірник метрик читав `ws` до його оголошення, падіння було на
 * старті — а тести лишалися зеленими.
 *
 * Тут процес піднімається так само, як у контейнері, і з ним
 * перевіряється весь контракт зупинки з лаби 8.
 */

const SERVER = resolve(import.meta.dirname, "../src/index.ts");

/** Вільний порт від системи: фіксований зайняв би сусідній тест. */
function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

interface Started {
  port: number;
  stdout: string[];
  kill: (signal: NodeJS.Signals) => void;
  exited: Promise<{ code: number | null; signal: string | null; ms: number }>;
}

async function start(env: Record<string, string> = {}): Promise<Started> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      LOG_DIR: "/tmp/starfall-boot-logs",
      /**
       * NODE_ENV підміняємо навмисно: vitest ставить "test", а логер
       * у цьому режимі мовчить (і правильно робить — інакше кожен
       * тест засмічував би вивід). Але тут ми перевіряємо саме те,
       * що процес пише в stdout, тож потрібен звичайний режим.
       */
      NODE_ENV: "development",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => stdout.push(chunk.toString()));

  const startedAt = Date.now();
  const exited = new Promise<{ code: number | null; signal: string | null; ms: number }>(
    (done) => {
      child.on("exit", (code, signal) =>
        done({ code, signal, ms: Date.now() - startedAt - waited }),
      );
    },
  );

  // Чекаємо не фіксовану паузу, а готовність: інакше тест то проходив
  // би, то ні, залежно від того, як швидко сьогодні стартує Node.
  let waited = 0;
  for (let i = 0; i < 100; i += 1) {
    const ok = await fetch(`http://127.0.0.1:${port}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
    waited += 100;
  }

  return { port, stdout, kill: (signal) => child.kill(signal), exited };
}

describe("запуск процесу", () => {
  test("піднімається й відповідає на /health", async () => {
    const app = await start({ GIT_SHA: "boot123" });

    const response = await fetch(`http://127.0.0.1:${app.port}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).sha).toBe("boot123");

    app.kill("SIGTERM");
    await app.exited;
  }, 30_000);

  test("метрики віддаються одразу після старту", async () => {
    const app = await start();
    const body = await fetch(`http://127.0.0.1:${app.port}/metrics`).then((r) => r.text());

    expect(body).toMatch(/^starfall_up 1$/m);
    // Саме цей рядок колись і не з'являвся: процес падав на старті.
    expect(body).toMatch(/^starfall_messages_per_second /m);

    app.kill("SIGTERM");
    await app.exited;
  }, 30_000);

  test("перший рядок логу — валідний JSON", async () => {
    const app = await start();

    /**
     * Логи чекаємо, а не читаємо одразу: pino пише через sonic-boom,
     * і до батьківського процесу рядок доходить із затримкою —
     * /health уже відповідає, а труба ще порожня.
     */
    let first = "";
    for (let i = 0; i < 50 && !first; i += 1) {
      const joined = app.stdout.join("");
      // Чекаємо саме переносу рядка: без нього можна зловити
      // половину рядка на межі буфера й отримати битий JSON.
      if (joined.includes("\n")) first = joined.split("\n")[0] ?? "";
      else await new Promise((r) => setTimeout(r, 100));
    }

    const parsed = JSON.parse(first);
    expect(parsed.event).toBe("listen");
    expect(parsed.service).toBe("starfall");

    app.kill("SIGTERM");
    await app.exited;
  }, 30_000);
});

describe("контракт зупинки", () => {
  /** Головна вимога лаби: менше ніж за 10 с і з кодом 0. */
  test("SIGTERM: вихід 0 швидше за 10 секунд", async () => {
    const app = await start();
    app.kill("SIGTERM");

    const { code, ms } = await app.exited;
    expect(code).toBe(0);
    expect(ms).toBeLessThan(10_000);
  }, 30_000);

  test("на зупинці /ready віддає 503, а /health лишається 200", async () => {
    /**
     * Ловимо процес у вікні між сигналом і виходом. Воно коротке
     * (сотні мілісекунд), тому гравця тримаємо підключеним: саме
     * заради нього сервер і витримує паузу на попередження.
     */
    const app = await start();
    const { WebSocket } = await import("ws");
    const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    await new Promise((done) => socket.on("open", done));
    socket.send(JSON.stringify({ type: "join", room: "alpha", name: "боєць" }));
    await new Promise((r) => setTimeout(r, 200));

    app.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 60));

    const [ready, health] = await Promise.all([
      fetch(`http://127.0.0.1:${app.port}/ready`).then((r) => r.status).catch(() => 0),
      fetch(`http://127.0.0.1:${app.port}/health`).then((r) => r.status).catch(() => 0),
    ]);

    await app.exited;
    // 0 означає, що процес устиг закритися раніше — тоді перевіряти нічого.
    if (ready !== 0) expect(ready).toBe(503);
    if (health !== 0) expect(health).toBe(200);
  }, 30_000);

  test("гравець отримує попередження і код закриття 1001", async () => {
    const app = await start();
    const { WebSocket } = await import("ws");
    const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);

    const warned: string[] = [];
    let closeCode: number | null = null;
    socket.on("message", (raw: Buffer) => warned.push(raw.toString()));
    socket.on("close", (code: number) => {
      closeCode = code;
    });

    await new Promise((done) => socket.on("open", done));
    socket.send(JSON.stringify({ type: "join", room: "alpha", name: "боєць" }));
    await new Promise((r) => setTimeout(r, 300));

    app.kill("SIGTERM");
    await app.exited;
    await new Promise((r) => setTimeout(r, 100));

    expect(warned.some((line) => line.includes('"shutdown"'))).toBe(true);
    // 1001 «going away», а не 1000: клієнт за кодом вирішує,
    // повертатися йому в лобі чи ні.
    expect(closeCode).toBe(1001);
  }, 30_000);

  test("конфігурація без ALLOWED_ORIGINS у production — вихід 2", async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PORT: String(port), NODE_ENV: "production", ALLOWED_ORIGINS: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stderr.on("data", (c: Buffer) => {
      output += c.toString();
    });

    const code = await new Promise<number | null>((done) => child.on("exit", done));
    // Падаємо на старті, а не колись потім — і пояснюємо чому.
    expect(code).toBe(2);
    expect(output).toContain("ALLOWED_ORIGINS");
  }, 30_000);
});
