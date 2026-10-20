import { defineConfig } from "vite";

/**
 * Міні-API для лаби 3. У лабі 4 його замінить справжній сервер на Node,
 * тому тут навмисно мінімум: список кімнат, керована затримка та
 * дві ручки для «галереї збоїв» (битий JSON і нестабільні 5xx).
 */
const ROOMS = [
  { id: "alpha", name: "Alpha Belt", players: 2, capacity: 6, arena: "classic" },
  { id: "dust", name: "Dust Lane", players: 5, capacity: 6, arena: "dense" },
  { id: "quiet", name: "Quiet Orbit", players: 0, capacity: 4, arena: "sparse" },
];

const flaky = new Map();

function api() {
  return async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");

    // Штучна затримка — нею ж імітується таймаут мережі.
    const delay = Number(url.searchParams.get("delay") ?? 0);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    // Перші N звернень відповідають 500 — перевірка повторів із backoff.
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

    if (url.pathname === "/api/rooms") {
      // Невеликий «живий» рух гравців, щоб опитування мало сенс.
      const rooms = ROOMS.map((room) => ({
        ...room,
        players: Math.min(room.capacity, Math.max(0, room.players + (Math.random() < 0.3 ? 1 : 0))),
      }));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ rooms, updatedAt: new Date().toISOString() }));
      return;
    }

    // Чесний 404: інакше dev-сервер Vite віддав би index.html зі статусом 200,
    // і замість «файлу немає» ми побачили б «не вдалося декодувати зображення».
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

const apiPlugin = {
  name: "starfall-api",
  configureServer(server) {
    server.middlewares.use(api());
  },
  configurePreviewServer(server) {
    server.middlewares.use(api());
  },
};

export default defineConfig({ plugins: [apiPlugin] });
