import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Config } from "./config.ts";
import { streamReplay } from "./match-log.ts";
import type { RoomRegistry } from "./room.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Захист від виходу за межі каталогу.
 *
 * Класична діра: GET /../../etc/passwd. Перевіряти рядок на наявність ".."
 * мало — браузер може надіслати %2e%2e, а normalize() розгорне це вже після
 * декодування. Тому рішення приймаємо за РЕЗУЛЬТАТОМ: куди шлях веде
 * після нормалізації. Якщо не всередину клієнтського каталогу — 403.
 */
export function resolveSafe(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // битий відсотковий код
  }
  if (decoded.includes("\0")) return null;

  // Перша лінія: жодного сегмента ".." — незалежно від того, як його
  // записали (".." , "%2e%2e", "..\\"). Такий запит відхиляємо, а не
  // «виправляємо»: нормальний клієнт його просто не надсилає.
  const segments = decoded.split(/[/\\]+/);
  if (segments.includes("..")) return null;

  // Друга лінія — на випадок, якщо перша чогось не передбачила:
  // дивимося не на рядок, а на те, КУДИ шлях веде після нормалізації.
  const target = resolve(join(root, normalize(decoded)));
  const prefix = resolve(root) + sep;
  if (target !== resolve(root) && !target.startsWith(prefix)) return null;
  return target;
}

/** Сегмент ".." у сирому шляху — у будь-якому написанні. */
function hasDotDot(rawUrl: string | undefined): boolean {
  if (!rawUrl) return true;
  const path = rawUrl.split("?")[0] ?? "";
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true; // битий відсотковий код — теж привід відмовити
  }
  return decoded.split(/[/\\]+/).includes("..");
}

/** Помилка з кодом відповіді: у catch тип unknown, тож це треба розрізняти. */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

async function readBody(req: IncomingMessage, limit = 8192): Promise<string> {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Ліміт перевіряється ПІД ЧАС читання, а не після: інакше клієнт
    // міг би надіслати гігабайт, і ми б його спершу прийняли.
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface HttpServerOptions {
  config: Config;
  rooms: RoomRegistry;
  startedAt: number;
  getConnections: () => number;
  getMatches?: () => unknown[];
  getMatchStats?: () => unknown[];
}

export function createHttpServer({
  config,
  rooms,
  startedAt,
  getConnections,
  getMatches,
  getMatchStats,
}: HttpServerOptions): Server {
  const server = createServer(async (req, res) => {
    /**
     * Перевіряємо СИРИЙ рядок запиту до того, як його торкнеться URL.
     *
     * Конструктор URL сам згортає "/a/../b" у "/b", тож до нашого коду
     * сегмент ".." просто не доїде, і відхилити запит «як вимагає умова»
     * було б уже нічим. Тому дивимося на те, що клієнт надіслав насправді.
     */
    if (hasDotDot(req.url)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("forbidden: path traversal");
      return;
    }

    /**
     * `req.url` у типах Node — `string | undefined`, і це не формальність:
     * для запиту CONNECT його справді немає. Раніше тут був би
     * `TypeError: Invalid URL` просто від кривого запиту.
     */
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          rooms: rooms.size,
          connections: getConnections(),
          matches: getMatches?.() ?? [],
          rss: process.memoryUsage().rss,
          pid: process.pid,
        });
      }

      /**
       * Статистика симуляції: тривалість тіка і джитер.
       * Саме вона першою показує, що серверу перестає вистачати часу —
       * задовго до того, як це помітять гравці.
       */
      if (url.pathname === "/api/stats") {
        return json(res, 200, {
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          tickHz: 30,
          matches: getMatchStats?.() ?? [],
          memory: {
            rssMb: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
            heapUsedMb: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
          },
        });
      }

      if (url.pathname === "/api/rooms" && req.method === "GET") {
        return json(res, 200, { rooms: rooms.list(), updatedAt: new Date().toISOString() });
      }

      if (url.pathname === "/api/rooms" && req.method === "POST") {
        const raw = await readBody(req);
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: "не JSON" });
        }
        // body — unknown: читаємо поле лише після перевірки форми.
        const rawId =
          typeof body === "object" && body !== null ? Reflect.get(body, "id") : undefined;
        const id = typeof rawId === "string" ? rawId.trim().slice(0, 32) : "";
        if (!id) return json(res, 400, { error: "id: рядок 1..32 символів" });
        const arena =
          typeof body === "object" && body !== null ? Reflect.get(body, "arena") : undefined;
        const room = rooms.ensure(id, { arena: typeof arena === "string" ? arena : "classic" });
        return json(res, 201, { room: room.toJSON() });
      }

      if (url.pathname.startsWith("/api/replay/")) {
        const roomId = url.pathname.slice("/api/replay/".length);
        if (!/^[\w-]{1,32}$/.test(roomId)) return json(res, 400, { error: "поганий id" });
        return await streamReplay(config.logDir, roomId, res);
      }

      if (url.pathname.startsWith("/api/")) {
        return json(res, 404, { error: "немає такого ендпойнта" });
      }

      // Статика зібраного клієнта.
      const target = resolveSafe(
        config.clientDir,
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      if (!target) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        return res.end("forbidden");
      }

      const info = await stat(target).catch(() => null);
      if (!info?.isFile()) {
        // SPA-фолбек: будь-який невідомий шлях віддає index.html.
        const index = join(config.clientDir, "index.html");
        const indexInfo = await stat(index).catch(() => null);
        if (!indexInfo) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          return res.end("клієнт не зібраний — запустіть npm run build");
        }
        res.writeHead(200, { "content-type": MIME[".html"] });
        return await pipeline(createReadStream(index), res);
      }

      res.writeHead(200, {
        "content-type": MIME[extname(target)] ?? "application/octet-stream",
        "content-length": info.size,
      });
      // Статика теж потоком: файл у 5 МБ не має опинятися в пам'яті цілком.
      await pipeline(createReadStream(target), res);
    } catch (error: unknown) {
      // `unknown`, а не `any`: перш ніж читати .message, треба довести,
      // що це справді помилка. Кинути можна будь-що, навіть рядок.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : String(error);
      json(res, status, { error: message });
    }
  });

  return server;
}
