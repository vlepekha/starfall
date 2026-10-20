/**
 * Чат і стрічка подій кімнати. Увесь DOM тут; сам GameSocket про розмітку
 * не знає нічого — так само, як Lobby з лаби 3.
 */
import { el, input as inputEl } from "../dom.ts";
import { onCustom } from "../events.ts";
import type { GameSocket } from "../net/socket.ts";

export interface ChatView {
  show(): void;
  hide(): void;
  line(text: string, kind?: string): void;
}

export function createChatView(root: HTMLElement, socket: GameSocket): ChatView {
  root.innerHTML = `
    <div class="chat__head">
      <span class="chat__room" id="chat-room">—</span>
      <span class="chat__state" id="chat-state">офлайн</span>
    </div>
    <ul class="chat__log" id="chat-log"></ul>
    <form class="chat__form" id="chat-form" autocomplete="off">
      <input id="chat-input" type="text" maxlength="240" placeholder="Повідомлення…" />
      <button type="submit">Send</button>
    </form>
  `;

  const logEl = el("#chat-log", root);
  const stateEl = el("#chat-state", root);
  const roomEl = el("#chat-room", root);
  const form = el<HTMLFormElement>("#chat-form", root);
  const input = inputEl("#chat-input", root);

  function line(text: string, kind = "info"): void {
    const item = document.createElement("li");
    item.className = `chat__line chat__line--${kind}`;
    item.textContent = text;
    logEl.append(item);
    while (logEl.children.length > 80) logEl.firstChild?.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const sentNow = socket.send("chat", { text });
    input.value = "";
    // Якщо з'єднання немає, повідомлення не зникає — воно в черзі.
    if (!sentNow) line(`(у черзі) ${text}`, "queued");
  });

  const STATE_LABELS: Record<string, string> = {
    idle: "офлайн",
    connecting: "підключення…",
    reconnecting: "перепідключення…",
    open: "онлайн",
    waiting: "очікування",
    closed: "з'єднання закрито",
  };

  onCustom<{ state: string; attempt?: number; delay?: number }>(
    socket,
    "state",
    ({ state, attempt, delay }) => {
      stateEl.textContent =
        state === "waiting"
          ? `повтор ${attempt} через ${Math.round((delay ?? 0) / 1000)} с`
          : (STATE_LABELS[state] ?? state);
      stateEl.dataset.state = state;
    },
  );

  onCustom<{ room: { name: string; players: number; capacity: number }; you: { name: string } }>(
    socket,
    "joined",
    ({ room, you }) => {
      roomEl.textContent = `${room.name} · ${room.players}/${room.capacity}`;
      line(`ви увійшли як ${you.name}`, "me");
    },
  );

  onCustom<{ name: string; players: number }>(socket, "player-joined", (detail) => {
    roomEl.textContent = (roomEl.textContent ?? "").replace(/\d+\//, `${detail.players}/`);
    line(`${detail.name} приєднався`, "join");
  });

  onCustom<{ name: string; players: number }>(socket, "player-left", (detail) => {
    roomEl.textContent = (roomEl.textContent ?? "").replace(/\d+\//, `${detail.players}/`);
    line(`${detail.name} вийшов`, "leave");
  });

  onCustom<{ from: string; text: string }>(socket, "chat", (detail) => {
    line(`${detail.from}: ${detail.text}`, "chat");
  });

  onCustom<{ code: number; reason: string }>(socket, "closed", ({ code, reason }) => {
    if (code !== 1000) line(`з'єднання закрито: ${code} ${reason || ""}`.trim(), "error");
  });

  onCustom<{ count: number }>(socket, "flush", (detail) => {
    if (detail.count > 0) line(`надіслано з черги: ${detail.count}`, "info");
  });

  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    line,
  };
}
