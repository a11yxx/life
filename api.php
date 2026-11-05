<?php
/**
 * TUNOTOGETHER.COM API — PHP fallback (Vercel uses api/index.js)
 * Usage: /api.php?action=create|join|state|ready|...
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-PlayUno-Player');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

define('DATA_DIR', __DIR__ . '/data');
define('ROOMS_FILE', DATA_DIR . '/rooms.json');
define('MIN_PLAYERS', 2);
define('MAX_PLAYERS', 10);

$MODES = ['Standart', 'Acımasız', 'Çift Taraf', 'Parti', 'Hızlı'];
$AVATARS = [
  'aria.svg','atlas.svg','dylan.svg','ethan.svg','iris.svg','leo.svg','luna.svg','man.svg','mason.svg','mia.svg',
  'moonbyte.svg','noah.svg','nova.svg','pixel.svg','raven.svg','selena.svg','violet.svg','woman.svg','zen.svg','custom.svg'
];

$MESSAGES = [
  'en' => [
    'roomGone' => 'This room no longer exists.',
    'noNewPlayers' => 'This room is no longer accepting new players.',
    'roomFull' => 'The room is full (%d players).',
    'invalidIdentity' => 'Invalid room identity.',
    'onlyHost' => 'Only the room owner can do this.',
    'invalidMode' => 'Invalid game mode.',
    'playerNotFound' => 'Player not found.',
    'emptyMessage' => 'Message cannot be empty.',
    'capacityRange' => 'Capacity must be between %d and %d.',
    'startHost' => 'A player in the room has not downloaded the desktop app yet. The game can start once everyone has downloaded it.',
    'startPlayer' => 'Everyone must download the desktop app first.',
    'allDownloaded' => 'All players downloaded the app. Open the TUNOTOGETHER.COM desktop app to continue.',
    'createdRoom' => '%s created the room.',
    'joinedRoom' => '%s joined the room.',
    'leftRoom' => '%s left the room.',
    'kickedRoom' => '%s was removed from the room.',
    'modeSet' => 'Game mode changed to %s.',
    'roomCodeRequired' => 'Room code is required.',
    'startTitle' => 'Game Could Not Start',
  ],
  'de' => [
    'roomGone' => 'Dieser Raum existiert nicht mehr.',
    'noNewPlayers' => 'Keine neuen Spieler mehr.',
    'roomFull' => 'Raum voll (%d Spieler).',
    'invalidIdentity' => 'Ungültige ID.',
    'onlyHost' => 'Nur der Besitzer kann das.',
    'invalidMode' => 'Ungültiger Modus.',
    'playerNotFound' => 'Spieler nicht gefunden.',
    'emptyMessage' => 'Nachricht leer.',
    'capacityRange' => 'Kapazität %d–%d.',
    'startHost' => 'Ein Spieler im Raum hat die Desktop-App noch nicht heruntergeladen.',
    'startPlayer' => 'Alle müssen die App zuerst laden.',
    'allDownloaded' => 'Alle haben die App geladen. Öffne die TUNOTOGETHER.COM Desktop-App.',
    'createdRoom' => '%s hat den Raum erstellt.',
    'joinedRoom' => '%s ist dem Raum beigetreten.',
    'leftRoom' => '%s hat den Raum verlassen.',
    'kickedRoom' => '%s wurde aus dem Raum entfernt.',
    'modeSet' => 'Spielmodus auf %s geändert.',
    'roomCodeRequired' => 'Raumcode erforderlich.',
    'startTitle' => 'Spiel konnte nicht gestartet werden',
  ],
];

function lang($v) {
  $l = strtolower(substr((string)$v, 0, 2));
  return in_array($l, ['en','de'], true) ? $l : 'en';
}
function msg($l, $key, ...$args) {
  global $MESSAGES;
  $l = lang($l);
  $t = $MESSAGES[$l][$key] ?? $MESSAGES['en'][$key] ?? $key;
  return $args ? vsprintf($t, $args) : $t;
}
function body_json() {
  static $b = null;
  if ($b === null) {
    $raw = file_get_contents('php://input');
    $b = json_decode($raw ?: '{}', true);
    if (!is_array($b)) $b = [];
  }
  return $b;
}
function respond($data, $code = 200) {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}
function fail($message, $code = 400) {
  respond(['error' => $message], $code);
}
function ensure_data() {
  if (!is_dir(DATA_DIR)) @mkdir(DATA_DIR, 0755, true);
  if (!file_exists(ROOMS_FILE)) @file_put_contents(ROOMS_FILE, '{}', LOCK_EX);
}
function with_rooms(callable $fn) {
  ensure_data();
  $fp = fopen(ROOMS_FILE, 'c+');
  if (!$fp) fail('Cannot write to data/rooms.json. Check folder permissions (775).', 500);
  flock($fp, LOCK_EX);
  $raw = stream_get_contents($fp);
  $rooms = json_decode($raw ?: '{}', true);
  if (!is_array($rooms)) $rooms = [];
  try {
    $result = $fn($rooms);
  } catch (Throwable $e) {
    flock($fp, LOCK_UN);
    fclose($fp);
    fail($e->getMessage(), 500);
  }
  ftruncate($fp, 0);
  rewind($fp);
  fwrite($fp, json_encode($rooms, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
  fflush($fp);
  flock($fp, LOCK_UN);
  fclose($fp);
  return $result;
}
function ncode($v) {
  return strtoupper(trim(preg_replace('/^#?UNO-/i', '', (string)$v)));
}
function make_code($rooms) {
  do { $c = (string)random_int(1000, 9999); } while (isset($rooms[$c]));
  return $c;
}
function token() { return bin2hex(random_bytes(24)); }
function clean_name($v, $fb = 'Player') {
  $n = trim(substr((string)$v, 0, 24));
  return $n !== '' ? $n : $fb;
}
function clean_avatar($v, $fb = 'aria.svg') {
  global $AVATARS;
  $a = trim(substr((string)$v, 0, 40));
  return in_array($a, $AVATARS, true) ? $a : $fb;
}
function pub_player($p) {
  return [
    'id' => $p['id'],
    'name' => $p['name'],
    'avatar' => $p['avatar'],
    'isHost' => !empty($p['isHost']),
    'isReady' => !empty($p['isReady']),
    'downloaded' => !empty($p['downloaded']),
  ];
}
function pub_room($room) {
  return [
    'code' => $room['code'],
    'mode' => $room['mode'],
    'status' => $room['status'],
    'hostId' => $room['hostId'],
    'maxPlayers' => (int)$room['maxPlayers'],
    'players' => array_map('pub_player', $room['players'] ?? []),
  ];
}
function add_sys(&$room, $message) {
  if (!isset($room['messages'])) $room['messages'] = [];
  $room['messages'][] = [
    'name' => 'TUNOTOGETHER.COM',
    'message' => $message,
    'system' => true,
    'time' => (int)(microtime(true) * 1000),
  ];
  if (count($room['messages']) > 100) {
    $room['messages'] = array_slice($room['messages'], -100);
  }
}
function find_idx(&$room, $tok) {
  foreach ($room['players'] as $i => $p) {
    if (($p['token'] ?? '') === $tok) {
      $room['players'][$i]['lastSeen'] = (int)(microtime(true) * 1000);
      return $i;
    }
  }
  return null;
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$b = body_json();
$lang = lang($b['lang'] ?? $_GET['lang'] ?? 'en');

if ($action === 'health') {
  ensure_data();
  $rooms = json_decode(@file_get_contents(ROOMS_FILE) ?: '{}', true) ?: [];
  $players = 0;
  foreach ($rooms as $r) $players += count($r['players'] ?? []);
  respond(['ok' => true, 'service' => 'play-uno-php', 'rooms' => count($rooms), 'players' => $players]);
}

if ($action === 'create' && $method === 'POST') {
  global $MODES;
  $name = clean_name($b['name'] ?? '');
  $avatar = clean_avatar($b['avatar'] ?? 'aria.svg');
  $mode = in_array($b['mode'] ?? '', $MODES, true) ? $b['mode'] : 'Standart';
  $max = (int)($b['maxPlayers'] ?? 4);
  if ($max < MIN_PLAYERS || $max > MAX_PLAYERS) fail(msg($lang, 'capacityRange', MIN_PLAYERS, MAX_PLAYERS));
  $out = with_rooms(function (&$rooms) use ($name, $avatar, $mode, $max, $lang) {
    $code = make_code($rooms);
    $pid = bin2hex(random_bytes(16));
    $tok = token();
    $player = [
      'id' => $pid, 'token' => $tok, 'name' => $name, 'avatar' => $avatar,
      'isHost' => true, 'isReady' => false, 'downloaded' => false,
      'lastSeen' => (int)(microtime(true) * 1000),
    ];
    $room = [
      'code' => $code, 'mode' => $mode, 'status' => 'waiting',
      'hostId' => $pid, 'maxPlayers' => $max, 'players' => [$player], 'messages' => [],
    ];
    add_sys($room, msg($lang, 'createdRoom', $name));
    $rooms[$code] = $room;
    return ['room' => pub_room($room), 'identity' => ['playerId' => $pid, 'token' => $tok]];
  });
  respond($out);
}

$code = ncode($b['code'] ?? $_GET['code'] ?? '');

if ($action === 'state') {
  if ($code === '') fail(msg($lang, 'roomCodeRequired'));
  $out = with_rooms(function (&$rooms) use ($code, $lang) {
    if (!isset($rooms[$code])) fail(msg($lang, 'roomGone'), 404);
    $room = $rooms[$code];
    return ['room' => pub_room($room), 'messages' => $room['messages'] ?? []];
  });
  respond($out);
}

if ($action === 'join' && $method === 'POST') {
  if ($code === '') fail(msg($lang, 'roomCodeRequired'));
  $out = with_rooms(function (&$rooms) use ($code, $b, $lang) {
    if (!isset($rooms[$code])) fail(msg($lang, 'roomGone'), 404);
    $room = &$rooms[$code];
    if (($room['status'] ?? '') !== 'waiting') fail(msg($lang, 'noNewPlayers'), 409);
    if (count($room['players']) >= (int)$room['maxPlayers']) fail(msg($lang, 'roomFull', (int)$room['maxPlayers']), 409);
    $name = clean_name($b['name'] ?? '');
    $avatar = clean_avatar($b['avatar'] ?? 'atlas.svg', 'atlas.svg');
    $pid = bin2hex(random_bytes(16));
    $tok = token();
    $room['players'][] = [
      'id' => $pid, 'token' => $tok, 'name' => $name, 'avatar' => $avatar,
      'isHost' => false, 'isReady' => false, 'downloaded' => false,
      'lastSeen' => (int)(microtime(true) * 1000),
    ];
    add_sys($room, msg($lang, 'joinedRoom', $name));
    return ['room' => pub_room($room), 'identity' => ['playerId' => $pid, 'token' => $tok]];
  });
  respond($out);
}

$token = $b['token'] ?? '';
$ops = ['ready','mode','profile','downloaded','chat','chat-image','kick','leave','start'];
if (in_array($action, $ops, true) && $method === 'POST') {
  if ($code === '') fail(msg($lang, 'roomCodeRequired'));
  if ($token === '') fail(msg($lang, 'invalidIdentity'), 401);
  $out = with_rooms(function (&$rooms) use ($code, $action, $b, $lang, $token) {
    global $MODES;
    if (!isset($rooms[$code])) fail(msg($lang, 'roomGone'), 404);
    $room = &$rooms[$code];
    $idx = find_idx($room, $token);
    if ($idx === null) fail(msg($lang, 'invalidIdentity'), 401);
    $player = &$room['players'][$idx];

    if ($action === 'ready') {
      $player['isReady'] = empty($player['isReady']);
      return ['room' => pub_room($room)];
    }
    if ($action === 'mode') {
      if (empty($player['isHost'])) fail(msg($lang, 'onlyHost'), 403);
      if (!in_array($b['mode'] ?? '', $MODES, true)) fail(msg($lang, 'invalidMode'));
      $room['mode'] = $b['mode'];
      add_sys($room, msg($lang, 'modeSet', $room['mode']));
      return ['room' => pub_room($room)];
    }
    if ($action === 'profile') {
      $player['name'] = clean_name($b['name'] ?? $player['name']);
      $player['avatar'] = clean_avatar($b['avatar'] ?? $player['avatar']);
      return ['room' => pub_room($room)];
    }
    if ($action === 'downloaded') {
      $player['downloaded'] = true;
      return ['room' => pub_room($room)];
    }
    if ($action === 'chat') {
      $message = trim(substr((string)($b['message'] ?? ''), 0, 500));
      if ($message === '') fail(msg($lang, 'emptyMessage'));
      if (!isset($room['messages'])) $room['messages'] = [];
      $chat = ['name' => $player['name'], 'message' => $message, 'time' => (int)(microtime(true) * 1000)];
      $room['messages'][] = $chat;
      if (count($room['messages']) > 100) $room['messages'] = array_slice($room['messages'], -100);
      return ['ok' => true, 'message' => $chat];
    }
    if ($action === 'chat-image') {
      $imageData = trim((string)($b['imageData'] ?? ''));
      if (strpos($imageData, 'data:image/') !== 0) fail(msg($lang, 'emptyMessage'));
      if (!isset($room['messages'])) $room['messages'] = [];
      $chat = ['name' => $player['name'], 'image' => $imageData, 'time' => (int)(microtime(true) * 1000)];
      $room['messages'][] = $chat;
      if (count($room['messages']) > 100) $room['messages'] = array_slice($room['messages'], -100);
      return ['ok' => true, 'message' => $chat];
    }
    if ($action === 'kick') {
      if (empty($player['isHost'])) fail(msg($lang, 'onlyHost'), 403);
      $targetId = $b['playerId'] ?? '';
      $found = false; $targetName = ''; $new = [];
      foreach ($room['players'] as $p) {
        if ($p['id'] === $targetId && $p['id'] !== $player['id']) { $found = true; $targetName = $p['name']; continue; }
        $new[] = $p;
      }
      if (!$found) fail(msg($lang, 'playerNotFound'));
      $room['players'] = $new;
      add_sys($room, msg($lang, 'kickedRoom', $targetName));
      return ['room' => pub_room($room)];
    }
    if ($action === 'leave') {
      $name = $player['name'];
      $wasHost = !empty($player['isHost']);
      $room['players'] = array_values(array_filter($room['players'], fn($p) => $p['id'] !== $player['id']));
      if (!$room['players']) { unset($rooms[$code]); return ['ok' => true]; }
      if ($wasHost) {
        $room['players'][0]['isHost'] = true;
        $room['hostId'] = $room['players'][0]['id'];
      }
      add_sys($room, msg($lang, 'leftRoom', $name));
      return ['ok' => true];
    }
    if ($action === 'start') {
      if (empty($player['isHost'])) fail(msg($lang, 'onlyHost'), 403);
      $missing = array_filter($room['players'], fn($p) => empty($p['downloaded']));
      if ($missing) {
        return [
          'blocked' => true,
          'title' => msg($lang, 'startTitle'),
          'message' => msg($lang, 'startHost'),
        ];
      }
      $room['status'] = 'started';
      add_sys($room, msg($lang, 'allDownloaded'));
      return ['ok' => true, 'room' => pub_room($room), 'message' => msg($lang, 'allDownloaded')];
    }
    fail('Unknown action', 404);
  });
  respond($out);
}

if ($method === 'GET') {
  ensure_data();
  $rooms = json_decode(@file_get_contents(ROOMS_FILE) ?: '{}', true) ?: [];
  $players = 0;
  foreach ($rooms as $r) $players += count($r['players'] ?? []);
  respond(['ok' => true, 'service' => 'play-uno-php', 'rooms' => count($rooms), 'players' => $players]);
}

fail('Invalid request. Action parameter is required.', 400);
