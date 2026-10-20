import { defineConfig } from "vite";

/**
 * У лабі 3 тут жило міні-API. Тепер його місце зайняв справжній сервер
 * із server/, а Vite лише проксує до нього /api і /ws — щоб у розробці
 * клієнт і сервер виглядали як один origin і не було CORS.
 *
 * Лишилися тільки «ручки» для галереї збоїв із лаби 3: вони навмисно
 * локальні, бо імітують зламану мережу, а не поведінку сервера.
 */
const flaky = new Map();

function faultInjection() {
  return async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");

    const delay = Number(url.searchParams.get("delay") ?? 0);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const flakyCount = Number(url.searchParams.get("flaky") ?? 0);
    if (flakyCount > 0) {
      const seen = flaky.get(url.pathname) ?? 0;
      if (seen < flakyCount) {
        flaky.set(url.pathname, seen + 1);
        res.statusCode = 500;
        res.end("flaky");
        return;
      }
      flaky.delete(url.pathname);
    }

    // Чесний 404: інакше dev-сервер віддав би index.html зі статусом 200.
    if (url.pathname.endsWith("-missing.png")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    if (url.pathname === "/api/broken-json") {
      res.setHeader("content-type", "application/json");
      res.end('{ "asteroidLimit": 12, '); // навмисно обірваний JSON
      return;
    }

    next();
  };
}

const faultPlugin = {
  name: "starfall-faults",
  configureServer(server) {
    server.middlewares.use(faultInjection());
  },
  configurePreviewServer(server) {
    server.middlewares.use(faultInjection());
  },
};

const SERVER = process.env.SERVER_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [faultPlugin],
  server: {
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/ws": { target: SERVER.replace("http", "ws"), ws: true },
    },
  },
});
