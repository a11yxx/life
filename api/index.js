const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOMS_FILE = path.join(os.tmpdir(), 'tunotogether_rooms.json');
const MODES = ['Standard', 'Brutal', 'Double Side', 'Party', 'Fast', 'Standart', 'Acımasız', 'Çift Taraf', 'Parti', 'Hızlı'];
const MODE_NORMALIZE = {
  'Standart': 'Standard',
  'Standard': 'Standard',
  'Acımasız': 'Brutal',
  'Brutal': 'Brutal',
  'Çift Taraf': 'Double Side',
  'Double Side': 'Double Side',
  'Parti': 'Party',
  'Party': 'Party',
  'Hızlı': 'Fast',
  'Fast': 'Fast'
};
const AVATARS = [
  'aria.svg','atlas.svg','dylan.svg','ethan.svg','iris.svg','leo.svg','luna.svg','man.svg','mason.svg','mia.svg',
  'moonbyte.svg','noah.svg','nova.svg','pixel.svg','raven.svg','selena.svg','violet.svg','woman.svg','zen.svg','custom.svg'
];

const MESSAGES = {
  en: {
    roomGone: 'This room no longer exists.',
    noNewPlayers: 'This room is no longer accepting new players.',
    roomFull: 'The room is full ({n} players).',
    invalidIdentity: 'Invalid room identity.',
    onlyHost: 'Only the room owner can do this.',
    invalidMode: 'Invalid game mode.',
    playerNotFound: 'Player not found.',
    emptyMessage: 'Message cannot be empty.',
    capacityRange: 'Room capacity must be between 2 and 10 players.',
    startTitle: 'Game Could Not Start',
    startHost: 'A player in the room has not downloaded the desktop app yet. The game can start after everyone downloads it.',
    allDownloaded: 'Everyone has downloaded the app. Open the TUNOTOGETHER.COM desktop app to continue.',
    createdRoom: '{name} created the room.',
    joinedRoom: '{name} joined the room.',
    leftRoom: '{name} left the room.',
    kickedRoom: '{name} was removed from the room.',
    modeChanged: 'Game mode set to {mode}.'
  },
  de: {
    roomGone: 'Dieser Raum existiert nicht mehr.',
    noNewPlayers: 'Dieser Raum nimmt keine neuen Spieler mehr auf.',
    roomFull: 'Der Raum ist voll ({n} Spieler).',
    invalidIdentity: 'Ungültige Raum-ID.',
    onlyHost: 'Nur der Raum-Besitzer kann dies tun.',
    invalidMode: 'Ungültiger Spielmodus.',
    playerNotFound: 'Spieler nicht gefunden.',
    emptyMessage: 'Die Nachricht darf nicht leer sein.',
    capacityRange: 'Die Raumkapazität muss zwischen 2 und 10 Spielern liegen.',
    startTitle: 'Spiel konnte nicht gestartet werden',
    startHost: 'Ein Spieler im Raum hat die Desktop-App noch nicht heruntergeladen.',
    allDownloaded: 'Alle Spieler haben die App heruntergeladen. Öffne die Desktop-App, um fortzufahren.',
    createdRoom: '{name} hat den Raum erstellt.',
    joinedRoom: '{name} ist dem Raum beigetreten.',
    leftRoom: '{name} hat den Raum verlassen.',
    kickedRoom: '{name} wurde aus dem Raum entfernt.',
    modeChanged: 'Spielmodus auf {mode} gesetzt.'
  }
};

function msg(lang, key, vars = {}) {
  const l = lang === 'de' ? 'de' : 'en';
  let text = MESSAGES[l]?.[key] || MESSAGES.en[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

function loadRooms() {
  if (!globalThis.__UNO_ROOMS) globalThis.__UNO_ROOMS = {};
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const disk = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8') || '{}');
      for (const [k, v] of Object.entries(disk)) {
        if (!globalThis.__UNO_ROOMS[k] || (v.updatedAt || 0) >= (globalThis.__UNO_ROOMS[k].updatedAt || 0)) {
          globalThis.__UNO_ROOMS[k] = v;
        }
      }
    }
  } catch {}
  return globalThis.__UNO_ROOMS;
}

function saveRooms(rooms) {
  globalThis.__UNO_ROOMS = rooms;
  try {
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms));
  } catch {}
}

function cleanName(v) {
  const n = String(v || '').trim().slice(0, 24);
  return n || 'Player';
}

function cleanAvatar(v, fallback = 'aria.svg') {
  const a = String(v || '').trim();
  return AVATARS.includes(a) ? a : fallback;
}

function cleanMode(v) {
  return MODE_NORMALIZE[v] || 'Standard';
}

function normalizeCode(v) {
  return String(v || '').replace(/^#?UNO[\s-]*/i, '').trim().toUpperCase();
}

function pubRoom(room) {
  return {
    code: room.code,
    mode: cleanMode(room.mode),
    status: room.status || 'waiting',
    hostId: room.hostId,
    maxPlayers: Number(room.maxPlayers) || 4,
    players: (room.players || []).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isHost: Boolean(p.isHost),
      isReady: Boolean(p.isReady),
      downloaded: Boolean(p.downloaded)
    }))
  };
}

function addSysMessage(room, text) {
  if (!Array.isArray(room.messages)) room.messages = [];
  room.messages.push({
    id: crypto.randomBytes(8).toString('hex'),
    name: 'TUNOTOGETHER.COM',
    message: text,
    system: true,
    time: Date.now()
  });
  if (room.messages.length > 100) room.messages = room.messages.slice(-100);
}

function parseSnapshot(req, body) {
  const rawHeader = req.headers['x-playuno-player'];
  if (rawHeader) {
    try {
      return JSON.parse(decodeURIComponent(rawHeader));
    } catch {
      try {
        return JSON.parse(Buffer.from(rawHeader, 'base64').toString('utf8'));
      } catch {}
    }
  }
  if (body && body.snapshot && typeof body.snapshot === 'object') return body.snapshot;
  return null;
}

function syncRoomFromSnapshot(rooms, code, snap) {
  if (!code || !snap || !snap.playerId || !snap.token) return rooms[code];
  let room = rooms[code];
  if (!room) {
    room = {
      code,
      mode: cleanMode(snap.mode),
      status: 'waiting',
      hostId: snap.isHost ? snap.playerId : '',
      maxPlayers: Math.min(10, Math.max(2, Number(snap.maxPlayers) || 4)),
      players: [],
      kickedIds: [],
      leftIds: [],
      messages: [],
      updatedAt: Date.now()
    };
    rooms[code] = room;
  }
  if (!Array.isArray(room.kickedIds)) room.kickedIds = [];
  if (!Array.isArray(room.leftIds)) room.leftIds = [];
  if (room.kickedIds.includes(snap.playerId) || room.leftIds.includes(snap.playerId)) {
    return room;
  }

  let existing = room.players.find((p) => p.id === snap.playerId || p.token === snap.token);
  if (!existing && room.players.length < (Number(room.maxPlayers) || 10)) {
    const p = {
      id: snap.playerId,
      token: snap.token,
      name: cleanName(snap.name),
      avatar: cleanAvatar(snap.avatar),
      isHost: Boolean(snap.isHost),
      isReady: Boolean(snap.isReady),
      downloaded: Boolean(snap.downloaded),
      lastSeen: Date.now()
    };
    if (p.isHost) {
      room.players.forEach((other) => { other.isHost = false; });
      room.players.unshift(p);
      room.hostId = p.id;
    } else {
      if (room.players.length === 0) {
        p.isHost = true;
        room.hostId = p.id;
      }
      room.players.push(p);
    }
    room.updatedAt = Date.now();
    saveRooms(rooms);
  } else if (existing) {
    existing.lastSeen = Date.now();
  }
  return room;
}

function readRawBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return resolve({ raw: Buffer.from(JSON.stringify(req.body)), json: req.body });
    }
    if (typeof req.body === 'string') {
      try {
        return resolve({ raw: Buffer.from(req.body), json: JSON.parse(req.body || '{}') });
      } catch {
        return resolve({ raw: Buffer.from(req.body), json: {} });
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return resolve({ raw: req.body, json: JSON.parse(req.body.toString('utf8') || '{}') });
      } catch {
        return resolve({ raw: req.body, json: {} });
      }
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      try {
        resolve({ raw: buf, json: JSON.parse(buf.toString('utf8') || '{}') });
      } catch {
        resolve({ raw: buf, json: {} });
      }
    });
  });
}

function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-PlayUno-Player');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-PlayUno-Player');
    return res.end();
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const { raw, json: body } = await readRawBody(req);

  let action = parsedUrl.searchParams.get('action') || req.query?.action || body.action || '';
  let rawCode = parsedUrl.searchParams.get('code') || req.query?.code || body.code || '';

  const roomMatch = pathname.match(/^\/api\/rooms\/([^/?]+)(?:\/([^/?]+))?/i);
  if (roomMatch) {
    rawCode = rawCode || roomMatch[1];
    action = action || roomMatch[2] || 'state';
  } else if (/^\/api\/rooms\/?$/i.test(pathname) && req.method === 'POST') {
    action = 'create';
  } else if (/\/health$/i.test(pathname)) {
    action = 'health';
  }

  if (!action && req.method === 'GET' && !rawCode) {
    action = 'health';
  }

  const lang = body.lang || parsedUrl.searchParams.get('lang') || 'en';
  const rooms = loadRooms();

  if (action === 'health') {
    const list = Object.values(rooms);
    const players = list.reduce((sum, r) => sum + ((r.players || []).length), 0);
    return sendJson(res, { ok: true, service: 'tunotogether-vercel', rooms: list.length, players });
  }

  if (action === 'create' && req.method === 'POST') {
    let code;
    do { code = String(crypto.randomInt(1000, 9999)); } while (rooms[code]);
    const pid = crypto.randomBytes(16).toString('hex');
    const tok = crypto.randomBytes(24).toString('hex');
    const name = cleanName(body.name);
    const avatar = cleanAvatar(body.avatar, 'aria.svg');
    const mode = cleanMode(body.mode);
    const maxPlayers = Math.min(10, Math.max(2, Number(body.maxPlayers) || 4));
    const player = {
      id: pid,
      token: tok,
      name,
      avatar,
      isHost: true,
      isReady: false,
      downloaded: Boolean(body.downloaded),
      lastSeen: Date.now()
    };
    const room = {
      code,
      mode,
      status: 'waiting',
      hostId: pid,
      maxPlayers,
      players: [player],
      kickedIds: [],
      leftIds: [],
      messages: [],
      updatedAt: Date.now()
    };
    addSysMessage(room, msg(lang, 'createdRoom', { name }));
    rooms[code] = room;
    saveRooms(rooms);
    return sendJson(res, {
      room: pubRoom(room),
      identity: { playerId: pid, token: tok, name, avatar, isHost: true, mode, maxPlayers }
    });
  }

  const code = normalizeCode(rawCode);
  if (!code) {
    return sendJson(res, { error: 'Room code is required.' }, 400);
  }

  const snap = parseSnapshot(req, body);

  if (action === 'join' && req.method === 'POST') {
    let room = rooms[code];
    if (!room) {
      room = {
        code,
        mode: 'Standard',
        status: 'waiting',
        hostId: '',
        maxPlayers: 10,
        players: [],
        kickedIds: [],
        leftIds: [],
        messages: [],
        updatedAt: Date.now()
      };
      rooms[code] = room;
    }
    if (room.status !== 'waiting') {
      return sendJson(res, { error: msg(lang, 'noNewPlayers') }, 409);
    }

    const name = cleanName(body.name);
    const avatar = cleanAvatar(body.avatar, 'atlas.svg');

    // If re-joining with an existing token in the same room, update & return it
    const existingToken = body.token || snap?.token || '';
    if (existingToken) {
      const existingPlayer = room.players.find((p) => p.token === existingToken);
      if (existingPlayer) {
        existingPlayer.name = name;
        existingPlayer.avatar = avatar;
        existingPlayer.lastSeen = Date.now();
        room.updatedAt = Date.now();
        saveRooms(rooms);
        return sendJson(res, {
          room: pubRoom(room),
          identity: {
            playerId: existingPlayer.id,
            token: existingPlayer.token,
            name: existingPlayer.name,
            avatar: existingPlayer.avatar,
            isHost: Boolean(existingPlayer.isHost),
            mode: room.mode,
            maxPlayers: room.maxPlayers
          }
        });
      }
    }

    if (room.players.length >= (Number(room.maxPlayers) || 10)) {
      return sendJson(res, { error: msg(lang, 'roomFull', { n: room.maxPlayers }) }, 409);
    }

    const pid = crypto.randomBytes(16).toString('hex');
    const tok = crypto.randomBytes(24).toString('hex');
    const isHost = room.players.length === 0;
    if (isHost) room.hostId = pid;

    room.players.push({
      id: pid,
      token: tok,
      name,
      avatar,
      isHost,
      isReady: false,
      downloaded: Boolean(body.downloaded),
      lastSeen: Date.now()
    });
    addSysMessage(room, msg(lang, 'joinedRoom', { name }));
    room.updatedAt = Date.now();
    saveRooms(rooms);

    return sendJson(res, {
      room: pubRoom(room),
      identity: { playerId: pid, token: tok, name, avatar, isHost, mode: room.mode, maxPlayers: room.maxPlayers }
    });
  }

  let room = syncRoomFromSnapshot(rooms, code, snap);
  if (!room) {
    return sendJson(res, { error: msg(lang, 'roomGone') }, 404);
  }

  if (action === 'state') {
    return sendJson(res, { room: pubRoom(room), messages: room.messages || [] });
  }

  let token = body.token || snap?.token || '';
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }

  const player = (room.players || []).find((p) => p.token === token || (snap?.playerId && p.id === snap.playerId));
  if (!player) {
    return sendJson(res, { error: msg(lang, 'invalidIdentity') }, 401);
  }
  player.lastSeen = Date.now();

  if (action === 'ready') {
    player.isReady = !player.isReady;
    room.updatedAt = Date.now();
    saveRooms(rooms);
    return sendJson(res, { room: pubRoom(room) });
  }

  if (action === 'mode') {
    if (!player.isHost) return sendJson(res, { error: msg(lang, 'onlyHost') }, 403);
    if (!MODES.includes(body.mode)) return sendJson(res, { error: msg(lang, 'invalidMode') }, 400);
    room.mode = cleanMode(body.mode);
    addSysMessage(room, msg(lang, 'modeChanged', { mode: room.mode }));
    room.updatedAt = Date.now();
    saveRooms(rooms);
    return sendJson(res, { room: pubRoom(room) });
  }

  if (action === 'profile') {
    player.name = cleanName(body.name || player.name);
    player.avatar = cleanAvatar(body.avatar, player.avatar);
    room.updatedAt = Date.now();
    saveRooms(rooms);
    return sendJson(res, { room: pubRoom(room) });
  }

  if (action === 'downloaded') {
    player.downloaded = true;
    room.updatedAt = Date.now();
    saveRooms(rooms);
    return sendJson(res, { room: pubRoom(room) });
  }

  if (action === 'chat') {
    const message = String(body.message || '').trim().slice(0, 500);
    const imageUrl = body.imageUrl ? String(body.imageUrl) : undefined;
    if (!message && !imageUrl) return sendJson(res, { error: msg(lang, 'emptyMessage') }, 400);
    if (!Array.isArray(room.messages)) room.messages = [];
    const chat = {
      id: crypto.randomBytes(8).toString('hex'),
      name: player.name,
      message,
      ...(imageUrl ? { imageUrl } : {}),
      time: Date.now()
    };
    room.messages.push(chat);
    if (room.messages.length > 100) room.messages = room.messages.slice(-100);
    room.updatedAt = Date.now();
    saveRooms(rooms);
    return sendJson(res, { ok: true, message: chat });
  }

  if (action === 'chat-image') {
    const contentType = req.headers['content-type'] || 'image/png';
    if (!raw || !raw.length) return sendJson(res, { error: msg(lang, 'emptyMessage') }, 400);
    const dataUrl = `data:${contentType};base64,${raw.toString('base64')}`;
    const chat = {
      id: crypto.randomBytes(8).toString('hex'),
      name: player.name,
      message: '',
      imageUrl: dataUrl,
      time: Date.now()
    };
    if (!Array.isArray(room.messages)) room.messages = [];
    room.messages.push(chat);
    if (room.messages.length > 100) room.messages = room.messages.slice(-100);
    room.updatedAt = Date.now();
    saveRooms(rooms);
    return sendJson(res, { ok: true, message: chat });
  }

  if (action === 'kick') {
    if (!player.isHost) return sendJson(res, { error: msg(lang, 'onlyHost') }, 403);
    const target = room.players.find((p) => p.id === body.playerId && p.id !== player.id);
    if (!target) return sendJson(res, { error: msg(lang, 'playerNotFound') }, 404);
    room.players = room.players.filter((p) => p.id !== target.id);
    if (!Array.isArray(room.kickedIds)) room.kickedIds = [];
    room.kickedIds.push(target.id);
    addSysMessage(room, msg(lang, 'kickedRoom', { name: target.name }));
    room.updatedAt = Date.now();
    saveRooms(rooms);
    return sendJson(res, { room: pubRoom(room) });
  }

  if (action === 'leave') {
    const wasHost = player.isHost;
    if (!Array.isArray(room.leftIds)) room.leftIds = [];
    room.leftIds.push(player.id);
    room.players = room.players.filter((p) => p.id !== player.id);
    if (!room.players.length) {
      delete rooms[code];
    } else {
      if (wasHost) {
        room.players[0].isHost = true;
        room.hostId = room.players[0].id;
      }
      addSysMessage(room, msg(lang, 'leftRoom', { name: player.name }));
      room.updatedAt = Date.now();
    }
    saveRooms(rooms);
    return sendJson(res, { ok: true });
  }

  if (action === 'start') {
    if (!player.isHost) return sendJson(res, { error: msg(lang, 'onlyHost') }, 403);
    const missing = room.players.some((p) => !p.downloaded);
    if (missing) {
      return sendJson(res, {
        blocked: true,
        title: msg(lang, 'startTitle'),
        message: msg(lang, 'startHost')
      });
    }
    room.status = 'started';
    const text = msg(lang, 'allDownloaded');
    addSysMessage(room, text);
    room.updatedAt = Date.now();
    saveRooms(rooms);
    return sendJson(res, { ok: true, room: pubRoom(room), message: text });
  }

  return sendJson(res, { error: 'Unknown action.' }, 404);
};
