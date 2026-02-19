// Serveur HTTP + fichiers statiques + Socket.IO (sans Express)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Server } = require('socket.io');

// Jeux (modules)
const buzzerGame = require('./server/games/buzzer');
const quizGame = require('./server/games/quiz');
const guessGame = require('./server/games/guess');
const freeGame = require('./server/games/free');
const registerScoreHandlers = require('./server/socket/score-handlers');

const games = {
  buzzer: buzzerGame,
  quiz: quizGame,
  guess: guessGame,
  free: freeGame
};

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const ROOM_TTL_MS = Math.max(60_000, parseInt(process.env.ROOM_TTL_MS || '21600000', 10)); // 6h default
const CLEANUP_INTERVAL_MS = Math.max(30_000, parseInt(process.env.ROOM_CLEANUP_INTERVAL_MS || '600000', 10));

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);
  if (allowedOrigins.length === 0) {
    return cb(null, /^(https?:\/\/localhost(?::\d+)?|https?:\/\/127\.0\.0\.1(?::\d+)?)$/i.test(origin));
  }
  cb(null, allowedOrigins.includes(origin));
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8'
  };
  return types[ext] || 'application/octet-stream';
}

function isCacheableContentType(type) {
  return /^text\//.test(type) || /javascript|json|svg/.test(type);
}

function etagFor(stat) {
  return `W/"${stat.size}-${Number(stat.mtimeMs)}"`;
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://api.qrserver.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'"
  };
}

function wantsGzip(req) {
  return String(req.headers['accept-encoding'] || '').includes('gzip');
}

// Statique

function serveConfigJs(res) {
  const base = JSON.stringify(String(process.env.APP_BASE_URL || ''));
  const body = `window.__APP_BASE_URL__ = ${base} || window.location.origin;`;
  const headers = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders()
  };
  res.writeHead(200, headers);
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/config.js') { serveConfigJs(res); return; }
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/tv') urlPath = '/tv.html';
  if (urlPath === '/join') urlPath = '/join.html';

  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(publicDir, safePath);

  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders() });
      res.end('404 Not Found');
      return;
    }

    const contentType = contentTypeFor(filePath);
    const etag = etagFor(stat);
    const headers = {
      'Content-Type': contentType,
      'ETag': etag,
      ...securityHeaders()
    };

    if (isCacheableContentType(contentType)) {
      headers['Cache-Control'] = 'public, max-age=60';
    } else {
      headers['Cache-Control'] = 'public, max-age=86400';
    }

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    fs.readFile(filePath, function (err2, data) {
      if (err2) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders() });
        res.end('500 Internal Server Error');
        return;
      }

      if (isCacheableContentType(contentType) && wantsGzip(req)) {
        zlib.gzip(data, (zipErr, zipped) => {
          if (zipErr) {
            res.writeHead(200, headers);
            res.end(data);
            return;
          }
          res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
          res.end(zipped);
        });
        return;
      }

      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

const httpServer = http.createServer(serveStatic);
const io = new Server(httpServer, { cors: { origin: corsOrigin } });

// rooms -> { players: Map<socketId,{name}>, scores: Map<name,number>, gameId, game, locked: boolean }
const rooms = new Map();

function touchRoom(room) {
  room.lastActivityAt = Date.now();
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function validRoomCode(code) {
  return /^[A-Z0-9]{4,8}$/.test(code);
}

function asObject(v) {
  return (v && typeof v === 'object') ? v : {};
}

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = {
      players: new Map(),
      scores: new Map(),
      gameId: 'buzzer',
      game: {},
      locked: false,
      adminToken: randomToken(),
      lastActivityAt: Date.now()
    };
    games['buzzer'].init(r);
    rooms.set(code, r);
  }
  return r;
}

function broadcastRoomState(code) {
  const r = rooms.get(code);
  if (!r) return;
  touchRoom(r);
  io.to(code).emit('room:state', { locked: !!r.locked });
}

function cleanName(name) {
  const n = String(name || '').replace(/[^a-zA-Z0-9 _.-]/g, '').trim().slice(0, 16);
  return n || 'Joueur';
}

function uniqueName(code, desired) {
  const r = getRoom(code);
  let base = desired;
  let name = base;
  let i = 2;
  const taken = new Set(Array.from(r.players.values()).map(p => p.name));
  while (taken.has(name)) name = base + '#' + (i++);
  return name;
}

function broadcastPlayers(code) {
  const r = rooms.get(code);
  if (!r) return;
  touchRoom(r);
  const listMap = new Map();
  r.scores.forEach((score, name) => listMap.set(name, { name, score, connected: false }));
  r.players.forEach(p => {
    const item = listMap.get(p.name) || { name: p.name, score: 0, connected: false };
    item.connected = true;
    listMap.set(p.name, item);
  });
  const list = Array.from(listMap.values()).sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  io.to(code).emit('room:players', list);
}

function ensureGame(code, gameId) {
  const r = getRoom(code);
  touchRoom(r);
  const id = games[gameId] ? gameId : 'buzzer';
  r.gameId = id;
  games[id].init(r);
  io.to(code).emit('mode:changed', { mode: id });
  io.to(code).emit('round:reset');
  return r;
}

const socketRateState = new Map();
function rateLimit(socket, key, limit, windowMs) {
  const now = Date.now();
  let state = socketRateState.get(socket.id);
  if (!state) {
    state = new Map();
    socketRateState.set(socket.id, state);
  }
  const item = state.get(key) || { count: 0, start: now };
  if (now - item.start > windowMs) {
    item.count = 0;
    item.start = now;
  }
  item.count += 1;
  state.set(key, item);
  return item.count <= limit;
}

function requireRate(socket, key, limit, windowMs, ack) {
  const ok = rateLimit(socket, key, limit, windowMs);
  if (!ok && ack) ack({ ok: false, error: 'rate_limited' });
  return ok;
}

io.on('connection', (socket) => {
  let role = null;
  let roomCode = null;
  let playerName = null;

  socket.on('tv:create_room', (code) => {
    const payload = asObject(code);
    const requested = String(payload.code || code || '').toUpperCase();
    const providedToken = String(payload.adminToken || '');
    if (!validRoomCode(requested)) {
      socket.emit('room:error', { error: 'invalid_room_code' });
      return;
    }
    roomCode = requested;
    const r = getRoom(roomCode);
    if (providedToken && providedToken === r.adminToken) {
      role = 'tv';
    } else if (!providedToken) {
      role = 'tv';
    } else {
      socket.emit('room:error', { error: 'forbidden' });
      return;
    }
    touchRoom(r);
    socket.join(roomCode);
    socket.emit('room:ready', { code: roomCode, adminToken: r.adminToken });
    socket.emit('mode:changed', { mode: r.gameId });
    broadcastPlayers(roomCode);
    broadcastRoomState(roomCode);
  });

  socket.on('player:join', (payload, ack) => {
    if (!requireRate(socket, 'player:join', 10, 10_000, ack)) return;
    const code = String(payload && payload.room || '').toUpperCase();
    const desired = cleanName(payload && payload.name);
    if (!validRoomCode(code) || !desired) { ack && ack({ ok: false, error: 'missing' }); return; }
    const r = getRoom(code);
    touchRoom(r);
    if (r.locked) { ack && ack({ ok: false, error: 'locked' }); return; }
    const finalName = uniqueName(code, desired);
    playerName = finalName;
    roomCode = code;
    r.players.set(socket.id, { name: finalName });
    if (!r.scores.has(finalName)) r.scores.set(finalName, 0);
    socket.join(code);
    ack && ack({ ok: true, name: finalName });
    socket.emit('mode:changed', { mode: r.gameId });
    broadcastPlayers(code);
  });

  // Verrouillage manuel (optionnel)
  socket.on('room:lock', (locked) => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    r.locked = !!locked;
    broadcastRoomState(roomCode);
  });

  // Changement de jeu (TV)
  socket.on('mode:set', (payload = {}) => {
    const { mode } = asObject(payload);
    if (role !== 'tv' || !roomCode) return;
    ensureGame(roomCode, mode);
  });

  // Countdown (rebroadcast)
  socket.on('countdown:start', (seconds = 3) => {
    if (role !== 'tv' || !roomCode) return;
    const s = Math.max(1, Math.min(60, parseInt(seconds, 10) || 3));
    io.to(roomCode).emit('countdown:start', { seconds: s });
  });

  // Reset tour/question générique (TV)
  socket.on('round:reset', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    games[r.gameId].init(r);
    r.locked = false;
    io.to(roomCode).emit('round:reset');
    broadcastRoomState(roomCode);
  });

  registerScoreHandlers({
    socket,
    io,
    getCtx: () => ({ role, roomCode }),
    getRoom,
    touchRoom,
    broadcastPlayers
  });



  // BUZZER
  socket.on('buzz:open', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'buzzer') return;
    r.locked = true;
    broadcastRoomState(roomCode);
    games.buzzer.adminOpen(io, r, roomCode);
  });

  socket.on('buzz:press', (ack) => {
    if (!requireRate(socket, 'buzz:press', 20, 3_000, ack)) return;
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (r.gameId !== 'buzzer') { ack && ack({ ok: false }); return; }
    games.buzzer.playerPress(io, r, roomCode, (playerName || 'Joueur'), ack, broadcastPlayers);
    // Déverrouillage à la fin d'un buzz (gagnant trouvé)
    r.locked = false;
    broadcastRoomState(roomCode);
  });

  // QUIZ
  socket.on('quiz:start', (payload = {}) => {
    const { question, correct, seconds } = asObject(payload);
    if (role !== 'tv' || !roomCode) return;
    let r = getRoom(roomCode);
    if (r.gameId !== 'quiz') r = ensureGame(roomCode, 'quiz');
    r.locked = true;
    broadcastRoomState(roomCode);
    games.quiz.adminStart(io, r, roomCode, { question, correct, seconds });
  });

  socket.on('quiz:answer', (payload = {}, ack) => {
    const { answer } = asObject(payload);
    if (!requireRate(socket, 'quiz:answer', 20, 3_000, ack)) return;
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (r.gameId !== 'quiz') { ack && ack({ ok: false }); return; }
    games.quiz.playerAnswer(io, r, roomCode, (playerName || 'Joueur'), !!answer, ack);
  });

  socket.on('quiz:close', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'quiz') return;
    games.quiz.adminClose(io, r, roomCode, broadcastPlayers);
    r.locked = false;
    broadcastRoomState(roomCode);
  });

  // GUESS (Devine le nombre)
  socket.on('guess:start', (payload = {}) => {
    const { question, correct, min, max, seconds } = asObject(payload);
    if (role !== 'tv' || !roomCode) return;
    let r = getRoom(roomCode);
    if (r.gameId !== 'guess') r = ensureGame(roomCode, 'guess');
    r.locked = true;
    broadcastRoomState(roomCode);
    games.guess.adminStart(io, r, roomCode, { question, correct, min, max, seconds });
  });

  socket.on('guess:answer', (payload = {}, ack) => {
    const { value } = asObject(payload);
    if (!requireRate(socket, 'guess:answer', 20, 3_000, ack)) return;
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (r.gameId !== 'guess') { ack && ack({ ok: false }); return; }
    games.guess.playerAnswer(io, r, roomCode, (playerName || 'Joueur'), value, ack);
  });

  socket.on('guess:close', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'guess') return;
    games.guess.adminClose(io, r, roomCode, broadcastPlayers);
    r.locked = false;
    broadcastRoomState(roomCode);
  });

  // FREE (Réponse Libre) - Single
	socket.on('free:start', (payload = {}) => {
    const { question, seconds, answer } = asObject(payload);
    if (role !== 'tv' || !roomCode) return; let r = getRoom(roomCode); if (r.gameId !== 'free') r = ensureGame(roomCode, 'free'); r.locked = true; broadcastRoomState(roomCode); 
	// IMPORTANT: transmettre answer 
	games.free.adminStart(io, r, roomCode, { question, seconds, answer }); });

  socket.on('free:answer', (payload = {}, ack) => {
    const { text } = asObject(payload);
    if (!requireRate(socket, 'free:answer', 20, 3_000, ack)) return;
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (r.gameId !== 'free') { ack && ack({ ok: false }); return; }
    games.free.playerAnswer(io, r, roomCode, (playerName || 'Joueur'), text, ack);
  });

  socket.on('free:toggle_validate', (payload = {}) => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'free') return;
    const name = String(payload.name || '').slice(0, 32);
    if (!name) return;
    games.free.adminToggleValidate(io, r, roomCode, name, broadcastPlayers);
    touchRoom(r);
  });

  socket.on('free:close', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'free') return;
    games.free.adminClose(io, r, roomCode);
    r.locked = false;
    broadcastRoomState(roomCode);
  });

  // FREE - Series
	socket.on('free:series:start', (payload = {}) => {
    const { items } = asObject(payload);
    if (role !== 'tv' || !roomCode) return;
    let r = getRoom(roomCode);
    if (r.gameId !== 'free') r = ensureGame(roomCode, 'free');
    r.locked = true;
    broadcastRoomState(roomCode);
    games.free.adminSeriesStart(io, r, roomCode, { items });
    // démarrer immédiatement
    games.free.adminSeriesNextQuestion(io, r, roomCode);
  });

  socket.on('free:series:next_question', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'free') return;
    games.free.adminSeriesNextQuestion(io, r, roomCode);
  });

  socket.on('free:series:finish', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'free') return;
    games.free.adminSeriesFinish(io, r, roomCode);
    // locked restera true jusqu'à fin de la review manuelle -> on déverrouille quand l'animateur quitte l'overlay si besoin
  });

  socket.on('free:series:goto_index', (payload = {}) => {
    const { index } = asObject(payload);
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'free') return;
    games.free.adminSeriesGotoIndex(io, r, roomCode, index);
  });

  socket.on('disconnect', () => {
    socketRateState.delete(socket.id);
    if (!roomCode) return;
    const r = rooms.get(roomCode);
    if (r) {
      r.players.delete(socket.id);
      touchRoom(r);
      broadcastPlayers(roomCode);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    if (room.players.size > 0) return;
    if (now - (room.lastActivityAt || 0) > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  });
}, CLEANUP_INTERVAL_MS).unref();

httpServer.listen(PORT, '0.0.0.0', function () {
  console.log('Serveur avec Socket.IO demarre sur port ' + PORT);
});
