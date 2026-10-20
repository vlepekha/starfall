/**
 * DOM лобі. Єдиний модуль, що знає про розмітку; сам Lobby — чистий
 * EventTarget без жодного document. Тому логіку опитування можна
 * протестувати в Node, а цей файл замінити на інший UI.
 */
import { el, input as inputEl } from "../dom.ts";
import { onCustom } from "../events.ts";
import type { Lobby, RoomInfo } from "./lobby.ts";

export interface LobbyView {
  show(): void;
  hide(): void;
}

export function createLobbyView(
  root: HTMLElement,
  lobby: Lobby,
  { onJoin }: { onJoin?: (joined: { name: string; room: RoomInfo | null }) => void } = {},
): LobbyView {
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

  const nameInput = inputEl("#lobby-name", root);
  const statusEl = el("#lobby-status", root);
  const roomsEl = el("#lobby-rooms", root);
  nameInput.value = localStorage.getItem("starfall:name") ?? "";

  function renderRooms(rooms: RoomInfo[]): void {
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
      el("strong", item).textContent = room.name;
      el(".lobby__arena", item).textContent = `арена: ${room.arena}`;
      el(".lobby__players", item).textContent = `${room.players}/${room.capacity}`;
      const button = el<HTMLButtonElement>("button", item);
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

  onCustom<{ rooms: RoomInfo[]; updatedAt: string }>(lobby, "rooms", (detail) => {
    renderRooms(detail.rooms);
    const time = new Date(detail.updatedAt).toLocaleTimeString();
    statusEl.textContent = `оновлено ${time}`;
    statusEl.classList.remove("is-bad");
  });

  onCustom<{ error: string }>(lobby, "error", (detail) => {
    statusEl.textContent = `${detail.error} — повтор за 4 с`;
    statusEl.classList.add("is-bad");
  });

  onCustom<{ status: string }>(lobby, "status", (detail) => {
    if (detail.status === "loading" && !roomsEl.children.length) {
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
