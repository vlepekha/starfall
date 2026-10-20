/**
 * DOM лобі. Єдиний модуль, що знає про розмітку; сам Lobby — чистий
 * EventTarget без жодного document. Тому логіку опитування можна
 * протестувати в Node, а цей файл замінити на інший UI.
 */
export function createLobbyView(root, lobby, { onJoin } = {}) {
  root.innerHTML = `
    <form class="lobby__form" autocomplete="off">
      <label class="lobby__field">
        <span>Позивний</span>
        <input id="lobby-name" type="text" maxlength="16" placeholder="Pilot" required />
      </label>
      <div class="lobby__status" id="lobby-status">з'єднання…</div>
    </form>
    <ul class="lobby__rooms" id="lobby-rooms"></ul>
    <p class="lobby__hint">Оберіть кімнату, щоб почати. Список оновлюється кожні 4 секунди.</p>
  `;

  const nameInput = root.querySelector("#lobby-name");
  const statusEl = root.querySelector("#lobby-status");
  const roomsEl = root.querySelector("#lobby-rooms");
  nameInput.value = localStorage.getItem("starfall:name") ?? "";

  function renderRooms(rooms) {
    roomsEl.replaceChildren();
    for (const room of rooms) {
      const full = room.players >= room.capacity;
      const item = document.createElement("li");
      item.className = "lobby__room";
      item.innerHTML = `
        <div class="lobby__room-main">
          <strong></strong>
          <span class="lobby__arena"></span>
        </div>
        <span class="lobby__players"></span>
        <button type="button"></button>
      `;
      item.querySelector("strong").textContent = room.name;
      item.querySelector(".lobby__arena").textContent = `арена: ${room.arena}`;
      item.querySelector(".lobby__players").textContent = `${room.players}/${room.capacity}`;
      const button = item.querySelector("button");
      button.textContent = full ? "Повна" : "Join";
      button.disabled = full;
      button.addEventListener("click", () => {
        const name = nameInput.value.trim() || "Pilot";
        localStorage.setItem("starfall:name", name);
        const joined = lobby.join({ name, roomId: room.id });
        onJoin?.({ name, room: joined });
      });
      roomsEl.append(item);
    }
  }

  lobby.addEventListener("rooms", (event) => {
    renderRooms(event.detail.rooms);
    const time = new Date(event.detail.updatedAt).toLocaleTimeString();
    statusEl.textContent = `оновлено ${time}`;
    statusEl.classList.remove("is-bad");
  });

  lobby.addEventListener("error", (event) => {
    statusEl.textContent = `${event.detail.error} — повтор за 4 с`;
    statusEl.classList.add("is-bad");
  });

  lobby.addEventListener("status", (event) => {
    if (event.detail.status === "loading" && !roomsEl.children.length) {
      statusEl.textContent = "з'єднання…";
    }
  });

  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}
