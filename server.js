// Serveur HTTP + fichiers statiques + Socket.IO (sans Express)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

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

// Etat en mémoire par salle
// rooms -> {
//   players: Map<socketId, {name}>,
//   scores: Map<name, number>,
//   mode: 'buzzer' | 'quiz',
//   buzzOpen: boolean,
//   winner: string|null,
//   quiz: { open: boolean, question: string, correct: boolean|null, answers: Map<name, boolean> }
// }
const rooms = new Map();

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = {
      players: new Map(),
      scores: new Map(),
      mode: 'buzzer',
      buzzOpen: false,
      winner: null,
      quiz: { open: false, question: '', correct: null, answers: new Map() }
    };
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

io.on('connection', (socket) => {
  let role = null;      // 'tv' ou 'player'
  let roomCode = null;
  let playerName = null;

  // TV crée (ou rejoint) la salle
  socket.on('tv:create_room', (code) => {
    roomCode = String(code || '').toUpperCase();
    role = 'tv';
    getRoom(roomCode);
    socket.join(roomCode);
    socket.emit('room:ready', { code: roomCode });
    const r = getRoom(roomCode);
    socket.emit('mode:changed', { mode: r.mode });
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

    // Envoyer le mode actuel au joueur
    socket.emit('mode:changed', { mode: r.mode });

    broadcastPlayers(code);
  });

  // Changer de mode (admin only)
  socket.on('mode:set', ({ mode }) => {
    if (role !== 'tv' || !roomCode) return;
    const m = mode === 'quiz' ? 'quiz' : 'buzzer';
    const r = getRoom(roomCode);
    r.mode = m;
    // Réinitialiser états de round
    r.buzzOpen = false;
    r.winner = null;
    r.quiz = { open: false, question: '', correct: null, answers: new Map() };
    io.to(roomCode).emit('mode:changed', { mode: m });
    io.to(roomCode).emit('round:reset');
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
    r.buzzOpen = true;
    r.winner = null;
    io.to(roomCode).emit('round:open');
  });

  // BUZZER — appuyer
  socket.on('buzz:press', (ack) => {
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (!r.buzzOpen || r.winner) { ack && ack({ ok: false }); return; }
    const name = playerName || 'Joueur';
    r.buzzOpen = false;
    r.winner = name;

    const newScore = (r.scores.get(name) || 0) + 1;
    r.scores.set(name, newScore);

    io.to(roomCode).emit('round:winner', { name, score: newScore });
    broadcastPlayers(roomCode);
    ack && ack({ ok: true, winner: name });
  });

  // BUZZER — reset (admin only)
  socket.on('round:reset', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    r.buzzOpen = false;
    r.winner = null;
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

  // QUIZ — démarrer une question (admin only)
  socket.on('quiz:start', ({ question, correct, seconds }) => {
    if (role !== 'tv' || !roomCode) return;
    const q = String(question || '').trim().slice(0, 200);
    const c = !!correct;
    const r = getRoom(roomCode);
    r.mode = 'quiz';
    r.quiz = { open: true, question: q, correct: c, answers: new Map() };
    io.to(roomCode).emit('mode:changed', { mode: 'quiz' });
    io.to(roomCode).emit('quiz:question', { question: q, seconds: Math.max(1, Math.min(30, parseInt(seconds, 10) || 5)) });
  });

  // QUIZ — réponse d'un joueur
  socket.on('quiz:answer', ({ answer }, ack) => {
    if (!roomCode) { ack && ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (!r.quiz.open) { ack && ack({ ok: false }); return; }
    const name = playerName || 'Joueur';
    if (!r.quiz.answers.has(name)) {
      r.quiz.answers.set(name, !!answer); // première réponse seulement
    }
    ack && ack({ ok: true });
  });

  // QUIZ — clôturer et corriger (admin only)
  socket.on('quiz:close', () => {
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    if (!r.quiz.open) return;
    r.quiz.open = false;

    let countTrue = 0, countFalse = 0, winners = [];
    r.quiz.answers.forEach((ans, name) => {
      if (ans) countTrue++; else countFalse++;
      if (ans === r.quiz.correct) winners.push(name);
    });

    // +1 aux gagnants
    winners.forEach(name => {
      r.scores.set(name, (r.scores.get(name) || 0) + 1);
    });

    io.to(roomCode).emit('quiz:result', {
      correct: r.quiz.correct,
      countTrue,
      countFalse,
      total: countTrue + countFalse
    });
    broadcastPlayers(roomCode);
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
