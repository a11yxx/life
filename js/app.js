const AVATARS = [
  'aria.svg','atlas.svg','dylan.svg','ethan.svg','iris.svg','leo.svg','luna.svg','man.svg','mason.svg','mia.svg',
  'moonbyte.svg','noah.svg','nova.svg','pixel.svg','raven.svg','selena.svg','violet.svg','woman.svg','zen.svg','custom.svg'
];

const MODES = ['Standard','Brutal','Double Side','Party','Fast'];
const PLAYER_LIMITS = [2,3,4,5,6,7,8,9,10];
let createAvatar = AVATARS[0];
let joinAvatar = AVATARS[1];
let selectedMode = 'Standard';
let selectedMaxPlayers = 4;
const $ = (id) => document.getElementById(id);
const t = (key, vars) => window.PlayUnoI18n?.t(key, vars) || key;
const modeLabel = (mode) => window.PlayUnoI18n?.modeLabel(mode) || mode;

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(window.__playUnoToast);
  window.__playUnoToast = setTimeout(() => el.classList.add('hidden'), 3200);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function saveRoomIdentity(code, identity) {
  const key = `playuno_identity_${String(code).toUpperCase()}`;
  const raw = JSON.stringify(identity);
  try { sessionStorage.setItem(key, raw); } catch {}
}

function avatarMarkup(avatar, selected = false, type = 'create') {
  return `<button type="button" class="avatar-option ${selected ? 'selected' : ''}" data-avatar="${escapeHtml(avatar)}" data-avatar-type="${type}" aria-label="${escapeHtml(t('avatarSelect'))}"><img src="assets/avatars/${encodeURIComponent(avatar)}" alt="" draggable="false"><span class="avatar-check"><i class="fa-solid fa-check"></i></span></button>`;
}

function fillAvatars(containerId, type) {
  const box = $(containerId);
  if (!box) return;
  const current = type === 'create' ? createAvatar : joinAvatar;
  box.innerHTML = AVATARS.map((avatar) => avatarMarkup(avatar, avatar === current, type)).join('');
  box.querySelectorAll('.avatar-option').forEach((button) => {
    button.addEventListener('click', () => {
      box.querySelectorAll('.avatar-option').forEach((item) => item.classList.remove('selected'));
      button.classList.add('selected');
      if (type === 'create') createAvatar = button.dataset.avatar;
      else joinAvatar = button.dataset.avatar;
      PlayUnoAudio?.play('check', 0.35);
    });
  });
}

function updateCapacityPreview() {
  const select = $('createMaxPlayers');
  const preview = $('capacityPreview');
  if (!select || !preview) return;
  const count = Number(select.value) || 4;
  preview.innerHTML = `<img src="assets/icons/users.svg" alt=""><span>${t('capacity',{n:count})}</span>`;
}

function fillPlayerLimits() {
  const select = $('createMaxPlayers');
  if (!select) return;
  select.innerHTML = PLAYER_LIMITS.map((count) => `<option value="${count}">${count} ${t('players')}</option>`).join('');
  select.value = String(selectedMaxPlayers);
  updateCapacityPreview();
}

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

function openCreateModal(mode = 'Standard') {
  const norm = normalizeMode(mode);
  selectedMode = MODES.includes(norm) ? norm : 'Standard';
  selectedMaxPlayers = Number(localStorage.getItem('playuno_max_players')) || 4;
  const select = $('createMode');
  select.innerHTML = MODES.map((item) => `<option value="${escapeHtml(item)}" ${item === selectedMode ? 'selected' : ''}>${escapeHtml(modeLabel(item))}</option>`).join('');
  fillPlayerLimits();
  $('createName').value = localStorage.getItem('playuno_name') || '';
  fillAvatars('createAvatars', 'create');
  $('createModal').classList.remove('hidden');
  PlayUnoAudio?.play('click', 0.28);
  setTimeout(() => $('createName').focus(), 30);
}

function openJoinModal() {
  const params = new URLSearchParams(location.search);
  $('joinCode').value = params.get('room') || '';
  $('joinName').value = localStorage.getItem('playuno_name') || '';
  fillAvatars('joinAvatars', 'join');
  $('joinModal').classList.remove('hidden');
  PlayUnoAudio?.play('click', 0.28);
  setTimeout(() => ($('joinCode').value ? $('joinName') : $('joinCode')).focus(), 30);
}

function closeModal(id) {
  const modal = $(id);
  if (modal) modal.classList.add('hidden');
}

function parseRoomCode(raw) {
  let value = String(raw || '').trim();
  try {
    const url = new URL(value);
    const fromUrl = url.searchParams.get('room');
    if (fromUrl) value = fromUrl;
    else {
      const last = url.pathname.split('/').filter(Boolean).pop();
      if (last && !/^(room|index\.html)$/i.test(last)) value = last;
    }
  } catch {
    const match = value.match(/[?&]room=([^&#]+)/i);
    if (match) value = decodeURIComponent(match[1]);
  }
  return value.replace(/^#?UNO[\s-]*/i, '').trim().toUpperCase();
}

function localRoomFallback(url, options = {}) {
  const storeKey = 'playuno_local_rooms_v1';
  let rooms = {};
  try { rooms = JSON.parse(localStorage.getItem(storeKey) || '{}') || {}; } catch {}
  const save = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(rooms));
      if (window.BroadcastChannel) {
        const bc = new BroadcastChannel('playuno_rooms_sync');
        bc.postMessage({ type: 'sync' });
        bc.close();
      }
    } catch {}
  };
  const body = (() => { try { return options.body ? JSON.parse(options.body) : {}; } catch { return {}; } })();
  const randHex = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const pubRoom = (r) => ({
    code: r.code,
    mode: normalizeMode(r.mode),
    status: r.status || 'waiting',
    hostId: r.hostId,
    maxPlayers: Number(r.maxPlayers) || 4,
    players: (r.players || []).map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, isHost: Boolean(p.isHost), isReady: Boolean(p.isReady), downloaded: Boolean(p.downloaded)
    }))
  });

  const pathOnly = String(url).split('?')[0];
  if (/\/api\/rooms\/?$/.test(pathOnly) || String(url).includes('action=create')) {
    let code;
    do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms[code]);
    const pid = randHex(32);
    const tok = randHex(48);
    const name = String(body.name || 'Player').trim().slice(0, 24) || 'Player';
    const avatar = AVATARS.includes(body.avatar) ? body.avatar : AVATARS[0];
    const mode = normalizeMode(body.mode);
    const maxPlayers = Math.min(10, Math.max(2, Number(body.maxPlayers) || 4));
    const downloaded = localStorage.getItem('playuno_downloaded') === 'true';
    const player = { id: pid, token: tok, name, avatar, isHost: true, isReady: false, downloaded, lastSeen: Date.now() };
    const room = {
      code, mode, status: 'waiting', hostId: pid, maxPlayers,
      players: [player],
      messages: [{ id: randHex(16), name: 'TUNOTOGETHER.COM', message: `${name} created the room.`, system: true, time: Date.now() }]
    };
    rooms[code] = room;
    save();
    return {
      room: pubRoom(room),
      identity: { playerId: pid, token: tok, name, avatar, isHost: true, mode, maxPlayers }
    };
  }

  const m = String(url).match(/\/api\/rooms\/([^/]+)(?:\/([^/?]+))?/);
  const code = (m ? decodeURIComponent(m[1]) : body.code || '').replace(/^#?UNO[\s-]*/i, '').trim().toUpperCase();
  const op = m ? (m[2] || 'state') : '';
  if (op === 'join' || String(url).includes('action=join')) {
    let room = rooms[code];
    if (!room) {
      room = {
        code, mode: 'Standard', status: 'waiting', hostId: '', maxPlayers: 10,
        players: [], messages: []
      };
      rooms[code] = room;
    }
    if (room.players.length >= (Number(room.maxPlayers) || 10)) {
      throw new Error(t('roomFull', { n: room.maxPlayers }));
    }
    const pid = randHex(32);
    const tok = randHex(48);
    const name = String(body.name || 'Player').trim().slice(0, 24) || 'Player';
    const avatar = AVATARS.includes(body.avatar) ? body.avatar : AVATARS[1];
    const isHost = room.players.length === 0;
    if (isHost) room.hostId = pid;
    const downloaded = localStorage.getItem('playuno_downloaded') === 'true';
    room.players.push({ id: pid, token: tok, name, avatar, isHost, isReady: false, downloaded, lastSeen: Date.now() });
    room.messages.push({ id: randHex(16), name: 'TUNOTOGETHER.COM', message: `${name} joined the room.`, system: true, time: Date.now() });
    save();
    return {
      room: pubRoom(room),
      identity: { playerId: pid, token: tok, name, avatar, isHost, mode: room.mode, maxPlayers: room.maxPlayers }
    };
  }

  throw new Error(t('roomNotFound'));
}

async function requestJson(url, options = {}) {
  if (location.protocol === 'file:') {
    return localRoomFallback(url, options);
  }

  const targets = [url];
  const m = String(url).match(/\/api\/rooms\/([^/]+)(?:\/([^/?]+))?/);
  if (m) {
    const c = encodeURIComponent(decodeURIComponent(m[1]));
    const op = encodeURIComponent(m[2] || 'state');
    targets.push(`/api.php?action=${op}&code=${c}`);
  } else if (/\/api\/rooms\/?$/.test(String(url).split('?')[0])) {
    targets.push('/api.php?action=create');
  }

  let lastError = null;
  for (const target of targets) {
    try {
      const response = await fetch(target, {
        method: options.method || 'GET',
        body: options.body,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(options.headers || {})
        },
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const text = await response.text();
      if (text && text.trim().startsWith('<?php')) continue;
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { continue; }
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) continue;
        throw new Error(data.error || t('requestFailed', { n: response.status }));
      }
      if (data && (data.room || data.ok)) return data;
    } catch (err) {
      lastError = err;
      if (err && err.message && !/Failed to fetch|NetworkError|404|405/i.test(err.message)) {
        throw err;
      }
    }
  }

  try {
    return localRoomFallback(url, options);
  } catch (fallbackErr) {
    throw lastError || fallbackErr;
  }
}

async function submitCreateRoom() {
  const button = $('createSubmitBtn');
  const name = $('createName').value.trim();
  const mode = normalizeMode($('createMode').value);
  const maxPlayers = Number($('createMaxPlayers').value);
  if (!name) { toast(t('missingName')); $('createName').focus(); return; }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) { toast(t('selectPlayers')); return; }
  button.disabled = true; button.textContent = t('creating');
  try {
    const downloaded = localStorage.getItem('playuno_downloaded') === 'true';
    const data = await requestJson('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name, avatar: createAvatar, mode, maxPlayers, downloaded, lang: window.PlayUnoI18n?.getLang?.() || 'en' })
    });
    localStorage.setItem('playuno_name', name);
    localStorage.setItem('playuno_max_players', String(maxPlayers));
    saveRoomIdentity(data.room.code, {
      ...data.identity,
      name,
      avatar: createAvatar,
      isHost: true,
      mode,
      maxPlayers
    });
    PlayUnoAudio?.play('create', 0.45);
    location.href = `room/index.html?room=${encodeURIComponent(data.room.code)}`;
  } catch (error) { toast(error.message); PlayUnoAudio?.play('deny', 0.3); }
  finally { button.disabled = false; button.textContent = t('setupRoom'); }
}

async function submitJoinRoom() {
  const button = $('joinSubmitBtn');
  const code = parseRoomCode($('joinCode').value);
  const name = $('joinName').value.trim();
  if (!code) { toast(t('enterRoom')); return; }
  if (!name) { toast(t('missingName')); $('joinName').focus(); return; }
  button.disabled = true; button.textContent = t('joining');
  try {
    const downloaded = localStorage.getItem('playuno_downloaded') === 'true';
    const data = await requestJson(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      body: JSON.stringify({ name, avatar: joinAvatar, downloaded, lang: window.PlayUnoI18n?.getLang?.() || 'en' })
    });
    localStorage.setItem('playuno_name', name);
    saveRoomIdentity(data.room.code, {
      ...data.identity,
      name,
      avatar: joinAvatar,
      isHost: Boolean(data.identity?.isHost),
      mode: data.room.mode,
      maxPlayers: data.room.maxPlayers
    });
    PlayUnoAudio?.play('join', 0.45);
    location.href = `room/index.html?room=${encodeURIComponent(data.room.code)}`;
  } catch (error) { toast(error.message); PlayUnoAudio?.play('deny', 0.3); }
  finally { button.disabled = false; button.textContent = t('goRoom'); }
}

function downloadDesktopGame() {
  const url = String(window.PLAY_UNO_CONFIG?.DOWNLOAD_URL || '').trim();
  if (!url || url.includes('YOUR-DOMAIN')) { toast(t('downloadConfig')); return false; }
  PlayUnoAudio?.play('download', 0.45);
  localStorage.setItem('playuno_downloaded', 'true');
  window.location.assign(url);
  return true;
}

function toggleSiteSound() {
  const muted = PlayUnoAudio.toggleMute();
  const button = $('soundToggleBtn');
  if (button) {
    button.innerHTML = muted ? `<i class="fa-solid fa-volume-xmark"></i><span>${t('openSound')}</span>` : `<i class="fa-solid fa-volume-high"></i><span>${t('closeSound')}</span>`;
    button.classList.toggle('muted', muted);
  }
  if (!muted) PlayUnoAudio.play('success', 0.3);
}

function setTrailerSound() {
  const video = $('trailerVideo');
  if (!video) return;
  video.muted = !video.muted;
  const btn = $('trailerSoundBtn');
  if (btn) btn.innerHTML = video.muted ? `<i class="fa-solid fa-volume-xmark"></i> ${t('openSound')}` : `<i class="fa-solid fa-volume-high"></i> ${t('closeSound')}`;
  PlayUnoAudio?.play('click', 0.2);
}

function bootParticles() {
  const canvas = $('particleCanvas'); if (!canvas) return;
  const context = canvas.getContext('2d'); let width=0,height=0;
  const particles = Array.from({length:42},()=>({x:Math.random(),y:Math.random(),size:Math.random()*1.8+.5,speed:Math.random()*.00035+.00012,alpha:Math.random()*.35+.08}));
  function resize(){width=canvas.width=window.innerWidth;height=canvas.height=window.innerHeight;}
  function frame(){context.clearRect(0,0,width,height);for(const p of particles){p.y-=p.speed;if(p.y<-.02)p.y=1.02;context.fillStyle=`rgba(250,204,21,${p.alpha})`;context.beginPath();context.arc(p.x*width,p.y*height,p.size,0,Math.PI*2);context.fill();}requestAnimationFrame(frame);}
  resize(); window.addEventListener('resize',resize); frame();
}

function bindEvents() {
  $('headerDownloadBtn')?.addEventListener('click', downloadDesktopGame);
  $('downloadSectionBtn')?.addEventListener('click', downloadDesktopGame);
  $('heroDownloadBtn')?.addEventListener('click', downloadDesktopGame);
  $('headerCreateBtn')?.addEventListener('click', () => openCreateModal());
  $('heroCreateBtn')?.addEventListener('click', () => openCreateModal());
  $('heroJoinBtn')?.addEventListener('click', openJoinModal);
  $('soundToggleBtn')?.addEventListener('click', toggleSiteSound);
  $('trailerSoundBtn')?.addEventListener('click', setTrailerSound);
  document.querySelectorAll('.mode-card').forEach((card) => card.addEventListener('click', () => openCreateModal(card.dataset.mode)));
  $('createSubmitBtn')?.addEventListener('click', submitCreateRoom);
  $('joinSubmitBtn')?.addEventListener('click', submitJoinRoom);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => {if(event.target===backdrop) backdrop.classList.add('hidden');}));
  $('createMode')?.addEventListener('change', (event) => {selectedMode=normalizeMode(event.target.value); PlayUnoAudio?.play('check',.25);});
  $('createMaxPlayers')?.addEventListener('change', (event) => {selectedMaxPlayers=Number(event.target.value);updateCapacityPreview();PlayUnoAudio?.play('check',.25);});
  $('createName')?.addEventListener('keydown',(event)=>{if(event.key==='Enter')submitCreateRoom();});
  $('joinCode')?.addEventListener('keydown',(event)=>{if(event.key==='Enter')$('joinName').focus();});
  $('joinName')?.addEventListener('keydown',(event)=>{if(event.key==='Enter')submitJoinRoom();});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'){closeModal('createModal');closeModal('joinModal');}});
}

window.openCreateModal=openCreateModal; window.openJoinModal=openJoinModal; window.closeModal=closeModal; window.submitCreateRoom=submitCreateRoom; window.submitJoinRoom=submitJoinRoom; window.downloadDesktopGame=downloadDesktopGame;

document.addEventListener('playuno:language',()=>{
  fillAvatars('createAvatars','create'); fillAvatars('joinAvatars','join'); fillPlayerLimits();
  const select=$('createMode'); if(select){select.innerHTML=MODES.map(item=>`<option value="${escapeHtml(item)}">${escapeHtml(modeLabel(item))}</option>`).join('');select.value=selectedMode;}
  const soundBtn=$('soundToggleBtn'); const muted=PlayUnoAudio?.isMuted?.(); if(soundBtn){soundBtn.innerHTML=muted?`<i class="fa-solid fa-volume-xmark"></i><span>${t('openSound')}</span>`:`<i class="fa-solid fa-volume-high"></i><span>${t('closeSound')}</span>`;}
});

function seededPulse(seed, min, max){
  const time=Date.now()/60000;
  const wave=Math.sin(time*0.7+seed)*0.5+Math.sin(time*1.3+seed*2)*0.5;
  return Math.round(min+(max-min)*((wave+1)/2));
}

function formatStat(n){
  return Number(n).toLocaleString('en-US');
}

function animateStat(el, target, suffix=''){
  if(!el)return;
  const from=Number(String(el.dataset.value||'0').replace(/\D/g,''))||0;
  const to=Number(target)||0;
  el.dataset.value=String(to);
  const start=performance.now();
  const dur=700;
  function frame(now){
    const p=Math.min(1,(now-start)/dur);
    const eased=1-Math.pow(1-p,3);
    const val=Math.round(from+(to-from)*eased);
    el.textContent=formatStat(val)+suffix;
    if(p<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function refreshLiveStats(){
  const start=performance.now();
  const hour=new Date().getHours();
  const hourBoost = hour>=18&&hour<=23 ? 1.18 : hour>=12&&hour<=17 ? 1.08 : hour>=0&&hour<=6 ? 0.72 : 1;
  const basePlayers = Math.round(18420 * hourBoost) + seededPulse(3, 80, 420);
  const baseRooms = Math.round(2140 * hourBoost) + seededPulse(7, 12, 90);

  try{
    if (location.protocol === 'file:') throw new Error('local');
    const res=await fetch('/api/health',{cache:'no-store',credentials:'same-origin'});
    const data=await res.json();
    const latency=Math.max(1,Math.round(performance.now()-start));
    const liveRooms=Number(data.rooms)||0;
    const livePlayers=Number(data.players)||(liveRooms*3);
    const players=basePlayers + livePlayers + liveRooms*2;
    const rooms=baseRooms + liveRooms;
    animateStat($('statPlayers'), players, '+');
    animateStat($('statRooms'), rooms, '');
    const le=$('statLatency');
    if(le){le.textContent=latency+' ms';le.style.color=latency<80?'#4ade80':latency<180?'#facc15':'#fb7185';}
  }catch{
    animateStat($('statPlayers'), basePlayers, '+');
    animateStat($('statRooms'), baseRooms, '');
    const le=$('statLatency');
    if(le){le.textContent='12 ms';le.style.color='#4ade80';}
  }
}

function bootReveal(){
  const nodes=document.querySelectorAll('.reveal');
  if(!nodes.length)return;
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('revealed');io.unobserve(e.target);}});
  },{threshold:0.12,rootMargin:'0px 0px -40px 0px'});
  nodes.forEach(n=>io.observe(n));
}

function bootMobileMenu(){
  const btn=$('mobileMenuBtn'), nav=$('mainNav');
  if(!btn||!nav)return;
  btn.addEventListener('click',()=>{
    const open=nav.classList.toggle('open');
    btn.setAttribute('aria-expanded',open?'true':'false');
    btn.innerHTML=open?'<i class="fa-solid fa-xmark"></i>':'<i class="fa-solid fa-bars"></i>';
    PlayUnoAudio?.play('click',0.2);
  });
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
    nav.classList.remove('open');
    btn.setAttribute('aria-expanded','false');
    btn.innerHTML='<i class="fa-solid fa-bars"></i>';
  }));
}

function hideLoader(){
  const el=$('pageLoader');
  if(!el)return;
  el.classList.add('done');
  setTimeout(()=>el.remove(),500);
}

document.addEventListener('DOMContentLoaded',()=>{
  fillAvatars('createAvatars','create'); fillAvatars('joinAvatars','join'); fillPlayerLimits();
  $('createMode').innerHTML=MODES.map(item=>`<option value="${escapeHtml(item)}">${escapeHtml(modeLabel(item))}</option>`).join(''); $('createMode').value=selectedMode;
  const muted=PlayUnoAudio?.isMuted?.(); const soundBtn=$('soundToggleBtn'); if(soundBtn){soundBtn.innerHTML=muted?`<i class="fa-solid fa-volume-xmark"></i><span>${t('openSound')}</span>`:`<i class="fa-solid fa-volume-high"></i><span>${t('closeSound')}</span>`;soundBtn.classList.toggle('muted',muted);}
  bindEvents(); PlayUnoAudio?.bind(); bootParticles(); bootReveal(); bootMobileMenu(); refreshLiveStats(); setInterval(refreshLiveStats,20000); hideLoader();
  if (new URLSearchParams(location.search).get('room')) openJoinModal();
});
