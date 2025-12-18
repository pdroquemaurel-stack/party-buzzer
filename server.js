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

  // Normalisation/évitement traversal
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
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Etat en mémoire: rooms -> { players: Map<socketId, {name}>, scores: Map<name, number>, buzzOpen, winner }
const rooms = new Map();

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { players: new Map(), scores: new Map(), buzzOpen: false, winner: null };
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

  // Construire la liste fusionnant présences et scores
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
  let roomCode = null;  // code de la salle
  let playerName = null;

  // TV crée (ou rejoint) la salle
  socket.on('tv:create_room', (code) => {
    roomCode = String(code || '').toUpperCase();
    role = 'tv';
    getRoom(roomCode); // crée si n'existe pas
    socket.join(roomCode);
    socket.emit('room:ready', { code: roomCode });
    broadcastPlayers(roomCode);
  });

  // Joueur rejoint
  socket.on('player:join', (payload, ack) => {
    const code = String(payload && payload.room || '').toUpperCase();
    const desired = cleanName(payload && payload.name);
    if (!code || !desired) {
      if (ack) ack({ ok: false, error: 'missing' });
      return;
    }
    const r = getRoom(code);
    const finalName = uniqueName(code, desired);
    playerName = finalName;
    roomCode = code;

    r.players.set(socket.id, { name: finalName });
    if (!r.scores.has(finalName)) r.scores.set(finalName, 0);

    socket.join(code);
    if (ack) ack({ ok: true, name: finalName });
    broadcastPlayers(code);
  });

  // Admin ouvre un tour
  socket.on('buzz:open', () => {
    if (!roomCode) return;
    const r = getRoom(roomCode);
    r.buzzOpen = true;
    r.winner = null;
    io.to(roomCode).emit('round:open');
  });

  // Joueur buzz
  socket.on('buzz:press', (ack) => {
    if (!roomCode) { if (ack) ack({ ok: false }); return; }
    const r = getRoom(roomCode);
    if (!r.buzzOpen || r.winner) { if (ack) ack({ ok: false }); return; }
    const name = playerName || 'Joueur';
    r.buzzOpen = false;
    r.winner = name;

    const newScore = (r.scores.get(name) || 0) + 1;
    r.scores.set(name, newScore);

    io.to(roomCode).emit('round:winner', { name, score: newScore });
    broadcastPlayers(roomCode);
    if (ack) ack({ ok: true, winner: name });
  });

  // Admin réinitialise le tour
  socket.on('round:reset', () => {
    if (!roomCode) return;
    const r = getRoom(roomCode);
    r.buzzOpen = false;
    r.winner = null;
    io.to(roomCode).emit('round:reset');
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
