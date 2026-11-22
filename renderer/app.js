const API = "http://localhost:4000";
let token = localStorage.getItem("dx_token") || "";
let me = null, servers = [], currentServer = null, currentChannel = null, socket = null;
let localStream = null, peers = new Map(), callRoom = null, muted = false, videoOn = false;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, options={}) {
  const res = await fetch(API+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||"Request failed");
  return data;
}
function notice(msg){$("authNotice").textContent=msg||"";}
function showAuth(){ $("auth").classList.remove("hidden"); $("app").classList.add("hidden"); }
function showApp(){ $("auth").classList.add("hidden"); $("app").classList.remove("hidden"); }
document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  $("loginForm").classList.toggle("hidden",btn.dataset.tab!=="login");
  $("registerForm").classList.toggle("hidden",btn.dataset.tab!=="register");
  $("verifyForm").classList.add("hidden"); notice("");
});
$("registerForm").onsubmit=async e=>{
  e.preventDefault(); notice("Отправляем код...");
  try{const email=$("regEmail").value.trim(); await api("/api/auth/register",{method:"POST",body:JSON.stringify({email,username:$("regName").value.trim(),password:$("regPassword").value})});
    $("verifyEmail").value=email; $("registerForm").classList.add("hidden"); $("verifyForm").classList.remove("hidden"); notice("Код отправлен. Проверьте почту или консоль сервера в локальном режиме.");
  }catch(err){notice(err.message);}
};
$("verifyForm").onsubmit=async e=>{
  e.preventDefault(); notice("Проверяем код...");
  try{const data=await api("/api/auth/verify",{method:"POST",body:JSON.stringify({email:$("verifyEmail").value.trim(),code:$("verifyCode").value.trim()})}); acceptLogin(data);}
  catch(err){notice(err.message);}
};
$("loginForm").onsubmit=async e=>{
  e.preventDefault(); notice("Входим...");
  try{const data=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("loginEmail").value.trim(),password:$("loginPassword").value})});acceptLogin(data);}
  catch(err){notice(err.message);}
};
function acceptLogin(data){token=data.token;localStorage.setItem("dx_token",token);me=data.user;boot();}
async function boot(){
  try{me=await api("/api/me");showApp();renderMe();connectSocket();await loadServers();}
  catch(e){token="";localStorage.removeItem("dx_token");showAuth();notice(e.message);}
}
function renderMe(){
  $("myName").textContent=me.username;$("memberName").textContent=me.username;
  $("avatar").textContent=me.username[0].toUpperCase();$("memberAvatar").textContent=me.username[0].toUpperCase();
  $("myTier").textContent=me.tier;$("coins").textContent=me.coins;
}
function connectSocket(){
  if(socket)socket.disconnect();
  socket=io(API,{auth:{token}});
  socket.on("connect",()=>$("connectionState").textContent="● На связи");
  socket.on("disconnect",()=>$("connectionState").textContent="● Нет соединения");
  socket.on("connect_error",()=>$("connectionState").textContent="● Ошибка подключения");
  socket.on("message:new",msg=>{if(msg.channelId===currentChannel?.id)appendMessage(msg);});
  socket.on("call:peer-joined",async peer=>{
    addPeerLabel(peer);
    // The already-connected participant creates the offer for the newcomer.
    try {
      const pc=await makePeer(peer.socketId);
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call:offer",{room:callRoom,to:peer.socketId,offer});
    } catch(e) { console.warn("WebRTC offer failed",e); }
  });
  socket.on("call:peer-left",data=>{const pc=peers.get(data.socketId);if(pc)pc.close();peers.delete(data.socketId);});
  socket.on("call:offer",async data=>{const pc=await makePeer(data.from);await pc.setRemoteDescription(data.offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("call:answer",{room:callRoom,to:data.from,answer});});
  socket.on("call:answer",async data=>{const pc=peers.get(data.from);if(pc)await pc.setRemoteDescription(data.answer);});
  socket.on("call:ice",async data=>{const pc=peers.get(data.from);if(pc&&data.candidate)try{await pc.addIceCandidate(data.candidate);}catch(e){console.warn(e);}});
}
async function loadServers(){
  servers=await api("/api/servers");renderServers();
  if(servers.length)selectServer(servers[0].id);else renderEmpty();
}
function renderEmpty(){
  $("textChannels").innerHTML='<div class="channel">Создайте сервер +</div>';$("voiceChannels").innerHTML="";
  $("channelTitle").textContent="Discord X";$("messages").innerHTML='<div class="welcome"><div class="welcome-icon">X</div><h2>Создайте свой сервер</h2><p>Нажмите + слева, чтобы начать.</p></div>';
}
function renderServers(){
  $("guildList").innerHTML=servers.map(s=>`<button class="guild-button ${s.id===currentServer?.id?'selected':''}" data-id="${s.id}" title="${esc(s.name)}">${esc(s.name.slice(0,2).toUpperCase())}</button>`).join("");
  document.querySelectorAll(".guild-button").forEach(b=>b.onclick=()=>selectServer(b.dataset.id));
}
async function selectServer(id){
  currentServer=servers.find(s=>s.id===id);if(!currentServer)return;
  renderServers();
  $("textChannels").innerHTML="";$("voiceChannels").innerHTML="";
  currentServer.channels.forEach(c=>{
    const el=document.createElement("div");el.className="channel";el.innerHTML=`<span class="symbol">${c.type==="VOICE"?"◖":"#"}</span>${esc(c.name)}`;
    el.onclick=()=>selectChannel(c);(c.type==="VOICE"?$("voiceChannels"):$("textChannels")).appendChild(el);
  });
  const first=currentServer.channels.find(c=>c.type==="TEXT")||currentServer.channels[0];if(first)selectChannel(first);
}
async function selectChannel(channel){
  currentChannel=channel;
  document.querySelectorAll(".channel").forEach(x=>x.classList.remove("active"));
  $("channelTitle").textContent=channel.name;
  const isVoice=channel.type==="VOICE";
  $("chatView").classList.toggle("hidden",isVoice);$("callView").classList.toggle("hidden",!isVoice);
  if(isVoice){$("callTitle").textContent=channel.name;$("callStatus").textContent="Готовы подключиться";return;}
  socket.emit("channel:join",channel.id);
  const messages=await api(`/api/channels/${channel.id}/messages`);
  $("messages").innerHTML="";messages.forEach(appendMessage);
  $("messageInput").placeholder=`Написать сообщение в #${channel.name}...`;
}
function appendMessage(m){
  const empty=$("messages").querySelector(".welcome");if(empty)empty.remove();
  const div=document.createElement("div");div.className="message";
  const name=m.user?.username||"Пользователь";
  div.innerHTML=`<div class="avatar">${esc(name[0].toUpperCase())}</div><div class="message-body"><div class="message-head"><b>${esc(name)}</b><small>${new Date(m.createdAt).toLocaleString()}</small></div><div class="message-text">${esc(m.content)}</div></div>`;
  $("messages").appendChild(div);$("messages").scrollTop=$("messages").scrollHeight;
}
$("messageForm").onsubmit=e=>{e.preventDefault();const content=$("messageInput").value.trim();if(!content||!currentChannel||currentChannel.type!=="TEXT")return;socket.emit("message:send",{channelId:currentChannel.id,content});$("messageInput").value="";};
async function createServer(){
  const name=prompt("Название нового сервера:");if(!name)return;
  try{const s=await api("/api/servers",{method:"POST",body:JSON.stringify({name})});servers.push(s);await selectServer(s.id);}
  catch(e){alert(e.message);}
}
$("addServer").onclick=createServer;
async function createChannel(type){
  if(!currentServer)return alert("Сначала создайте сервер.");
  const name=prompt("Название канала:");if(!name)return;
  try{const c=await api(`/api/servers/${currentServer.id}/channels`,{method:"POST",body:JSON.stringify({name,type})});currentServer.channels.push(c);await selectServer(currentServer.id);}
  catch(e){alert(e.message);}
}
$("addText").onclick=()=>createChannel("TEXT");$("addVoice").onclick=()=>createChannel("VOICE");
$("logout").onclick=async()=>{await leaveCall();if(socket)socket.disconnect();token="";localStorage.removeItem("dx_token");me=null;showAuth();};
function openModal(html){$("modalContent").innerHTML=html;$("modal").classList.remove("hidden");}
$("closeModal").onclick=()=>$("modal").classList.add("hidden");
$("modal").onclick=e=>{if(e.target===$("modal"))$("modal").classList.add("hidden");};
function premium(){
  openModal(`<h2>Магазин Discord X</h2>
    <p class="muted">Выберите подписку. Оплата в этой версии списывает только демонстрационные X-Coins — реальные деньги не принимаются.</p>
    <div class="plan"><b>Premium — 500 XC / месяц</b><p>Анимированные аватары и оформление профиля.</p><button data-tier="PREMIUM">Продолжить</button></div>
    <div class="plan"><b>Premium PRO — 1 000 XC / месяц</b><p>Всё из Premium и дополнительные настройки.</p><button data-tier="PRO">Продолжить</button></div>
    <p>Баланс: <b>${me.coins} XC</b></p>
    <div class="muted" style="font-size:11px">Перед подтверждением покупки откроются условия, политика конфиденциальности и правила возврата.</div>`);
  $("modalContent").querySelectorAll("[data-tier]").forEach(b=>b.onclick=()=>confirmPurchase(b.dataset.tier));
}
function confirmPurchase(tier){
  const amount=tier==="PRO"?1000:500;
  const plan=tier==="PRO"?"Premium PRO":"Premium";
  openModal(`<h2>Подтверждение покупки</h2>
    <p>Подписка: <b>${plan}</b></p><p>Стоимость: <b>${amount} X-Coins</b></p>
    <p class="muted">Баланс после покупки: ${me.coins-amount} XC</p>
    <div class="policy-box">
      <label class="policy-check"><input id="acceptPrivacy" type="checkbox"> Я ознакомился(лась) и соглашаюсь с <a href="#" id="privacyLink">Политикой конфиденциальности и безопасности</a>.</label>
      <label class="policy-check"><input id="acceptRefund" type="checkbox"> Я понимаю, что могу запросить возврат списанных X-Coins в течение 24 часов после покупки согласно правилам возврата.</label>
    </div>
    <p class="muted" style="font-size:11px">Это виртуальная покупка внутри демонстрационной версии. Реальные платежи не списываются.</p>
    <button id="confirmPay" class="primary" style="width:100%" disabled>Подтвердить и оплатить</button>
    <button id="backPlans" class="control" style="width:100%;margin-top:8px">Назад</button>`);
  const check=()=>{$("confirmPay").disabled=!($("acceptPrivacy").checked&&$("acceptRefund").checked);};
  $("acceptPrivacy").onchange=check;$("acceptRefund").onchange=check;
  $("privacyLink").onclick=e=>{e.preventDefault();openModal(`<h2>Политика конфиденциальности и безопасности</h2><p>Discord X в этой сборке хранит адрес электронной почты, имя пользователя, хеш пароля, сообщения, членство в серверах и данные покупок для работы функций приложения.</p><p>Пароли хранятся в виде хешей. Передача данных между клиентом и сервером в локальной конфигурации не заменяет HTTPS. Для публичного запуска необходимо настроить HTTPS, безопасное хранение секретов, резервные копии, ограничение запросов, мониторинг и процедуру удаления аккаунта.</p><p>Не отправляйте в чат пароли, платёжные реквизиты или другие секреты. X-Coins и подписки в этой версии демонстрационные.</p><button class="primary" id="backToConsent">Вернуться к согласию</button>`);$("backToConsent").onclick=()=>confirmPurchase(tier);};
  $("backPlans").onclick=premium;
  $("confirmPay").onclick=async()=>{
    try{
      const d=await api("/api/billing/demo-purchase",{method:"POST",body:JSON.stringify({tier,accepted:true})});
      me.coins=d.coins;me.tier=d.tier;me.lastPurchaseId=d.purchaseId;me.refundDeadline=d.refundDeadline;renderMe();
      openModal(`<h2>Покупка подтверждена</h2><p>${esc(d.message)}</p><p>Подписка: <b>${plan}</b></p><p>Возврат X-Coins можно запросить до:</p><b>${new Date(d.refundDeadline).toLocaleString()}</b><p class="muted">Сохраните это окно или откройте раздел подписки для возврата.</p><button class="primary" id="donePurchase">Готово</button>`);
      $("donePurchase").onclick=()=>{$("modal").classList.add("hidden");};
    }catch(e){alert(e.message);}
  };
}
function refundPurchase(){
  if(!me.lastPurchaseId)return alert("В этой сессии нет покупки, для которой можно запросить возврат. В истории аккаунта покупка будет доступна после добавления отдельного экрана истории.");
  openModal(`<h2>Запрос возврата</h2><p>Возврат демонстрационной покупки вернёт X-Coins в кошелёк и отменит текущий уровень подписки.</p><p>Запрос доступен в течение 24 часов после покупки.</p><button id="requestRefund" class="danger" style="width:100%">Подтвердить возврат</button>`);
  $("requestRefund").onclick=async()=>{try{const d=await api("/api/billing/refund",{method:"POST",body:JSON.stringify({purchaseId:me.lastPurchaseId})});me.coins=d.coins;me.tier=d.tier;me.lastPurchaseId=null;renderMe();openModal(`<h2>Возврат выполнен</h2><p>${esc(d.message)}</p><p>Новый баланс: ${d.coins} XC</p><button id="closeRefund" class="primary">Закрыть</button>`);$("closeRefund").onclick=()=>$("modal").classList.add("hidden");}catch(e){alert(e.message);}};
}
$("openPremium").onclick=premium;$("premiumTop").onclick=premium;$("promoPremium").onclick=premium;$("refundTop").onclick=refundPurchase;


function iceConfig(){
  const servers=[{urls:"stun:stun.l.google.com:19302"}];
  // Add your TURN server here for dependable calls across restrictive networks.
  return {iceServers:servers};
}
async function makePeer(peerId){
  if(peers.has(peerId))return peers.get(peerId);
  const pc=new RTCPeerConnection(iceConfig());peers.set(peerId,pc);
  if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("call:ice",{room:callRoom,to:peerId,candidate:e.candidate});};
  pc.ontrack=e=>{
    let video=document.getElementById("peer-"+peerId);
    if(!video){video=document.createElement("video");video.id="peer-"+peerId;video.autoplay=true;video.playsInline=true;$("videos").appendChild(video);}
    video.srcObject=e.streams[0];
  };
  return pc;
}
function addPeerLabel(peer){const d=document.createElement("div");d.textContent=peer.username+" подключается";$("remotePeers").appendChild(d);}
$("joinCall").onclick=async()=>{
  if(!currentChannel||currentChannel.type!=="VOICE")return;
  try{
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    callRoom=currentChannel.id;socket.emit("call:join",callRoom);
    $("callStatus").textContent="Вы подключены · микрофон включён";$("joinCall").disabled=true;$("leaveCall").disabled=false;$("toggleMute").disabled=false;$("toggleVideo").disabled=false;
  }catch(e){$("callStatus").textContent="Не удалось получить доступ к микрофону: "+e.message;}
};
$("toggleMute").onclick=()=>{muted=!muted;localStream?.getAudioTracks().forEach(t=>t.enabled=!muted);$("toggleMute").textContent=muted?"Включить микрофон":"Выключить микрофон";};
$("toggleVideo").onclick=async()=>{
  try{
    if(!videoOn){const stream=await navigator.mediaDevices.getUserMedia({video:true});const track=stream.getVideoTracks()[0];localStream.addTrack(track);
      for(const pc of peers.values())pc.addTrack(track,localStream);
      const v=document.createElement("video");v.autoplay=true;v.muted=true;v.playsInline=true;v.srcObject=localStream;$("videos").appendChild(v);videoOn=true;$("toggleVideo").textContent="Выключить камеру";
    }else{localStream.getVideoTracks().forEach(t=>{t.stop();localStream.removeTrack(t);});$("videos").innerHTML="";videoOn=false;$("toggleVideo").textContent="Включить камеру";}
  }catch(e){$("callStatus").textContent="Камера недоступна: "+e.message;}
};
$("leaveCall").onclick=leaveCall;
async function leaveCall(){
  if(callRoom&&socket)socket.emit("call:leave",callRoom);
  peers.forEach(pc=>pc.close());peers.clear();if(localStream)localStream.getTracks().forEach(t=>t.stop());
  localStream=null;callRoom=null;videoOn=false;muted=false;$("videos").innerHTML="";$("remotePeers").innerHTML="";
  $("joinCall").disabled=false;$("leaveCall").disabled=true;$("toggleMute").disabled=true;$("toggleVideo").disabled=true;
  $("callStatus").textContent="Вы отключились";
}
if(token)boot();else showAuth();
