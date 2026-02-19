function clampInt(v, min, max, fallback = 0) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

module.exports = function registerScoreHandlers({ socket, getCtx, getRoom, broadcastPlayers, touchRoom, io }) {
  socket.on('scores:reset', () => {
    const { role, roomCode } = getCtx();
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    const newScores = new Map();
    r.players.forEach((p) => newScores.set(p.name, 0));
    r.scores = newScores;
    touchRoom(r);
    io.to(roomCode).emit('scores:reset');
    broadcastPlayers(roomCode);
  });

  socket.on('scores:adjust', (payload = {}) => {
    const { role, roomCode } = getCtx();
    if (role !== 'tv' || !roomCode) return;
    const r = getRoom(roomCode);
    const name = String(payload.name || '').slice(0, 32);
    const delta = clampInt(payload.delta, -5, 5, 0);
    if (!name || delta === 0) return;
    const prev = r.scores.get(name) || 0;
    r.scores.set(name, Math.max(0, prev + delta));
    touchRoom(r);
    broadcastPlayers(roomCode);
  });
};
