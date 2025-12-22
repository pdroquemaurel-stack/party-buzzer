// Serveur HTTP + fichiers statiques + Socket.IO (sans Express)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// Jeux (modules)
const buzzerGame = require('./server/games/buzzer');
const quizGame = require('./server/games/quiz');
const guessGame = require('./server/games/guess');

const games = {
  buzzer: buzzerGame,
  quiz: quizGame,
  guess: guessGame
};

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

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

// Statique
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
const io = new Server(httpServer, { cors: { origin: '*' } });

// rooms -> { players: Map<socketId,{name}>, scores: Map<name,number>, gameId, game }
const rooms = new Map();

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { players: new Map(), scores: new Map(), gameId: 'buzzer', game: {} };
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
  while (taken.has(name)) name = base + '#' + (i++);
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
  io.to(code).emit('mode:changed', { mode: id });
  io.to(code).emit('round:reset');
  return r;
}

io.on('connection', (socket) => {
  let role = null;
  let roomCode = null;
  let playerName = null;

  socket.on('tv:create_room', (code) => {
    roomCode = String(code || '').toUpperCase();
    role = 'tv';
    const r = getRoom(roomCode);
    socket.join(roomCode);
    socket.emit('room:ready', { code: roomCode });
    socket.emit('mode:changed', { mode: r.gameId });
    broadcastPlayers(roomCode);
  });

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

  // Changement de jeu (TV)
  socket.on('mode:set', ({ mode }) => {
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
    io.to(roomCode).emit('round:reset');
  });

  // Reset scores (TV)
  socket.on('scores:reset', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    const newScores = new Map();
    r.players.forEach(p => newScores.set(p.name, 0));
    r.scores = newScores;
    io.to(roomCode).emit('scores:reset');
    broadcastPlayers(roomCode);
  });

  // BUZZER
  socket.on('buzz:open', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (r.gameId !== 'buzzer') return;
    games.buzzer.adminOpen(io, r, roomCode);
  });

  socket.on('buzz:press', (ack) => {
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (r.gameId !== 'buzzer') { ack && ack({ ok: false }); return; }
    games.buzzer.playerPress(io, r, roomCode, (playerName || 'Joueur'), ack, broadcastPlayers);
  });

  // QUIZ
  socket.on('quiz:start', ({ question, correct, seconds }) => {
    if (role !== 'tv' || !roomCode) return;
    let r = getRoom(roomCode);
    if (r.gameId !== 'quiz') r = ensureGame(roomCode, 'quiz');
    games.quiz.adminStart(io, r, roomCode, { question, correct, seconds });
  });

  socket.on('quiz:answer', ({ answer }, ack) => {
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
  });

  // GUESS (Devine le nombre)
  socket.on('guess:start', ({ question, correct, min, max, seconds }) => {
    if (role !== 'tv' || !roomCode) return;
    let r = getRoom(roomCode);
    if (r.gameId !== 'guess') r = ensureGame(roomCode, 'guess');
    games.guess.adminStart(io, r, roomCode, { question, correct, min, max, seconds });
  });

  socket.on('guess:answer', ({ value }, ack) => {
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
  });

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
