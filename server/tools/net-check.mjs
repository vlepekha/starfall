/**
 * Перевірка мережевого шару без браузера: бот заходить у кімнату,
 * шле input 30 разів на секунду і рахує, що приходить у відповідь.
 *
 * Запуск: npm run check:net -w @starfall/server (сервер має бути піднятий)
 */
import { decodeSnapshot, encodeInput } from "@starfall/shared/protocol";
import { WebSocket } from "ws";

const URL_BASE = process.env.WS_URL ?? "ws://127.0.0.1:8080/ws";
const SECONDS = Number(process.env.SECONDS ?? 3);

function run(label, { json = false } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(json ? `${URL_BASE}?proto=json` : URL_BASE);
    ws.binaryType = "arraybuffer";

    const stats = {
      snapshots: 0,
      bytesIn: 0,
      bytesOut: 0,
      acks: [],
      ticks: [],
      entities: 0,
      lastAt: 0,
    };
    let seq = 0;
    let inputTimer = null;

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", room: "net-check", name: label.slice(0, 16) }));
    });

    ws.on("message", (raw, isBinary) => {
      stats.bytesIn += raw.length ?? raw.byteLength;

      if (!isBinary) {
        const text = raw.toString();
        if (text.includes('"joined"')) {
          // Після входу починаємо слати наміри в темпі симуляції.
          inputTimer = setInterval(() => {
            seq += 1;
            const frame = encodeInput({
              seq,
              input: { left: false, right: true, thrust: true, brake: false, fire: seq % 10 === 0 },
              clientTimeMs: Date.now() % 4294967295,
            });
            stats.bytesOut += frame.byteLength;
            ws.send(frame);
          }, 1000 / 30);
          return;
        }
        if (json && text.includes('"snapshot"')) {
          const snap = JSON.parse(text);
          stats.snapshots += 1;
          stats.entities = snap.entities.length;
          stats.acks.push(snap.ackSeq);
          stats.ticks.push(snap.tick);
          stats.lastAt = Date.now();
          if (!measureFrom) measureFrom = Date.now();
        }
        return;
      }

      const snapshot = decodeSnapshot(new Uint8Array(raw));
      if (!snapshot) return;
      stats.snapshots += 1;
      stats.entities = snapshot.entities.length;
      stats.acks.push(snapshot.ackSeq);
      stats.ticks.push(snapshot.tick);
      stats.lastAt = Date.now();
      if (!measureFrom) measureFrom = Date.now();
    });

    let measureFrom = 0;
    setTimeout(
      () => {
        clearInterval(inputTimer);
        ws.close();
        // Ділимо на час ВІД ПЕРШОГО знімка до останнього, а не на задумані
        // SECONDS: вхід у кімнату й закриття додають «хвости», через які
        // частота виходила на 10% вищою за справжні 30 тіків/с.
        const elapsed = (stats.lastAt - measureFrom) / 1000 || SECONDS;
        const perSnapshot = stats.snapshots ? stats.bytesIn / stats.snapshots : 0;
        const tickSpan = stats.ticks.length > 1 ? stats.ticks.at(-1) - stats.ticks[0] : 0;
        resolve({
          label,
          tickRate: +(tickSpan / elapsed).toFixed(1),
          snapshotsPerSecond: +((stats.snapshots - 1) / elapsed).toFixed(1),
          bytesPerSecond: Math.round(stats.bytesIn / elapsed),
          bytesPerSnapshot: Math.round(perSnapshot),
          entities: stats.entities,
          inputsAcked: stats.acks.at(-1) ?? 0,
          inputsSent: seq,
        });
      },
      SECONDS * 1000 + 400,
    );
  });
}

const binary = await run("binary-bot");
const json = await run("json-bot", { json: true });

console.log(`за ${SECONDS} с, ${binary.entities} сутностей у світі\n`);
console.log("| Формат | тіків/с | знімків/с | байтів/знімок | байтів/с | input надісл./підтв. |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const r of [binary, json]) {
  console.log(
    `| ${r.label === "binary-bot" ? "бінарний" : "JSON"} | ${r.tickRate} | ${r.snapshotsPerSecond} | ${r.bytesPerSnapshot} | ${r.bytesPerSecond} | ${r.inputsSent} / ${r.inputsAcked} |`,
  );
}
const ratio = json.bytesPerSnapshot / binary.bytesPerSnapshot;
console.log(`\nJSON більший у ${ratio.toFixed(1)} раза`);
