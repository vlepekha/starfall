import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { streamReplay } from "./match-log.js";

const MIME = {
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
export function resolveSafe(root, urlPath) {
  let decoded;
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
function hasDotDot(rawUrl) {
  const path = rawUrl.split("?")[0];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true; // битий відсотковий код — теж привід відмовити
  }
  return decoded.split(/[/\\]+/).includes("..");
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

async function readBody(req, limit = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Ліміт перевіряється ПІД ЧАС читання, а не після: інакше клієнт
    // міг би надіслати гігабайт, і ми б його спершу прийняли.
    if (size > limit) {
      const error = new Error("body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createHttpServer({ config, rooms, startedAt, getConnections, getMatches }) {
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

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

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

      if (url.pathname === "/api/rooms" && req.method === "GET") {
        return json(res, 200, { rooms: rooms.list(), updatedAt: new Date().toISOString() });
      }

      if (url.pathname === "/api/rooms" && req.method === "POST") {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: "не JSON" });
        }
        const id = typeof body.id === "string" ? body.id.trim().slice(0, 32) : "";
        if (!id) return json(res, 400, { error: "id: рядок 1..32 символів" });
        const room = rooms.ensure(id, { arena: body.arena ?? "classic" });
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
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      json(res, error.statusCode ?? 500, { error: error.message });
    }
  });

  return server;
}
