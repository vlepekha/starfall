/**
 * Чому подія "error" без слухача валить увесь процес.
 *
 * EventEmitter має для "error" окремий контракт: якщо слухача немає,
 * emit не просто нічого не робить — він КИДАЄ переданий об'єкт як виняток.
 * А кинутий з колбека виняток нікому ловити, тож процес завершується.
 *
 * Запуск: npm run demo:error -w @starfall/server
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const WITHOUT_LISTENER = `
  import { EventEmitter } from "node:events";
  const room = new EventEmitter();
  console.log("до emit");
  room.emit("error", new Error("сокет відвалився"));
  console.log("після emit — цього рядка не буде");
`;

const WITH_LISTENER = `
  import { EventEmitter } from "node:events";
  const room = new EventEmitter();
  room.on("error", (error) => console.log("слухач зловив:", error.message));
  console.log("до emit");
  room.emit("error", new Error("сокет відвалився"));
  console.log("після emit — процес живий");
`;

function run(label, source) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source]);
    let out = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      out += c;
    });
    child.on("exit", (code) => resolve({ label, code, out: out.trim() }));
  });
}

for (const [label, source] of [
  ["БЕЗ слухача error", WITHOUT_LISTENER],
  ["ЗІ слухачем error", WITH_LISTENER],
]) {
  const result = await run(label, source);
  console.log(`\n=== ${label} → процес завершився з кодом ${result.code} ===`);
  console.log(
    result.out
      .split("\n")
      .slice(0, 6)
      .map((line) => `  ${line}`)
      .join("\n"),
  );
}

// Той самий механізм на звичайному емітері всередині цього процесу —
// але тут слухач є, тому нічого не падає.
const safe = new EventEmitter();
safe.on("error", (error) =>
  console.log(`\nу цьому процесі: зловлено "${error.message}", живемо далі`),
);
safe.emit("error", new Error("тестова помилка"));
