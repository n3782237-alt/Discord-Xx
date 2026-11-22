
(() => {
  "use strict";

  const STORAGE_KEY = "discord-x-guest-v1";

  const defaultState = {
    name: "Гость",
    username: "guest",
    servers: [
      {
        id: "home",
        name: "Мой сервер",
        icon: "🏠",
        channels: ["общий", "знакомство", "игры"]
      },
      {
        id: "games",
        name: "Игровой клуб",
        icon: "🎮",
        channels: ["общий", "minecraft", "cs2"]
      }
    ],
    messages: {}
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.servers)) {
        return { ...defaultState, ...saved };
      }
    } catch (error) {
      console.warn("Не удалось загрузить профиль:", error);
    }
    return structuredClone(defaultState);
  }

  let state = loadState();
  let activeServer = state.servers[0]?.id || "home";
  let activeChannel = "общий";

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  const css = `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #1e1f22;
      color: #f2f3f5;
    }
    button, input { font: inherit; }
    button { cursor: pointer; }
    #dx-app { height: 100vh; display: flex; overflow: hidden; }
    .dx-servers {
      width: 72px; background: #111214; padding: 12px 10px;
      display: flex; flex-direction: column; gap: 10px;
      align-items: center; overflow-y: auto;
    }
    .dx-server {
      width: 48px; height: 48px; border: 0; border-radius: 16px;
      background: #313338; color: white; font-size: 22px;
    }
    .dx-server.active, .dx-server:hover {
      background: #5865f2; border-radius: 13px;
    }
    .dx-add { background: #248046; }
    .dx-sidebar {
      width: 235px; background: #2b2d31;
      display: flex; flex-direction: column;
    }
    .dx-server-title {
      padding: 20px 16px; font-weight: bold;
      border-bottom: 1px solid #202225;
    }
    .dx-section {
      padding: 18px 12px 7px; color: #949ba4;
      font-size: 12px; text-transform: uppercase;
    }
    .dx-channel {
      margin: 2px 8px; padding: 10px;
      border: 0; border-radius: 5px; text-align: left;
      color: #b5bac1; background: transparent;
    }
    .dx-channel.active, .dx-channel:hover {
      background: #404249; color: white;
    }
    .dx-user {
      margin-top: auto; padding: 12px;
      background: #232428; display: flex;
      align-items: center; gap: 10px;
    }
    .dx-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: #5865f2; display: grid;
      place-items: center; font-weight: bold;
    }
    .dx-user-info { flex: 1; min-width: 0; }
    .dx-user-name { font-weight: bold; overflow: hidden; }
    .dx-user-tag { color: #aeb4bc; font-size: 12px; }
    .dx-settings {
      border: 0; background: transparent;
      color: white; font-size: 20px;
    }
    .dx-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .dx-top {
      height: 58px; display: flex; align-items: center;
      padding: 0 20px; border-bottom: 1px solid #17181a;
      font-weight: bold;
    }
    .dx-chat { flex: 1; overflow-y: auto; padding: 22px; }
    .dx-welcome { color: #aeb4bc; margin-bottom: 25px; }
    .dx-message { display: flex; gap: 12px; margin: 18px 0; }
    .dx-message-body { min-width: 0; }
    .dx-message-author { font-weight: bold; margin-bottom: 5px; }
    .dx-message-time { color: #949ba4; font-size: 11px; margin-left: 8px; }
    .dx-message-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .dx-compose { padding: 0 20px 22px; }
    .dx-compose form {
      display: flex; background: #383a40;
      border-radius: 9px; padding: 8px; gap: 8px;
    }
    .dx-compose input {
      flex: 1; min-width: 0; border: 0; outline: 0;
      background: transparent; color: white; padding: 10px;
    }
    .dx-send, .dx-primary {
      border: 0; border-radius: 6px; padding: 10px 16px;
      background: #5865f2; color: white;
    }
    .dx-empty { color: #aeb4bc; text-align: center; margin-top: 15vh; }
    .dx-modal-bg {
      position: fixed; inset: 0; background: #000a;
      display: grid; place-items: center; padding: 20px;
    }
    .dx-modal {
      width: min(440px, 100%); background: #2b2d31;
      border-radius: 12px; padding: 24px;
    }
    .dx-modal h2 { margin-top: 0; }
    .dx-modal label { display: block; margin: 14px 0 6px; color: #c5c8ce; }
    .dx-modal input {
      width: 100%; padding: 12px; border: 1px solid #454850;
      border-radius: 6px; background: #1e1f22; color: white;
    }
    .dx-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
    .dx-secondary { border: 0; background: #454850; color: white; padding: 10px 14px; border-radius: 6px; }
    .dx-note { color: #aeb4bc; font-size: 13px; line-height: 1.5; }
    @media(max-width:650px) {
      .dx-sidebar { width: 175px; }
      .dx-servers { width: 58px; padding: 8px 5px; }
      .dx-server { width: 42px; height: 42px; }
      .dx-chat { padding: 14px; }
    }
  `;

  function render() {
    const server = state.servers.find(s => s.id === activeServer)
      || state.servers[0];

    if (!server) return;

    if (!server.channels.includes(activeChannel)) {
      activeChannel = server.channels[0] || "общий";
    }

    const key = `${server.id}:${activeChannel}`;
    const messages = state.messages[key] || [];

    document.title = "Discord X";

    document.body.innerHTML = `
      <style>${css}</style>
      <div id="dx-app">
        <aside class="dx-servers">
          ${state.servers.map(s => `
            <button class="dx-server ${s.id === server.id ? "active" : ""}"
              data-server="${escapeHTML(s.id)}"
              title="${escapeHTML(s.name)}">
              ${escapeHTML(s.icon)}
            </button>
          `).join("")}
          <button class="dx-server dx-add" id="dx-add-server" title="Создать сервер">+</button>
        </aside>

        <aside class="dx-sidebar">
          <div class="dx-server-title">${escapeHTML(server.name)}</div>
          <div class="dx-section">Текстовые каналы</div>
          ${server.channels.map(channel => `
            <button class="dx-channel ${channel === activeChannel ? "active" : ""}"
              data-channel="${escapeHTML(channel)}">
              # ${escapeHTML(channel)}
            </button>
          `).join("")}
          <button class="dx-channel" id="dx-add-channel">＋ Добавить канал</button>

          <div class="dx-user">
            <div class="dx-avatar">${escapeHTML(state.name.charAt(0).toUpperCase())}</div>
            <div class="dx-user-info">
              <div class="dx-user-name">${escapeHTML(state.name)}</div>
              <div class="dx-user-tag">@${escapeHTML(state.username)}</div>
            </div>
            <button class="dx-settings" id="dx-settings" title="Настройки">⚙</button>
          </div>
        </aside>

        <main class="dx-main">
          <header class="dx-top"># ${escapeHTML(activeChannel)}</header>
          <section class="dx-chat" id="dx-chat">
            <div class="dx-welcome">
              <h2>Добро пожаловать в #${escapeHTML(activeChannel)}!</h2>
              Ты находишься на сервере «${escapeHTML(server.name)}».
            </div>
            ${messages.length ? messages.map(m => `
              <div class="dx-message">
                <div class="dx-avatar">${escapeHTML(m.name.charAt(0).toUpperCase())}</div>
                <div class="dx-message-body">
                  <div class="dx-message-author">
                    ${escapeHTML(m.name)}
                    <span class="dx-message-time">${escapeHTML(m.time)}</span>
                  </div>
                  <div class="dx-message-text">${escapeHTML(m.text)}</div>
                </div>
              </div>
            `).join("") : `
              <div class="dx-empty">Здесь пока нет сообщений. Напиши первым!</div>
            `}
          </section>
          <div class="dx-compose">
            <form id="dx-message-form">
              <input id="dx-message-input" autocomplete="off"
                placeholder="Написать в #${escapeHTML(activeChannel)}">
              <button class="dx-send" type="submit">Отправить</button>
            </form>
          </div>
        </main>
      </div>
    `;

    document.querySelectorAll("[data-server]").forEach(button => {
      button.addEventListener("click", () => {
        activeServer = button.dataset.server;
        const selected = state.servers.find(s => s.id === activeServer);
        activeChannel = selected.channels[0] || "общий";
        render();
      });
    });

    document.querySelectorAll("[data-channel]").forEach(button => {
      button.addEventListener("click", () => {
        activeChannel = button.dataset.channel;
        render();
      });
    });

    document.getElementById("dx-message-form").addEventListener("submit", event => {
      event.preventDefault();
      const input = document.getElementById("dx-message-input");
      const value = input.value.trim();
      if (!value) return;

      const messageKey = `${activeServer}:${activeChannel}`;
      if (!state.messages[messageKey]) state.messages[messageKey] = [];

      state.messages[messageKey].push({
        name: state.name,
        text: value,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      });

      save();
      render();
      document.getElementById("dx-chat").scrollTop = 999999;
    });

    document.getElementById("dx-settings").addEventListener("click", openSettings);

    document.getElementById("dx-add-server").addEventListener("click", () => {
      const name = prompt("Название нового сервера:");
      if (!name?.trim()) return;

      const id = "server-" + Date.now();
      state.servers.push({
        id,
        name: name.trim(),
        icon: "🌐",
        channels: ["общий"]
      });

      activeServer = id;
      activeChannel = "общий";
      save();
      render();
    });

    document.getElementById("dx-add-channel").addEventListener("click", () => {
      const name = prompt("Название канала:");
      if (!name?.trim()) return;

      const cleanName = name.trim().replace(/\s+/g, "-").toLowerCase();
      if (server.channels.includes(cleanName)) {
        alert("Такой канал уже существует.");
        return;
      }

      server.channels.push(cleanName);
      activeChannel = cleanName;
      save();
      render();
    });

    document.getElementById("dx-chat").scrollTop = 999999;
  }

  function openSettings() {
    const overlay = document.createElement("div");
    overlay.className = "dx-modal-bg";
    overlay.innerHTML = `
      <div class="dx-modal">
        <h2>Настройки профиля</h2>
        <label for="dx-name">Имя пользователя</label>
        <input id="dx-name" maxlength="32" value="${escapeHTML(state.name)}">
        <label for="dx-username">Юзернейм</label>
        <input id="dx-username" maxlength="24" value="${escapeHTML(state.username)}">
        <p class="dx-note">
          Сейчас ты используешь гостевой профиль. Изменения сохраняются
          на этом компьютере. Для полноценного аккаунта и синхронизации
          между устройствами потребуется подключение сервера.
        </p>
        <div class="dx-modal-actions">
          <button class="dx-secondary" id="dx-cancel">Отмена</button>
          <button class="dx-primary" id="dx-save">Сохранить</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#dx-cancel").onclick = () => overlay.remove();

    overlay.querySelector("#dx-save").onclick = () => {
      const name = overlay.querySelector("#dx-name").value.trim();
      const username = overlay.querySelector("#dx-username").value
        .trim().replace(/^@/, "").replace(/\s+/g, "");

      if (!name || !username) {
        alert("Заполни оба поля.");
        return;
      }

      state.name = name;
      state.username = username;
      save();
      overlay.remove();
      render();
    };

    overlay.addEventListener("click", event => {
      if (event.target === overlay) overlay.remove();
    });
  }

  render();
})();
