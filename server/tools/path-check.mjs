/**
 * Перевірка захисту від виходу за межі каталогу — без мережі,
 * просто на функції resolveSafe.
 *
 * Запуск: npm run check:paths -w @starfall/server
 */
import { resolveSafe } from "../src/http-server.js";

const ROOT = "/srv/app/dist";

const CASES = [
  ["/index.html", true],
  ["/assets/ships.png", true],
  ["/", true],
  ["/../../../../etc/passwd", false],
  ["/%2e%2e%2f%2e%2e%2fetc%2fpasswd", false],
  ["/assets/../../../etc/passwd", false],
  ["/..%2f..%2fpackage.json", false],
  ["/assets/..\\..\\secret", false],
  ["/%00/etc/passwd", false],
  ["/%zz", false],
];

let failures = 0;
for (const [path, shouldPass] of CASES) {
  const result = resolveSafe(ROOT, path);
  const allowed = result !== null;
  const ok = allowed === shouldPass;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${path.padEnd(34)} → ${allowed ? result : "відхилено (403)"}`,
  );
}
console.log(failures === 0 ? "\nусі перевірки пройдено" : `\nпровалено: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
