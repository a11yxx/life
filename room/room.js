const AVATARS = [
  'aria.svg','atlas.svg','dylan.svg','ethan.svg','iris.svg','leo.svg','luna.svg','man.svg','mason.svg','mia.svg',
  'moonbyte.svg','noah.svg','nova.svg','pixel.svg','raven.svg','selena.svg','violet.svg','woman.svg','zen.svg','custom.svg'
];
const MODES = ['Standard','Brutal','Double Side','Party','Fast'];
const CONFIG = window.PLAY_UNO_CONFIG || {MAX_PLAYERS:10, DOWNLOAD_URL:''};
const $ = (id) => document.getElementById(id);
const t = (key, vars) => window.PlayUnoI18n?.t(key, vars) || key;
const modeLabel = (mode) => window.PlayUnoI18n?.modeLabel(mode) || mode;
const params = new URLSearchParams(location.search);
const code = String(params.get('room') || '').replace(/^#?UNO[\s-]*/i,'').trim().toUpperCase();
let identity = null;
let room = null;
let profileAvatar = AVATARS[0];
let voiceStream = null;
let voiceMuted = false;
const seenChatMessages = new Set();
const voicePeers = new Map();
const voiceAudio = new Map();

function normalizeMode(mode) {
  const map = {
    'Standart': 'Standard', 'Standard': 'Standard',
    'Acımasız': 'Brutal', 'Brutal': 'Brutal',
    'Çift Taraf': 'Double Side', 'Double Side': 'Double Side',
    'Parti': 'Party', 'Party': 'Party',
    'Hızlı': 'Fast', 'Fast': 'Fast'
  };
  return map[mode] || 'Standard';
}

function toast(message){const el=$('toast');if(!el)return;el.textContent=message;el.classList.remove('hidden');clearTimeout(window.__playUnoRoomToast);window.__playUnoRoomToast=setTimeout(()=>el.classList.add('hidden'),3200);}
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function avatarUrl(file){return `../assets/avatars/${encodeURIComponent(file || AVATARS[0])}`;}

function savedIdentity(){
  const key = `playuno_identity_${code}`;
  try {
    const fromSession = sessionStorage.getItem(key);
    if (fromSession) return JSON.parse(fromSession);
  } catch {}
  return null;
}

function saveIdentity(nextIdentity){
  const key = `playuno_identity_${code}`;
  identity = nextIdentity;
  try { sessionStorage.setItem(key, JSON.stringify(nextIdentity)); } catch {}
}

function clearIdentity(){
  const key = `playuno_identity_${code}`;
  try { sessionStorage.removeItem(key); } catch {}
  try { localStorage.removeItem(key); } catch {}
}

function buildSnapshotHeader(){
  if (!identity) return '';
  const me = room?.players?.find((p) => p.id === identity.playerId);
  const snap = {
    playerId: identity.playerId,
    token: identity.token,
    name: me?.name || identity.name || localStorage.getItem('playuno_name') || 'Player',
    avatar: me?.avatar || identity.avatar || AVATARS[0],
    isHost: me ? Boolean(me.isHost) : Boolean(identity.isHost),
    isReady: me ? Boolean(me.isReady) : false,
    downloaded: me ? Boolean(me.downloaded) : (localStorage.getItem('playuno_downloaded') === 'true'),
    mode: normalizeMode(room?.mode || identity.mode || 'Standard'),
    maxPlayers: Number(room?.maxPlayers || identity.maxPlayers || 4)
  };
  return encodeURIComponent(JSON.stringify(snap));
}

function localRoomApi(url, options = {}) {
  const storeKey = 'playuno_local_rooms_v1';
  let rooms = {};
  try { rooms = JSON.parse(localStorage.getItem(storeKey) || '{}') || {}; } catch {}
  const save = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(rooms));
      if (window.BroadcastChannel) {
        const bc = new BroadcastChannel('playuno_rooms_sync');
        bc.postMessage({ type: 'sync', code });
        bc.close();
      }
    } catch {}
  };
  const body = (() => { try { return options.body ? JSON.parse(options.body) : {}; } catch { return {}; } })();
  const pubRoom = (r) => ({
    code: r.code, mode: normalizeMode(r.mode), status: r.status || 'waiting', hostId: r.hostId, maxPlayers: Number(r.maxPlayers) || 4,
    players: (r.players || []).map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, isHost: Boolean(p.isHost), isReady: Boolean(p.isReady), downloaded: Boolean(p.downloaded)
    }))
  });

  const m = String(url).match(/\/api\/rooms\/([^/]+)(?:\/([^/?]+))?/);
  const rCode = (m ? decodeURIComponent(m[1]) : code).replace(/^#?UNO[\s-]*/i, '').trim().toUpperCase();
  const op = (m ? (m[2] || 'state') : 'state').split('?')[0];
  let r = rooms[rCode];
  if (!r && identity) {
    r = {
      code: rCode,
      mode: normalizeMode(identity.mode || 'Standard'),
      status: 'waiting',
      hostId: identity.isHost ? identity.playerId : '',
      maxPlayers: Number(identity.maxPlayers) || 4,
      players: [{
        id: identity.playerId,
        token: identity.token,
        name: identity.name || 'Player',
        avatar: identity.avatar || AVATARS[0],
        isHost: Boolean(identity.isHost),
        isReady: false,
        downloaded: localStorage.getItem('playuno_downloaded') === 'true',
        lastSeen: Date.now()
      }],
      messages: []
    };
    rooms[rCode] = r;
    save();
  }
  if (!r) throw new Error(t('roomNotFound'));

  if (op === 'state') {
    return { room: pubRoom(r), messages: r.messages || [] };
  }
  const tok = body.token || identity?.token;
  const player = (r.players || []).find((p) => p.token === tok || p.id === identity?.playerId);
  if (!player) throw new Error(t('invalidIdentity'));

  if (op === 'ready') {
    player.isReady = !player.isReady;
    save();
    return { room: pubRoom(r) };
  }
  if (op === 'mode') {
    if (!player.isHost) throw new Error(t('onlyHost'));
    const nextMode = normalizeMode(body.mode);
    r.mode = nextMode;
    r.messages.push({ id: String(Date.now()), name: 'TUNOTOGETHER.COM', message: `Game mode set to ${r.mode}.`, system: true, time: Date.now() });
    save();
    return { room: pubRoom(r) };
  }
  if (op === 'profile') {
    player.name = String(body.name || player.name).trim().slice(0, 24) || player.name;
    if (AVATARS.includes(body.avatar)) player.avatar = body.avatar;
    save();
    return { room: pubRoom(r) };
  }
  if (op === 'downloaded') {
    player.downloaded = true;
    save();
    return { room: pubRoom(r) };
  }
  if (op === 'chat') {
    const msgText = String(body.message || '').trim().slice(0, 500);
    if (!msgText) throw new Error(t('emptyMessage'));
    const chat = { id: String(Date.now() + Math.random()), name: player.name, message: msgText, time: Date.now() };
    r.messages.push(chat);
    if (r.messages.length > 100) r.messages = r.messages.slice(-100);
    save();
    return { ok: true, message: chat };
  }
  if (op === 'kick') {
    if (!player.isHost) throw new Error(t('onlyHostKick'));
    const target = r.players.find((p) => p.id === body.playerId && p.id !== player.id);
    if (!target) throw new Error(t('playerNotFound'));
    r.players = r.players.filter((p) => p.id !== target.id);
    r.messages.push({ id: String(Date.now()), name: 'TUNOTOGETHER.COM', message: `${target.name} was removed from the room.`, system: true, time: Date.now() });
    save();
    return { room: pubRoom(r) };
  }
  if (op === 'leave') {
    const wasHost = player.isHost;
    r.players = r.players.filter((p) => p.id !== player.id);
    if (!r.players.length) {
      delete rooms[rCode];
    } else {
      if (wasHost) {
        r.players[0].isHost = true;
        r.hostId = r.players[0].id;
      }
      r.messages.push({ id: String(Date.now()), name: 'TUNOTOGETHER.COM', message: `${player.name} left the room.`, system: true, time: Date.now() });
    }
    save();
    return { ok: true };
  }
  if (op === 'start') {
    if (!player.isHost) throw new Error(t('onlyHostStart'));
    const missing = r.players.some((p) => !p.downloaded);
    if (missing) {
      return { blocked: true, title: t('warningStart'), message: t('warningHost') };
    }
    r.status = 'started';
    r.messages.push({ id: String(Date.now()), name: 'TUNOTOGETHER.COM', message: t('allDownloaded'), system: true, time: Date.now() });
    save();
    return { ok: true, room: pubRoom(r), message: t('allDownloaded') };
  }
  return { room: pubRoom(r) };
}

async function api(url, options={}){
  if(location.protocol==='file:')return localRoomApi(url, options);
  const targets=[url];
  const m=String(url).match(/\/api\/rooms\/([^/]+)(?:\/([^/?]+))?/);
  if(m){
    const c=encodeURIComponent(decodeURIComponent(m[1]));
    const op=encodeURIComponent((m[2]||'state').split('?')[0]);
    targets.push(`../api.php?action=${op}&code=${c}`);
  }
  const snapHeader=buildSnapshotHeader();

  let lastError=null;
  for(const target of targets){
    try{
      const response=await fetch(target,{
        method:options.method||'GET',
        body:options.body,
        headers:{
          'Content-Type':'application/json',
          'Accept':'application/json',
          ...(snapHeader?{'X-PlayUno-Player':snapHeader}:{}),
          ...(options.headers||{})
        },
        cache:'no-store',
        credentials:'same-origin'
      });
      const text=await response.text();
      if(text&&text.trim().startsWith('<?php'))continue;
      let data={};
      try{data=text?JSON.parse(text):{};}catch{continue;}
      if(!response.ok){
        if(response.status===404||response.status===405)continue;
        throw new Error(data.error||t('requestFailed',{n:response.status}));
      }
      return data;
    }catch(e){
      lastError=e;
      if(e&&e.message&&!/Failed to fetch|NetworkError|404|405/i.test(e.message))throw e;
    }
  }
  try{return localRoomApi(url, options);}catch(fallbackErr){throw lastError||fallbackErr;}
}

function roomCapacity(){return Number(room?.maxPlayers)||Number(CONFIG.MAX_PLAYERS)||10;}
function renderVoiceList(){
  const box=$('voiceList'); if(!box||!room)return;
  const lang=window.PlayUnoI18n?.getLang?.()||'en';
  const youWord=lang==='de'?'Du':'You';
  box.innerHTML=room.players.map(player=>{
    const active=player.id===identity.playerId?Boolean(voiceStream):voicePeers.has(player.id);
    return `<div class="voice-user"><span class="voice-dot ${active?'on':''}"></span><span>${escapeHtml(player.name)}${player.id===identity.playerId?' · '+youWord:''}</span></div>`;
  }).join('');
}
function updateVoiceUI(){
  const joined=Boolean(voiceStream),status=$('voiceStatus'),join=$('voiceJoinBtn'),mute=$('voiceMuteBtn'),leave=$('voiceLeaveBtn');
  const me=room?.players?.find(player=>player.id===identity?.playerId);
  const appReady=Boolean(me?.downloaded);
  if(status){status.textContent=joined?(voiceMuted?t('voiceMuted'):t('voiceActive')):(appReady?t('voiceOff'):t('voiceNeeded'));status.classList.toggle('live',joined);}
  if(join){join.disabled=joined; join.title=joined?t('voiceActive'):(appReady?t('voiceJoin'):t('voiceNeeded'));}
  if(mute){mute.disabled=!joined;mute.innerHTML=voiceMuted?'<i class="fa-solid fa-microphone-slash"></i>':'<i class="fa-solid fa-microphone"></i>';mute.title=voiceMuted?t('micOn'):t('micOff');}
  if(leave)leave.disabled=!joined; renderVoiceList();
}
function removeVoicePeer(peerId){
  const pc=voicePeers.get(peerId);if(pc)pc.close();voicePeers.delete(peerId);
  const audio=voiceAudio.get(peerId);if(audio){audio.pause();audio.srcObject=null;}voiceAudio.delete(peerId);renderVoiceList();
}
async function startVoice(){
  if(voiceStream)return;
  const me=room?.players?.find(player=>player.id===identity?.playerId);
  if(!me?.downloaded){
    showWarning(t('voiceTitle')||t('voiceNeeded'),t('voiceWarning'),true,false);
    appendChat({id:String(Date.now()),system:true,message:t('voiceSystemMsg')||t('voiceWarning')},true);
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia){toast(t('voiceUnsupported'));return;}
  try{
    voiceStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    voiceMuted=false;
    updateVoiceUI();PlayUnoAudio?.play('success',.3);
  }catch{toast(t('micDenied'));PlayUnoAudio?.play('deny',.25);}
}
function stopVoice(){
  voicePeers.forEach(pc=>pc.close());voicePeers.clear();
  voiceAudio.forEach(a=>{a.pause();a.srcObject=null;});voiceAudio.clear();
  voiceStream?.getTracks().forEach(t=>t.stop());voiceStream=null;voiceMuted=false;updateVoiceUI();
}
function toggleVoiceMute(){if(!voiceStream)return;voiceMuted=!voiceMuted;voiceStream.getAudioTracks().forEach(t=>t.enabled=!voiceMuted);updateVoiceUI();PlayUnoAudio?.play('check',.22);}

function renderAvatars(){
  const box=$('profileAvatars'); if(!box)return;
  box.innerHTML=AVATARS.map(avatar=>`<button type="button" class="avatar-option ${avatar===profileAvatar?'selected':''}" data-avatar="${escapeHtml(avatar)}" aria-label="${escapeHtml(t('avatarSelect'))}"><img src="${avatarUrl(avatar)}" alt="" draggable="false"><span class="avatar-check"><i class="fa-solid fa-check"></i></span></button>`).join('');
  box.querySelectorAll('.avatar-option').forEach(button=>button.addEventListener('click',()=>{box.querySelectorAll('.avatar-option').forEach(item=>item.classList.remove('selected'));button.classList.add('selected');profileAvatar=button.dataset.avatar;PlayUnoAudio?.play('check',.35);}));
}

function renderPlayers(){
  const grid=$('players'); const me=room.players.find(p=>p.id===identity.playerId); const capacity=roomCapacity(); grid.innerHTML='';
  const lang=window.PlayUnoI18n?.getLang?.()||'en';
  for(let index=0;index<capacity;index++){
    const player=room.players[index]; const card=document.createElement('div');
    if(!player){card.className='player-card empty-card';card.innerHTML=`<div class="player-avatar"><i class="fa-solid fa-user-plus"></i></div><span style="color:#625c68;font-size:9px;font-weight:800">${t('players')}</span>`;grid.appendChild(card);continue;}
    card.className='player-card'+(player.isReady?' ready-glow':'');
    const hostText=player.isHost?`<span class="host">${lang==='de'?'Besitzer':'Room Owner'}</span>`:(lang==='de'?'Spieler':'Player');
    const readyText=player.isReady?`<span class="ready">${t('readyStatus')}</span>`:t('notReady');
    const youText=player.id===identity.playerId?(lang==='de'?' · Du':' · You'):'';
    const appBadge=player.downloaded
      ?`<span class="player-badge app"><i class="fa-solid fa-check"></i> App</span>`
      :`<span class="player-badge noapp"><i class="fa-solid fa-download"></i> ${lang==='de'?'Keine App':'No app'}</span>`;
    card.innerHTML=`<div class="player-main"><div class="player-avatar"><img src="${avatarUrl(player.avatar)}" alt=""></div><div style="min-width:0;flex:1"><span class="player-name">${escapeHtml(player.name)}${youText}</span><span class="player-meta">${hostText} · ${readyText} ${appBadge}</span></div></div><div class="player-actions">${me?.isHost&&player.id!==me.id?`<button class="kick-btn" type="button" data-kick="${escapeHtml(player.id)}" data-sound="deny"><i class="fa-solid fa-user-xmark"></i> ${lang==='de'?'Entfernen':'Remove'}</button>`:''}</div>`;
    grid.appendChild(card);
  }
  grid.querySelectorAll('[data-kick]').forEach(button=>button.addEventListener('click',()=>kickPlayer(button.dataset.kick)));
  PlayUnoAudio?.bind(grid);
}

function updateReadyProgress(){
  if(!room)return;
  const total=room.players.length||0;
  const ready=room.players.filter(p=>p.isReady).length;
  const text=$('readyProgressText'); const fill=$('readyProgressFill');
  if(text)text.textContent=`${ready} / ${total}`;
  if(fill)fill.style.width=total?`${Math.round((ready/total)*100)}%`:'0%';
}

function render(){
  if(!room||!identity)return;
  const capacity=roomCapacity();
  $('roomCode').textContent=`#UNO-${room.code}`;
  $('roomCapacity').innerHTML=`<i class="fa-solid fa-users"></i> ${room.players.length} / ${capacity} ${t('players')}`;
  const select=$('modeSelect');
  const normMode=normalizeMode(room.mode);
  select.innerHTML=MODES.map(mode=>`<option value="${escapeHtml(mode)}">${escapeHtml(modeLabel(mode))}</option>`).join('');
  select.value=normMode;
  const me=room.players.find(p=>p.id===identity.playerId);
  if(me){
    saveIdentity({...identity, name:me.name, avatar:me.avatar, isHost:Boolean(me.isHost), mode:normMode, maxPlayers:capacity});
  }
  $('readyBtn').textContent=me?.isReady?t('notReady'):t('ready');$('readyBtn').classList.toggle('active',Boolean(me?.isReady));$('readyBtn').disabled=!me;
  $('startBtn').disabled=!me?.isHost;$('modeSelect').disabled=!me?.isHost;
  $('hostHint').textContent=me?.isHost?t('hostYou'):t('hostOther');
  const waiting=room.status==='waiting';$('roomStatus').className=`status-pill ${waiting?'':'ready'}`;$('roomStatus').innerHTML=waiting?`<i class="fa-solid fa-clock"></i> ${t('waiting')}`:`<i class="fa-solid fa-check"></i> ${t('readyStatus')}`;
  renderPlayers();
  renderVoiceList();
  updateVoiceUI();
  updateReadyProgress();
  const voicePanel=document.querySelector('.voice-panel');
  if(voicePanel)voicePanel.classList.toggle('live-voice',Boolean(voiceStream));
}

function renderChat(messages){const box=$('chat');box.innerHTML='';seenChatMessages.clear();(messages||[]).forEach(message=>appendChat(message,false));box.scrollTop=box.scrollHeight;}
function formatTime(ts){
  if(!ts)return '';
  const d=new Date(ts);
  if(Number.isNaN(d.getTime()))return '';
  return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}
function appendChat(message,scroll=true){
  if(!message)return;
  const msgKey = message.id || `${message.name||''}:${message.time||''}:${message.message||''}`;
  if(seenChatMessages.has(msgKey))return;
  seenChatMessages.add(msgKey);
  if(seenChatMessages.size>250)seenChatMessages.delete(seenChatMessages.values().next().value);
  const box=$('chat'); if(!box)return;
  const element=document.createElement('div');
  const isMine=!message.system && identity && message.name && room?.players?.find(p=>p.id===identity.playerId)?.name===message.name;
  element.className=`chat-message ${message.system?'chat-system':''}${isMine?' mine':''}`;
  if(message.system){
    element.textContent=message.message;
  }else{
    const time=formatTime(message.time);
    const photo=message.imageUrl?`<a class="chat-image-link" href="${escapeHtml(message.imageUrl)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(message.imageUrl)}" alt="${escapeHtml(t('sharedPhoto'))}" loading="lazy"></a>`:'';
    element.innerHTML=`<b>${escapeHtml(message.name)}</b>${message.message?`<span>: ${escapeHtml(message.message)}</span>`:''}${photo}${time?`<span class="chat-time">${time}</span>`:''}`;
  }
  box.appendChild(element);
  if(scroll)box.scrollTop=box.scrollHeight;
  if(!message.system)PlayUnoAudio?.play('message',.22);
}

async function uploadChatImage(){
  const input=$('chatImageInput'),button=$('chatImageBtn'),file=input?.files?.[0];if(!file)return;
  if(file.size>5*1024*1024){toast(t('imageTooLarge'));input.value='';return;}
  if(button)button.disabled=true;toast(t('imageUploading'));
  const reader=new FileReader();
  reader.onload=async()=>{
    try{
      const dataUrl=String(reader.result||'');
      const chatRes=await api(`/api/rooms/${encodeURIComponent(code)}/chat`,{
        method:'POST',
        body:JSON.stringify({token:identity.token,message:'',imageUrl:dataUrl})
      });
      if(chatRes.message)appendChat(chatRes.message,true);
      input.value='';
    }catch(err){
      toast(err.message||t('imageUploadFailed'));
    }finally{
      if(button)button.disabled=false;
    }
  };
  reader.readAsDataURL(file);
}

let warningLeavesRoom=false;
function showWarning(title,message,showDownload=true,leaveOnClose=false){warningLeavesRoom=leaveOnClose;$('warningTitle').textContent=title||t('warningStart');$('warningText').textContent=message||'';const button=$('warningDownloadBtn');button.classList.toggle('hidden',!showDownload);$('warningModal').classList.remove('hidden');PlayUnoAudio?.play('warning',.35);}
function closeWarning(){warningLeavesRoom=false;$('warningModal').classList.add('hidden');}
async function closeWarningAction(){if(warningLeavesRoom){warningLeavesRoom=false;$('warningModal').classList.add('hidden');await leaveRoom();return;}closeWarning();}
function closeProfileModal(){$('profileModal').classList.add('hidden');}

async function downloadAndMark(){
  const url=String(CONFIG.DOWNLOAD_URL||'').trim();
  if(!url||url.includes('YOUR-DOMAIN')){toast(t('downloadConfig'));return;}
  try{const data=await api(`/api/rooms/${encodeURIComponent(code)}/downloaded`,{method:'POST',body:JSON.stringify({token:identity.token,lang:window.PlayUnoI18n?.getLang?.()||'en'})});if(data.room)room=data.room;localStorage.setItem('playuno_downloaded','true');PlayUnoAudio?.play('download',.45);render();}catch(error){toast(error.message);return;}
  window.location.assign(url);
}
async function toggleReady(){try{const data=await api(`/api/rooms/${encodeURIComponent(code)}/ready`,{method:'POST',body:JSON.stringify({token:identity.token,lang:window.PlayUnoI18n?.getLang?.()||'en'})});room=data.room;PlayUnoAudio?.play('check',.35);render();}catch(error){toast(error.message);}}
async function changeMode(mode){try{const data=await api(`/api/rooms/${encodeURIComponent(code)}/mode`,{method:'POST',body:JSON.stringify({token:identity.token,mode:normalizeMode(mode)})});room=data.room;PlayUnoAudio?.play('check',.25);render();}catch(error){toast(error.message);render();}}
async function startGame(){PlayUnoAudio?.play('start',.45);try{const data=await api(`/api/rooms/${encodeURIComponent(code)}/start`,{method:'POST',body:JSON.stringify({token:identity.token,lang:window.PlayUnoI18n?.getLang?.()||'en'})});if(data.blocked&&data.message)showWarning(data.title||t('warningStart'),data.message);else if(data.room){room=data.room;render();if(data.message)toast(data.message);}}catch(error){toast(error.message);PlayUnoAudio?.play('deny',.3);}}
async function kickPlayer(playerId){try{const data=await api(`/api/rooms/${encodeURIComponent(code)}/kick`,{method:'POST',body:JSON.stringify({token:identity.token,playerId})});room=data.room;PlayUnoAudio?.play('deny',.3);render();}catch(error){toast(error.message);}}
async function sendChat(event){event.preventDefault();const input=$('chatInput');const message=input.value.trim();if(!message)return;try{const chatRes=await api(`/api/rooms/${encodeURIComponent(code)}/chat`,{method:'POST',body:JSON.stringify({token:identity.token,message})});input.value='';PlayUnoAudio?.play('click',.22);if(chatRes.message)appendChat(chatRes.message);else pollRoom();}catch(error){toast(error.message);}}
async function copyInvite(){const url=new URL(`?room=${encodeURIComponent(code)}`,location.href).href;try{await navigator.clipboard.writeText(url);toast(t('copyDone'));PlayUnoAudio?.play('success',.35);}catch{window.prompt('Room link',url);}}
async function copyCode(){const value=`UNO-${code}`;try{await navigator.clipboard.writeText(value);toast(t('codeCopied'));PlayUnoAudio?.play('success',.35);const btn=$('copyCodeBtn');if(btn){btn.classList.add('copied');setTimeout(()=>btn.classList.remove('copied'),1200);}}catch{window.prompt(t('copyCode')||'Room code',value);}}
async function shareRoomNative(){
  const url=new URL(`?room=${encodeURIComponent(code)}`,location.href).href;
  const title='TUNOTOGETHER.COM';
  const shareText=`TUNOTOGETHER.COM room code: UNO-${code}\n${url}`;
  if(navigator.share){
    try{await navigator.share({title,text:shareText,url});PlayUnoAudio?.play('success',.3);return;}catch{}
  }
  try{await navigator.clipboard.writeText(shareText);toast(t('copyDone'));PlayUnoAudio?.play('success',.35);}catch{window.prompt(t('shareRoom')||'Share',shareText);}
}
async function leaveRoom(){stopVoice();if(!identity||!code){location.href='../index.html';return;}try{await api(`/api/rooms/${encodeURIComponent(code)}/leave`,{method:'POST',body:JSON.stringify({token:identity.token,lang:window.PlayUnoI18n?.getLang?.()||'en'})});}catch{}clearIdentity();stopPolling();location.href='../index.html';}
function openProfileModal(){const me=room?.players.find(p=>p.id===identity.playerId);$('profileName').value=me?.name||'';profileAvatar=me?.avatar||AVATARS[0];renderAvatars();$('profileModal').classList.remove('hidden');PlayUnoAudio?.play('click',.25);}
async function saveProfile(){const name=$('profileName').value.trim();if(!name){toast(t('missingName'));$('profileName').focus();return;}try{const data=await api(`/api/rooms/${encodeURIComponent(code)}/profile`,{method:'POST',body:JSON.stringify({token:identity.token,name,avatar:profileAvatar})});room=data.room;localStorage.setItem('playuno_name',name);closeProfileModal();PlayUnoAudio?.play('success',.35);render();}catch(error){toast(error.message);}}

function updateSoundButton(){const muted=PlayUnoAudio?.isMuted?.();const button=$('soundToggleBtn');if(!button)return;button.innerHTML=muted?`<i class="fa-solid fa-volume-xmark"></i><span>${t('openSound')}</span>`:`<i class="fa-solid fa-volume-high"></i><span>${t('closeSound')}</span>`;button.classList.toggle('muted',muted);}
function toggleSiteSound(){const muted=PlayUnoAudio.toggleMute();updateSoundButton();if(!muted)PlayUnoAudio.play('success',.3);}

let pollTimer=null;
function connectSocket(){
  startPolling();
  if(window.BroadcastChannel){
    try{
      const bc=new BroadcastChannel('playuno_rooms_sync');
      bc.onmessage=()=>pollRoom();
    }catch{}
  }
}
function startPolling(){
  stopPolling();
  pollTimer=setInterval(pollRoom,1500);
}
function stopPolling(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}
async function pollRoom(){
  if(!code||!identity)return;
  try{
    const data=await api(`/api/rooms/${encodeURIComponent(code)}/state?lang=${encodeURIComponent(window.PlayUnoI18n?.getLang?.()||'en')}`,{headers:{Authorization:`Bearer ${identity.token}`}});
    const prevIds=(room?.players||[]).map(p=>p.id).join(',');
    room=data.room;
    const msgs=data.messages||[];
    msgs.forEach(msg=>appendChat(msg,true));
    render();
    const nowIds=(room?.players||[]).map(p=>p.id).join(',');
    if(prevIds&&nowIds&&!nowIds.includes(identity.playerId)){
      stopPolling();stopVoice();
      clearIdentity();
      showWarning(t('kicked'),t('kickedText'),false,true);
    }
  }catch(e){
    if(String(e.message||'').includes('404')||String(e.message||'').includes('no longer exists')){
      stopPolling();
      toast(t('roomNotFound'));
      setTimeout(()=>location.href='../index.html',1200);
    }
  }
}

async function boot(){
  if(!code){location.href='../index.html';return;}
  identity=savedIdentity();
  if(!identity){location.href=`../index.html?room=${encodeURIComponent(code)}`;return;}
  try{
    const data=await api(`/api/rooms/${encodeURIComponent(code)}/state?lang=${encodeURIComponent(window.PlayUnoI18n?.getLang?.()||'en')}`,{headers:{Authorization:`Bearer ${identity.token}`}});
    room=data.room;
    render();
    renderChat(data.messages||[]);
    connectSocket();
  }catch(error){
    clearIdentity();
    location.href=`../index.html?room=${encodeURIComponent(code)}`;
  }
}

function bindEvents(){
  $('copyInviteBtn')?.addEventListener('click',copyInvite);
  $('copyCodeBtn')?.addEventListener('click',copyCode);
  $('shareNativeBtn')?.addEventListener('click',shareRoomNative);
  $('roomCodeWrap')?.addEventListener('click',copyCode);
  $('leaveTopBtn')?.addEventListener('click',()=>leaveRoom());
  $('readyBtn')?.addEventListener('click',toggleReady);
  $('profileBtn')?.addEventListener('click',openProfileModal);
  $('profileCloseBtn')?.addEventListener('click',closeProfileModal);
  $('profileSaveBtn')?.addEventListener('click',saveProfile);
  $('modeSelect')?.addEventListener('change',event=>changeMode(event.target.value));
  $('startBtn')?.addEventListener('click',startGame);
  $('chatForm')?.addEventListener('submit',sendChat);
  $('chatImageBtn')?.addEventListener('click',()=>$('chatImageInput')?.click());
  $('chatImageInput')?.addEventListener('change',uploadChatImage);
  $('warningDownloadBtn')?.addEventListener('click',downloadAndMark);
  $('warningCloseBtn')?.addEventListener('click',closeWarningAction);
  $('soundToggleBtn')?.addEventListener('click',toggleSiteSound);
  $('voiceJoinBtn')?.addEventListener('click',startVoice);
  $('voiceMuteBtn')?.addEventListener('click',toggleVoiceMute);
  $('voiceLeaveBtn')?.addEventListener('click',stopVoice);
  document.querySelectorAll('.emoji-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const input=$('chatInput'); if(!input)return;
    input.value=(input.value||'')+btn.dataset.emoji;
    input.focus();
    PlayUnoAudio?.play('click',.15);
  }));
  document.querySelectorAll('.modal-backdrop').forEach(backdrop=>backdrop.addEventListener('click',event=>{if(event.target!==backdrop)return;if(backdrop.id==='warningModal')closeWarningAction();else if(backdrop.id==='profileModal')closeProfileModal();}));
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!$('warningModal').classList.contains('hidden'))closeWarningAction();else closeProfileModal();});
}

document.addEventListener('playuno:language',()=>{if(room)render();updateVoiceUI();updateSoundButton();renderAvatars();});

document.addEventListener('DOMContentLoaded',()=>{renderAvatars();updateSoundButton();bindEvents();PlayUnoAudio?.bind();boot();});
window.addEventListener('beforeunload',()=>{stopPolling();stopVoice();});
