/**
 * Чат і стрічка подій кімнати. Увесь DOM тут; сам GameSocket про розмітку
 * не знає нічого — так само, як Lobby з лаби 3.
 */
export function createChatView(root, socket) {
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

  const logEl = root.querySelector("#chat-log");
  const stateEl = root.querySelector("#chat-state");
  const roomEl = root.querySelector("#chat-room");
  const form = root.querySelector("#chat-form");
  const input = root.querySelector("#chat-input");

  function line(text, kind = "info") {
    const item = document.createElement("li");
    item.className = `chat__line chat__line--${kind}`;
    item.textContent = text;
    logEl.append(item);
    while (logEl.children.length > 80) logEl.firstChild.remove();
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

  const STATE_LABELS = {
    idle: "офлайн",
    connecting: "підключення…",
    reconnecting: "перепідключення…",
    open: "онлайн",
    waiting: "очікування",
    closed: "з'єднання закрито",
  };

  socket.addEventListener("state", (event) => {
    const { state, attempt, delay } = event.detail;
    stateEl.textContent =
      state === "waiting"
        ? `повтор ${attempt} через ${Math.round(delay / 1000)} с`
        : (STATE_LABELS[state] ?? state);
    stateEl.dataset.state = state;
  });

  socket.addEventListener("joined", (event) => {
    const { room, you } = event.detail;
    roomEl.textContent = `${room.name} · ${room.players}/${room.capacity}`;
    line(`ви увійшли як ${you.name}`, "me");
  });

  socket.addEventListener("player-joined", (event) => {
    roomEl.textContent = roomEl.textContent.replace(/\d+\//, `${event.detail.players}/`);
    line(`${event.detail.name} приєднався`, "join");
  });

  socket.addEventListener("player-left", (event) => {
    roomEl.textContent = roomEl.textContent.replace(/\d+\//, `${event.detail.players}/`);
    line(`${event.detail.name} вийшов`, "leave");
  });

  socket.addEventListener("chat", (event) => {
    line(`${event.detail.from}: ${event.detail.text}`, "chat");
  });

  socket.addEventListener("closed", (event) => {
    const { code, reason } = event.detail;
    if (code !== 1000) line(`з'єднання закрито: ${code} ${reason || ""}`.trim(), "error");
  });

  socket.addEventListener("flush", (event) => {
    if (event.detail.count > 0) line(`надіслано з черги: ${event.detail.count}`, "info");
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
