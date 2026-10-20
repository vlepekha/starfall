/**
 * Перевірка протоколу: кожне порушення має закривати сокет
 * із конкретним кодом. Запуск: npm run check:proto -w @starfall/server
 * (сервер має бути піднятий).
 */
import { WebSocket } from "ws";

const URL = "ws://127.0.0.1:8080/ws";

const probe = (name, action, { waitMs = 1500 } = {}) =>
  new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ name, result: "не закрито (таймаут тесту)" });
    }, waitMs);
    ws.on("open", () => action(ws));
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ name, result: `code ${code} — ${reason}` });
    });
    ws.on("error", () => {});
  });

const results = [];
results.push(await probe("невідомий тип", (ws) => ws.send(JSON.stringify({ type: "teleport" }))));
results.push(
  await probe("зламана форма (join без name)", (ws) =>
    ws.send(JSON.stringify({ type: "join", room: "x" })),
  ),
);
results.push(await probe("не JSON", (ws) => ws.send("{{{")));
results.push(
  await probe("завеликий розмір", (ws) =>
    ws.send(JSON.stringify({ type: "chat", text: "x".repeat(9000) })),
  ),
);
results.push(
  await probe("chat без join", (ws) => ws.send(JSON.stringify({ type: "chat", text: "hi" }))),
);
results.push(
  await probe("перевищення частоти", (ws) => {
    // Спершу коректний вхід, інакше нас відкинуло б раніше з "join first".
    ws.send(JSON.stringify({ type: "join", room: "flood-test", name: "Flood" }));
    for (let i = 0; i < 60; i += 1) ws.send(JSON.stringify({ type: "chat", text: `${i}` }));
  }),
);
results.push(await probe("join не надіслано (таймаут 5 с)", () => {}, { waitMs: 7000 }));

for (const r of results) console.log(`${r.name.padEnd(34)} → ${r.result}`);
