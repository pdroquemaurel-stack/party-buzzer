// server/games/guess.js
module.exports = {
  id: 'guess',
  name: 'Devine le nombre',

  init(room) {
    room.game = {
      open: false,
      question: '',
      correct: 0,
      min: 0,
      max: 100,
      answers: new Map() // name -> number
    };
  },

  adminStart(io, room, code, { question, correct, min, max, seconds }) {
    const q = String(question || '').trim().slice(0, 200);

    // Bornes
    let lo = Number.isFinite(+min) ? parseInt(min, 10) : 0;
    let hi = Number.isFinite(+max) ? parseInt(max, 10) : 100;
    if (isNaN(lo)) lo = 0;
    if (isNaN(hi)) hi = 100;
    if (lo === hi) hi = lo + 1;
    if (lo > hi) { const t = lo; lo = hi; hi = t; }

    // Réponse correcte
    let corr = Number.isFinite(+correct) ? parseInt(correct, 10) : lo;
    if (isNaN(corr)) corr = lo;
    if (corr < lo) corr = lo;
    if (corr > hi) corr = hi;

    const sec = Math.max(1, Math.min(60, parseInt(seconds, 10) || 5));

    room.game = { open: true, question: q, correct: corr, min: lo, max: hi, answers: new Map() };

    // Place tout le monde en mode guess + envoie la question
    io.to(code).emit('mode:changed', { mode: 'guess' });
    io.to(code).emit('guess:start', {
      question: q,
      min: lo,
      max: hi,
      seconds: sec
    });
  },

  playerAnswer(io, room, code, playerName, value, ack) {
    const g = room.game || {};
    if (!g.open) { ack && ack({ ok: false }); return; }
    const v = parseInt(value, 10);
    if (!Number.isFinite(v)) { ack && ack({ ok: false }); return; }
    if (!g.answers.has(playerName)) {
      // Première réponse conservée
      g.answers.set(playerName, Math.max(g.min, Math.min(g.max, v)));
    }
    ack && ack({ ok: true });
  },

  adminClose(io, room, code, broadcastPlayers) {
    const g = room.game || {};
    if (!g.open) return;
    g.open = false;

    // Trouver les plus proches (ex aequo possibles)
    let bestDiff = null;
    const winners = [];
    g.answers.forEach((val, name) => {
      const d = Math.abs(val - g.correct);
      if (bestDiff === null || d < bestDiff) {
        bestDiff = d;
        winners.length = 0;
        winners.push(name);
      } else if (d === bestDiff) {
        winners.push(name);
      }
    });

    // +1 pour les gagnants s'il y a au moins une réponse
    if (bestDiff !== null) {
      winners.forEach(name => {
        room.scores.set(name, (room.scores.get(name) || 0) + 1);
      });
    }

    io.to(code).emit('guess:result', {
      correct: g.correct,
      winners,
      bestDiff: bestDiff === null ? null : bestDiff
    });

    broadcastPlayers(code);
  }
};
