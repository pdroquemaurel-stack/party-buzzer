// Serveur HTTP + fichiers statiques + Socket.IO (sans Express)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// Jeux (modules)
const buzzerGame = require('./server/games/buzzer');
const quizGame = require('./server/games/quizz');

const games = {
  buzzer: buzzerGame,
  quiz: quizGame
};

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

// Détermine le Content-Type selon l'extension
function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  return types[ext] || 'application/octet-stream';
}

// Sert les fichiers statiques depuis /public
function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];

  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/tv') urlPath = '/tv.html';
  if (urlPath === '/join') urlPath = '/join.html';

  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(publicDir, safePath);

  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    fs.readFile(filePath, function (err2, data) {
      if (err2) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
      res.end(data);
    });
  });
}

const httpServer = http.createServer(serveStatic);

// Socket.IO
const io = new Server(httpServer, { cors: { origin: '*' } });

// Etat par salle:
// rooms -> { players: Map<socketId,{name}>, scores: Map<name,number>, gameId: 'buzzer'|'quiz', game: any }
const rooms = new Map();

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = {
      players: new Map(),
      scores: new Map(),
      gameId: 'buzzer',
      game: {}
    };
    // init jeu par défaut
    games['buzzer'].init(r);
    rooms.set(code, r);
  }
  return r;
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
  while (taken.has(name)) {
    name = base + '#' + (i++);
  }
  return name;
}

function broadcastPlayers(code) {
  const r = rooms.get(code);
  if (!r) return;

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
  const id = games[gameId] ? gameId : 'buzzer';
  r.gameId = id;
  games[id].init(r);
  // informer les clients et remettre l'UI à zéro
  io.to(code).emit('mode:changed', { mode: id });
  io.to(code).emit('round:reset');
  return r;
}

io.on('connection', (socket) => {
  let role = null;      // 'tv' ou 'player'
  let roomCode = null;
  let playerName = null;

  // TV crée (ou rejoint) la salle
  socket.on('tv:create_room', (code) => {
    roomCode = String(code || '').toUpperCase();
    role = 'tv';
    const r = getRoom(roomCode);
    socket.join(roomCode);
    socket.emit('room:ready', { code: roomCode });
    socket.emit('mode:changed', { mode: r.gameId });
    broadcastPlayers(roomCode);
  });

  // Joueur rejoint
  socket.on('player:join', (payload, ack) => {
    const code = String(payload && payload.room || '').toUpperCase();
    const desired = cleanName(payload && payload.name);
    if (!code || !desired) { ack && ack({ ok: false, error: 'missing' }); return; }

    const r = getRoom(code);
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

  // Changer de jeu (admin only)
  socket.on('mode:set', ({ mode }) => {
    if (role !== 'tv' || !roomCode) return;
    ensureGame(roomCode, mode);
  });

  // Compte à rebours (rebroadcast)
  socket.on('countdown:start', (seconds = 3) => {
    if (role !== 'tv' || !roomCode) return;
    const s = Math.max(1, Math.min(10, parseInt(seconds, 10) || 3));
    io.to(roomCode).emit('countdown:start', { seconds: s });
  });

  // BUZZER — ouvrir un tour (admin only)
  socket.on('buzz:open', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'buzzer') return; // on ignore si pas en mode buzzer
    games.buzzer.adminOpen(io, r, roomCode);
  });

  // BUZZER — reset tour (admin only)
  socket.on('round:reset', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    // réinit l'état du jeu courant et informer les clients
    games[r.gameId].init(r);
    io.to(roomCode).emit('round:reset');
  });

  // Scores reset (admin only)
  socket.on('scores:reset', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    const newScores = new Map();
    r.players.forEach(p => newScores.set(p.name, 0));
    r.scores = newScores;
    io.to(roomCode).emit('scores:reset');
    broadcastPlayers(roomCode);
  });

  // BUZZER — appuyer
  socket.on('buzz:press', (ack) => {
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (r.gameId !== 'buzzer') { ack && ack({ ok: false }); return; }
    games.buzzer.playerPress(io, r, roomCode, (playerName || 'Joueur'), ack, broadcastPlayers);
  });

  // QUIZ — démarrer une question (admin only)
  socket.on('quiz:start', ({ question, correct, seconds }) => {
    if (role !== 'tv' || !roomCode) return;
    let r = getRoom(roomCode);
    if (r.gameId !== 'quiz') {
      r = ensureGame(roomCode, 'quiz'); // bascule et reset UI
    }
    games.quiz.adminStart(io, r, roomCode, { question, correct, seconds });
  });

  // QUIZ — réponse d'un joueur
  socket.on('quiz:answer', ({ answer }, ack) => {
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (r.gameId !== 'quiz') { ack && ack({ ok: false }); return; }
    games.quiz.playerAnswer(io, r, roomCode, (playerName || 'Joueur'), !!answer, ack);
  });

  // QUIZ — clore et corriger (admin only)
  socket.on('quiz:close', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'quiz') return;
    games.quiz.adminClose(io, r, roomCode, broadcastPlayers);
  });

  // Déconnexion
  socket.on('disconnect', () => {
    if (!roomCode) return;
    const r = rooms.get(roomCode);
    if (r) {
      r.players.delete(socket.id);
      broadcastPlayers(roomCode);
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', function () {
  console.log('Serveur avec Socket.IO demarre sur port ' + PORT);
});
