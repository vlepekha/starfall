import { millis, seq } from "@starfall/shared";
import { encodeInput } from "@starfall/shared/protocol";
import { WebSocket } from "ws";

const COUNT = Number(process.argv[2] ?? 8);
const ROOM = process.argv[3] ?? "alpha";
for (let i = 0; i < COUNT; i += 1) {
  const ws = new WebSocket("ws://127.0.0.1:8080/ws");
  ws.binaryType = "arraybuffer";
  let n = 0;
  ws.on("open", () => ws.send(JSON.stringify({ type: "join", room: ROOM, name: `bot${i}` })));
  ws.on("message", (raw, isBinary) => {
    if (isBinary || !String(raw).includes('"joined"')) return;
    setInterval(() => {
      n += 1;
      const phase = (n + i * 17) % 180;
      ws.send(
        encodeInput({
          seq: seq(n),
          clientTimeMs: millis(Date.now() % 4294967295),
          input: {
            left: phase > 120,
            right: phase <= 60,
            thrust: phase % 7 !== 0,
            brake: false,
            fire: phase % 12 === 0,
          },
        }),
      );
    }, 1000 / 30);
  });
  ws.on("error", () => {});
}
console.log(`${COUNT} ботів у кімнаті ${ROOM}`);
