"use strict";

/* =========================================================
   DISCORD X — основной клиент
   Онлайн-режим: существующий API + Socket.IO.
   Гостевой режим: локальные серверы и сообщения.
   ========================================================= */

const API = "http://localhost:4000";
const STORAGE = "discord_x_client_v2";

let token = localStorage.getItem("dx_token") || "";
let me = null;
let servers = [];
let currentServer = null;
let currentChannel = null;
let socket = null;
let online = false;
let localMode = false;
let callRoom = null;
let localStream = null;
let peers = new Map();
let muted = false;
let videoOn = false;

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function uid() {
  return "dx_" + Math.random().toString(36).slice(2, 11);
}

function notify(message) {
  let el = $("dxToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "dxToast";
    el.style.cssText =
      "position:fixed;bottom:25px;left:50%;transform:translateX(-50%);" +
      "background:#20232d;color:white;padding:13px 20px;border-radius:12px;" +
      "z-index:99999;box-shadow:0 8px 30px #0008;font:14px Arial";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.style.display = "none", 2800);
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE)) || {};
  } catch {
    return {};
  }
}

function saveLocal() {
  localStorage.setItem(STORAGE, JSON.stringify({
    me, servers, currentServerId: currentServer?.id || null,
    currentChannelId: currentChannel?.id || null
  }));
}

function makeGuest() {
  const saved = readLocal();
  me = saved.me || {
    id: uid(),
    username: "Гость",
    displayName: "Гость",
    tier: "FREE",
    coins: 1000,
    email: "",
    guest: true,
    createdAt: new Date().toISOString()
  };

  me.guest = true;
  me.tier ||= "FREE";
  me.coins = Number(me.coins ?? 1000);

  servers = saved.servers || [];
  if (!servers.length) {
    const first = {
      id: uid(),
      name: "Мой первый сервер",
      ownerId: me.id,
      channels: [
        { id: uid(), name: "общий", type: "TEXT", messages: [] },
        { id: uid(), name: "знакомство", type: "TEXT", messages: [] },
        { id: uid(), name: "Голосовой канал", type: "VOICE", messages: [] }
      ]
    };
    servers.push(first);
  }

  currentServer = servers.find(s => s.id === saved.currentServerId) || servers[0];
  currentChannel =
    currentServer.channels.find(c => c.id === saved.currentChannelId) ||
    currentServer.channels.find(c => c.type === "TEXT") ||
    currentServer.channels[0];

  localMode = true;
  saveLocal();
  showApp();
  renderAll();
  setConnection("Локальный режим · Гость");
}

function setConnection(text) {
  const el = $("connectionState");
  if (el) el.textContent = text;
}

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Ошибка сервера");
  return data;
}

function showApp() {
  $("auth")?.classList.add("hidden");
  $("app")?.classList.remove("hidden");
}

function showAuth() {
  $("auth")?.classList.remove("hidden");
  $("app")?.classList.add("hidden");
}

function renderMe() {
  if (!me) return;
  const name = me.displayName || me.username || "Гость";
  if ($("myName")) $("myName").textContent = name;
  if ($("memberName")) $("memberName").textContent = name;
  if ($("avatar")) $("avatar").textContent = name[0].toUpperCase();
  if ($("memberAvatar")) $("memberAvatar").textContent = name[0].toUpperCase();
  if ($("myTier")) $("myTier").textContent = me.tier || "FREE";
  if ($("coins")) $("coins").textContent = me.coins ?? 0;
}

function renderAll() {
  renderMe();
  renderServers();
  if (currentServer) renderChannels();
  if (currentChannel) renderMessages();
  saveLocal();
}

function renderServers() {
  const list = $("guildList");
  if (!list) return;

  list.innerHTML = servers.map(s => `
    <button class="guild-button ${s.id === currentServer?.id ? "selected" : ""}"
      data-server="${esc(s.id)}" title="${esc(s.name)}">
      ${esc(s.name.slice(0, 2).toUpperCase())}
    </button>
  `).join("");

  list.querySelectorAll("[data-server]").forEach(button => {
    button.onclick = () => selectServer(button.dataset.server);
  });
}

function renderChannels() {
  if (!currentServer) return;

  const textList = $("textChannels");
  const voiceList = $("voiceChannels");
  if (!textList || !voiceList) return;

  textList.innerHTML = "";
  voiceList.innerHTML = "";

  for (const channel of currentServer.channels || []) {
    const button = document.createElement("button");
    button.className = "channel";
    button.textContent = (channel.type === "VOICE" ? "◖ " : "# ") + channel.name;
    if (channel.id === currentChannel?.id) button.classList.add("active");

    button.onclick = () => selectChannel(channel.id);

    (channel.type === "VOICE" ? voiceList : textList).appendChild(button);
  }

  if ($("channelTitle")) {
    $("channelTitle").textContent = currentChannel?.name || currentServer.name;
  }
}

function renderMessages() {
  const box = $("messages");
  if (!box || !currentChannel) return;

  if (currentChannel.type === "VOICE") {
    $("chatView")?.classList.add("hidden");
    $("callView")?.classList.remove("hidden");
    if ($("callTitle")) $("callTitle").textContent = currentChannel.name;
    return;
  }

  $("chatView")?.classList.remove("hidden");
  $("callView")?.classList.add("hidden");

  if ($("channelTitle")) $("channelTitle").textContent = currentChannel.name;
  if ($("messageInput")) {
    $("messageInput").placeholder = `Написать сообщение в #${currentChannel.name}...`;
  }

  box.innerHTML = "";

  const messages = currentChannel.messages || [];
  if (!messages.length) {
    box.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">X</div>
        <h2>Добро пожаловать в #${esc(currentChannel.name)}</h2>
        <p>Начните общение первым!</p>
      </div>`;
    return;
  }

  messages.forEach(addMessageElement);
  box.scrollTop = box.scrollHeight;
}

function addMessageElement(message) {
  const box = $("messages");
  if (!box) return;

  box.querySelector(".welcome")?.remove();

  const name = message.user?.username ||
    message.username || "Гость";

  const item = document.createElement("div");
  item.className = "message";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = name[0].toUpperCase();

  const body = document.createElement("div");
  body.className = "message-body";

  const head = document.createElement("div");
  head.className = "message-head";

  const author = document.createElement("b");
  author.textContent = name;

  const time = document.createElement("small");
  time.textContent = new Date(message.createdAt || Date.now()).toLocaleString();

  const content = document.createElement("div");
  content.className = "message-text";
  content.textContent = message.content || "";

  head.append(author, time);
  body.append(head, content);
  item.append(avatar, body);
  box.appendChild(item);
  box.scrollTop = box.scrollHeight;
}

function selectServer(id) {
  currentServer = servers.find(s => s.id === id);
  if (!currentServer) return;

  currentChannel =
    currentServer.channels.find(c => c.type === "TEXT") ||
    currentServer.channels[0] || null;

  renderAll();
  if (currentChannel && !localMode) loadOnlineChannel();
}

function selectChannel(id) {
  currentChannel = currentServer?.channels.find(c => c.id === id);
  if (!currentChannel) return;

  renderChannels();
  renderMessages();

  if (!localMode && currentChannel.type === "TEXT") {
    loadOnlineChannel();
  }

  saveLocal();
}

async function loadOnlineChannel() {
  if (!currentChannel || !token || localMode) return;

  try {
    if (socket) socket.emit("channel:join", currentChannel.id);
    const messages = await api(`/api/channels/${currentChannel.id}/messages`);
    currentChannel.messages = messages;
    renderMessages();
  } catch (error) {
    notify("Не удалось загрузить сообщения: " + error.message);
  }
}

/* -------------------- СООБЩЕНИЯ -------------------- */

async function sendMessage(content) {
  content = content.trim();
  if (!content || !currentChannel) return;

  if (currentChannel.type !== "TEXT") {
    notify("Выберите текстовый канал");
    return;
  }

  if (localMode) {
    currentChannel.messages ||= [];
    currentChannel.messages.push({
      id: uid(),
      username: me.displayName || me.username,
      content,
      createdAt: new Date().toISOString()
    });
    saveLocal();
    renderMessages();
    return;
  }

  if (!socket?.connected) {
    notify("Нет соединения с сервером");
    return;
  }

  socket.emit("message:send", {
    channelId: currentChannel.id,
    content
  });
}

$("messageForm")?.addEventListener("submit", event => {
  event.preventDefault();
  const input = $("messageInput");
  if (!input) return;
  const value = input.value;
  input.value = "";
  sendMessage(value);
});

/* -------------------- СОЗДАНИЕ СЕРВЕРОВ -------------------- */

async function createServer() {
  const name = prompt("Как назвать твой сервер?");
  if (!name?.trim()) return;

  if (!localMode) {
    try {
      const server = await api("/api/servers", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() })
      });
      servers.push(server);
      selectServer(server.id);
      return;
    } catch (error) {
      notify("Сервер не создан: " + error.message);
      return;
    }
  }

  const server = {
    id: uid(),
    name: name.trim(),
    ownerId: me.id,
    channels: [
      { id: uid(), name: "общий", type: "TEXT", messages: [] },
      { id: uid(), name: "голосовой", type: "VOICE", messages: [] }
    ]
  };

  servers.push(server);
  selectServer(server.id);
  notify("Сервер создан!");
}

async function createChannel(type) {
  if (!currentServer) {
    notify("Сначала создай сервер");
    return;
  }

  const name = prompt("Название канала:");
  if (!name?.trim()) return;

  if (!localMode) {
    try {
      const channel = await api(
        `/api/servers/${currentServer.id}/channels`,
        {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), type })
        }
      );
      currentServer.channels.push(channel);
      renderAll();
      return;
    } catch (error) {
      notify("Не удалось создать канал: " + error.message);
      return;
    }
  }

  currentServer.channels.push({
    id: uid(),
    name: name.trim(),
    type,
    messages: []
  });

  currentChannel = currentServer.channels.at(-1);
  renderAll();
  notify("Канал создан!");
}

$("addServer")?.addEventListener("click", createServer);
$("addText")?.addEventListener("click", () => createChannel("TEXT"));
$("addVoice")?.addEventListener("click", () => createChannel("VOICE"));

/* -------------------- ПРИГЛАШЕНИЯ -------------------- */

function inviteToServer() {
  if (!currentServer) return notify("Сначала выбери сервер");

  const invite = location.origin + location.pathname +
    "?invite=" + encodeURIComponent(currentServer.id);

  showModal("Приглашение на сервер", `
    <p>Ссылка-приглашение:</p>
    <input id="dxInviteLink" readonly value="${esc(invite)}"
      style="width:100%;padding:12px;border-radius:8px">
    <button class="primary" id="dxCopyInvite">Копировать ссылку</button>
    <p class="muted">В локальном режиме ссылка работает только в этом браузере. Для приглашений других пользователей нужен сервер Discord X.</p>
  `);

  $("dxCopyInvite").onclick = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      notify("Ссылка скопирована");
    } catch {
      $("dxInviteLink").select();
      document.execCommand("copy");
      notify("Ссылка скопирована");
    }
  };
}

/* -------------------- PREMIUM И X-COINS -------------------- */

function premiumPage() {
  showModal("Магазин Discord X", `
    <div class="dx-wallet">
      <div>ТВОЙ БАЛАНС</div>
      <h2>🪙 ${me.coins} X-Coins</h2>
      <button class="control" id="dxDailyBonus">Получить ежедневный бонус</button>
    </div>

    <div class="plan">
      <h3>⭐ Premium</h3>
      <h2>500 XC / месяц</h2>
      <p>Украшения профиля, дополнительные настройки оформления.</p>
      <button class="primary" id="dxBuyPremium">Купить Premium</button>
    </div>

    <div class="plan">
      <h3>💎 Premium PRO</h3>
      <h2>1 000 XC / месяц</h2>
      <p>Все возможности Premium и расширенные настройки профиля.</p>
      <button class="primary" id="dxBuyPro">Купить Premium PRO</button>
    </div>

    <p class="muted">
      В гостевом режиме баланс и покупки сохраняются только в этом браузере.
      Реальные платежи здесь не подключены.
    </p>
  `);

  $("dxDailyBonus").onclick = dailyBonus;
  $("dxBuyPremium").onclick = () => buyPlan("PREMIUM");
  $("dxBuyPro").onclick = () => buyPlan("PRO");
}

function dailyBonus() {
  const last = localStorage.getItem("dx_last_bonus");
  const today = new Date().toDateString();

  if (last === today) {
    return notify("Сегодня бонус уже получен");
  }

  me.coins += 100;
  localStorage.setItem("dx_last_bonus", today);
  saveLocal();
  renderMe();
  premiumPage();
  notify("+100 X-Coins!");
}

async function buyPlan(tier) {
  const amount = tier === "PRO" ? 1000 : 500;
  const title = tier === "PRO" ? "Premium PRO" : "Premium";

  if (me.coins < amount) {
    return notify("Недостаточно X-Coins");
  }

  if (!confirm(`Купить ${title} за ${amount} X-Coins?`)) return;

  if (!localMode) {
    try {
      const result = await api("/api/billing/demo-purchase", {
        method: "POST",
        body: JSON.stringify({ tier, accepted: true })
      });
      me.coins = result.coins;
      me.tier = result.tier;
      me.lastPurchaseId = result.purchaseId;
      me.refundDeadline = result.refundDeadline;
      saveLocal();
      renderMe();
      premiumPage();
      notify("Подписка активирована");
      return;
    } catch (error) {
      notify("Покупка не прошла: " + error.message);
      return;
    }
  }

  me.coins -= amount;
  me.tier = tier;
  me.lastPurchaseId = uid();
  me.refundDeadline = Date.now() + 24 * 60 * 60 * 1000;
  saveLocal();
  renderMe();
  premiumPage();
  notify(title + " активирован!");
}

function walletPage() {
  showModal("Кошелёк X-Coins", `
    <div class="dx-wallet">
      <h2>🪙 ${me.coins} X-Coins</h2>
      <p>Твои виртуальные монеты Discord X.</p>
    </div>
    <button class="primary" id="dxWalletBonus">Получить ежедневный бонус +100</button>
    <p class="muted">
      Покупка X-Coins за реальные деньги пока не подключена.
    </p>
  `);
  $("dxWalletBonus").onclick = dailyBonus;
}

/* -------------------- НАСТРОЙКИ И ПРОФИЛЬ -------------------- */

function settingsPage() {
  showModal("Настройки профиля", `
    <label>Отображаемое имя</label>
    <input id="dxDisplayName" maxlength="32"
      value="${esc(me.displayName || me.username)}">

    <label>Имя пользователя</label>
    <input id="dxUsername" maxlength="32"
      value="${esc(me.username)}">

    <label>Электронная почта</label>
    <input id="dxEmail" type="email"
      placeholder="Добавить почту"
      value="${esc(me.email || "")}">

    <button class="primary" id="dxSaveProfile">Сохранить изменения</button>

    <hr>
    <p>Статус: ${localMode ? "Гость · локальный профиль" : "Аккаунт Discord X"}</p>
    <p>Подписка: <b>${esc(me.tier)}</b></p>
    <button class="control" id="dxInviteButton">Пригласить на сервер</button>
  `);

  $("dxSaveProfile").onclick = async () => {
    const displayName = $("dxDisplayName").value.trim();
    const username = $("dxUsername").value.trim();
    const email = $("dxEmail").value.trim();

    if (!displayName || !username) {
      return notify("Заполни имя и имя пользователя");
    }

    if (!localMode) {
      try {
        await api("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ username, displayName, email })
        });
      } catch (error) {
        notify("Не удалось сохранить: " + error.message);
        return;
      }
    }

    me.displayName = displayName;
    me.username = username;
    me.email = email;
    saveLocal();
    renderMe();
    showModal("Готово", "<p>Профиль обновлён.</p>");
  };

  $("dxInviteButton").onclick = inviteToServer;
}

/* -------------------- ОКНА -------------------- */

function ensureModal() {
  if ($("dxModal")) return;

  const modal = document.createElement("div");
  modal.id = "dxModal";
  modal.style.cssText =
    "position:fixed;inset:0;background:#000a;z-index:99990;" +
    "display:none;align-items:center;justify-content:center;padding:20px";

  modal.innerHTML = `
    <div style="background:#222631;color:white;width:min(520px,100%);
      max-height:85vh;overflow:auto;padding:25px;border-radius:16px;
      font:14px Arial;box-shadow:0 20px 80px #0009">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 id="dxModalTitle"></h2>
        <button id="dxModalClose" style="font-size:22px">×</button>
      </div>
      <div id="dxModalBody"></div>
    </div>`;

  document.body.appendChild(modal);
  $("dxModalClose").onclick = () => modal.style.display = "none";
  modal.onclick = event => {
    if (event.target === modal) modal.style.display = "none";
  };
}

function showModal(title, html) {
  ensureModal();
  $("dxModalTitle").textContent = title;
  $("dxModalBody").innerHTML = html;
  $("dxModal").style.display = "flex";
}

function closeModal() {
  if ($("dxModal")) $("dxModal").style.display = "none";
}

/* -------------------- ПОИСК -------------------- */

function searchMessages() {
  const query = prompt("Что найти на сервере?");
  if (!query?.trim()) return;

  const found = [];
  for (const server of servers) {
    for (const channel of server.channels || []) {
      for (const message of channel.messages || []) {
        if ((message.content || "").toLowerCase().includes(query.toLowerCase())) {
          found.push({
            server: server.name,
            channel: channel.name,
            message: message.content,
            user: message.username || message.user?.username || "Гость"
          });
        }
      }
    }
  }

  showModal("Результаты поиска", found.length
    ? found.map(x => `
        <div class="plan">
          <b>${esc(x.server)} / #${esc(x.channel)}</b>
          <p>${esc(x.user)}: ${esc(x.message)}</p>
        </div>`).join("")
    : "<p>Ничего не найдено.</p>");
}

/* -------------------- SOCKET.IO -------------------- */

function connectSocket() {
  if (typeof io !== "function" || !token) return;

  if (socket) socket.disconnect();
  socket = io(API, { auth: { token } });

  socket.on("connect", () => {
    online = true;
    localMode = false;
    setConnection("● На связи");
    notify("Подключено к Discord X");
  });

  socket.on("disconnect", () => {
    online = false;
    setConnection("● Нет соединения");
  });

  socket.on("connect_error", () => {
    online = false;
    setConnection("● Ошибка подключения");
  });

  socket.on("message:new", message => {
    if (message.channelId !== currentChannel?.id) return;
    currentChannel.messages ||= [];
    if (!currentChannel.messages.some(m => m.id === message.id)) {
      currentChannel.messages.push(message);
    }
    addMessageElement(message);
    saveLocal();
  });

  socket.on("call:peer-left", data => {
    const peer = peers.get(data.socketId);
    peer?.close();
    peers.delete(data.socketId);
  });

  socket.on("call:offer", async data => {
    const pc = await makePeer(data.from);
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("call:answer", {
      room: callRoom, to: data.from, answer
    });
  });

  socket.on("call:answer", async data => {
    const pc = peers.get(data.from);
    if (pc) await pc.setRemoteDescription(data.answer);
  });

  socket.on("call:ice", async data => {
    const pc = peers.get(data.from);
    if (pc && data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (error) {
        console.warn(error);
      }
    }
  });
}

/* -------------------- ГОЛОСОВЫЕ КАНАЛЫ -------------------- */

function iceConfig() {
  return {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  };
}

async function makePeer(peerId) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(iceConfig());
  peers.set(peerId, pc);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = event => {
    if (event.candidate && socket) {
      socket.emit("call:ice", {
        room: callRoom,
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = event => {
    let video = $("peer-" + peerId);
    if (!video) {
      video = document.createElement("video");
      video.id = "peer-" + peerId;
      video.autoplay = true;
      video.playsInline = true;
      $("videos")?.appendChild(video);
    }
    video.srcObject = event.streams[0];
  };

  return pc;
}

async function joinCall() {
  if (localMode) {
    return notify("Голосовой онлайн-режим доступен после подключения к серверу.");
  }

  if (!currentChannel || currentChannel.type !== "VOICE") {
    return notify("Сначала выбери голосовой канал");
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    callRoom = currentChannel.id;
    socket.emit("call:join", callRoom);

    if ($("callStatus")) $("callStatus").textContent = "Вы подключены";
    if ($("joinCall")) $("joinCall").disabled = true;
    if ($("leaveCall")) $("leaveCall").disabled = false;
    if ($("toggleMute")) $("toggleMute").disabled = false;
    if ($("toggleVideo")) $("toggleVideo").disabled = false;
  } catch (error) {
    notify("Не удалось включить микрофон: " + error.message);
  }
}

async function leaveCall() {
  if (callRoom && socket) socket.emit("call:leave", callRoom);

  peers.forEach(pc => pc.close());
  peers.clear();

  localStream?.getTracks().forEach(track => track.stop());
  localStream = null;
  callRoom = null;
  videoOn = false;
  muted = false;

  if ($("videos")) $("videos").innerHTML = "";
  if ($("remotePeers")) $("remotePeers").innerHTML = "";

  if ($("joinCall")) $("joinCall").disabled = false;
  if ($("leaveCall")) $("leaveCall").disabled = true;
  if ($("toggleMute")) $("toggleMute").disabled = true;
  if ($("toggleVideo")) $("toggleVideo").disabled = true;
  if ($("callStatus")) $("callStatus").textContent = "Вы отключились";
}

$("joinCall")?.addEventListener("click", joinCall);
$("leaveCall")?.addEventListener("click", leaveCall);

$("toggleMute")?.addEventListener("click", () => {
  muted = !muted;
  localStream?.getAudioTracks().forEach(track => track.enabled = !muted);
  $("toggleMute").textContent = muted
    ? "Включить микрофон" : "Выключить микрофон";
});

$("toggleVideo")?.addEventListener("click", async () => {
  if (localMode) return notify("Видеозвонки требуют подключения к серверу.");

  try {
    if (!videoOn) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      localStream.addTrack(track);
      for (const pc of peers.values()) pc.addTrack(track, localStream);

      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = localStream;
      $("videos")?.appendChild(video);

      videoOn = true;
      $("toggleVideo").textContent = "Выключить камеру";
    } else {
      localStream?.getVideoTracks().forEach(track => {
        track.stop();
        localStream.removeTrack(track);
      });
      $("videos").innerHTML = "";
      videoOn = false;
      $("toggleVideo").textContent = "Включить камеру";
    }
  } catch (error) {
    notify("Камера недоступна: " + error.message);
  }
});

/* -------------------- ПОДКЛЮЧЕНИЕ АККАУНТА -------------------- */

function showAccountLink() {
  showModal("Подключение аккаунта", `
    <p>Гостевой профиль работает без регистрации.</p>
    <p>Чтобы привязать почту, сначала запусти сервер Discord X и используй его регистрацию.</p>
    <button class="primary" id="dxGoRegister">Открыть регистрацию</button>
  `);

  $("dxGoRegister").onclick = () => {
    closeModal();
    showAuth();
    document.querySelector('[data-tab="register"]')?.click();
  };
}

/* -------------------- КНОПКИ И НАВИГАЦИЯ -------------------- */

$("openPremium")?.addEventListener("click", premiumPage);
$("premiumTop")?.addEventListener("click", premiumPage);
$("promoPremium")?.addEventListener("click", premiumPage);
$("refundTop")?.addEventListener("click", () => {
  if (!me.lastPurchaseId) {
    return notify("Нет покупки, доступной для возврата.");
  }
  showModal("Возврат подписки", `
    <p>Для возврата демонстрационной покупки нажми кнопку ниже.</p>
    <button class="danger" id="dxRefund">Запросить возврат</button>
  `);
  $("dxRefund").onclick = async () => {
    if (localMode) {
      if (Date.now() > me.refundDeadline) {
        return notify("Срок возврата истёк");
      }
      me.coins += me.tier === "PRO" ? 1000 : 500;
      me.tier = "FREE";
      me.lastPurchaseId = null;
      saveLocal();
      renderMe();
      showModal("Возврат выполнен", "<p>X-Coins возвращены.</p>");
      return;
    }
    try {
      const result = await api("/api/billing/refund", {
        method: "POST",
        body: JSON.stringify({ purchaseId: me.lastPurchaseId })
      });
      me.coins = result.coins;
      me.tier = result.tier;
      me.lastPurchaseId = null;
      renderMe();
      showModal("Возврат выполнен", `<p>${esc(result.message)}</p>`);
    } catch (error) {
      notify(error.message);
    }
  };
});

$("logout")?.addEventListener("click", async () => {
  await leaveCall();
  socket?.disconnect();
  token = "";
  localStorage.removeItem("dx_token");
  makeGuest();
  notify("Ты снова вошёл как Гость");
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});

/* Дополнительные кнопки интерфейса */
function addExtraControls() {
  const targets = [
    ["myName", "Настройки", settingsPage],
    ["memberName", "Профиль", settingsPage],
    ["coins", "Кошелёк", walletPage]
  ];

  for (const [id, title, action] of targets) {
    const el = $(id);
    if (el && !el.dataset.dxBound) {
      el.dataset.dxBound = "1";
      el.title = title;
      el.style.cursor = "pointer";
      el.addEventListener("click", action);
    }
  }

  const top = $("channelTitle");
  if (top && ! $("dxInvite")) {
    const button = document.createElement("button");
    button.id = "dxInvite";
    button.textContent = "Пригласить";
    button.className = "control";
    button.style.marginLeft = "12px";
    button.onclick = inviteToServer;
    top.parentElement?.appendChild(button);
  }
}

/* -------------------- ЗАГРУЗКА ОНЛАЙН-АККАУНТА -------------------- */

async function loadOnline() {
  try {
    const user = await api("/api/me");
    me = { ...user, guest: false };
    localMode = false;
    showApp();
    connectSocket();

    servers = await api("/api/servers");
    currentServer = servers[0] || null;
    currentChannel = currentServer?.channels?.find(c => c.type === "TEXT") ||
      currentServer?.channels?.[0] || null;

    renderAll();
    if (currentChannel) await loadOnlineChannel();
    setConnection("● Подключено к Discord X");
  } catch (error) {
    token = "";
    localStorage.removeItem("dx_token");
    makeGuest();
  }
}

/* -------------------- ЗАПУСК -------------------- */

function startDiscordX() {
  addExtraControls();

  if (token) {
    loadOnline();
  } else {
    makeGuest();
  }

  const invite = new URLSearchParams(location.search).get("invite");
  if (invite) {
    notify("Получена ссылка-приглашение. Для вступления нужен онлайн-сервер.");
  }
}

startDiscordX();
