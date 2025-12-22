// server/games/free.js
// Jeu "Réponse Libre": l'animateur valide manuellement les réponses après affichage.

module.exports = {
  id: 'free',
  name: 'Réponse Libre',

  init(room) {
    room.game = {
      open: false,
      question: '',
      seconds: 30,
      answers: new Map(),      // name -> { text, validated: false }
      resultsShown: false
    };
  },

  adminStart(io, room, code, { question, seconds }) {
    const q = String(question || '').trim().slice(0, 300);
    const sec = Math.max(3, Math.min(120, parseInt(seconds, 10) || 30));
    room.game = {
      open: true,
      question: q,
      seconds: sec,
      answers: new Map(),
      resultsShown: false
    };

    // S'assurer que les clients se mettent en mode "free"
    io.to(code).emit('mode:changed', { mode: 'free' });
    // Emettre l'overlay question + consigne
    io.to(code).emit('free:question', { question: q, seconds: sec });
  },

  playerAnswer(io, room, code, playerName, text, ack) {
    const g = room.game || {};
    if (!g.open) { ack && ack({ ok: false }); return; }
    const t = String(text || '').slice(0, 280);
    // On retient la dernière saisie envoyée
    const prev = g.answers.get(playerName) || { text: '', validated: false };
    g.answers.set(playerName, { text: t, validated: prev.validated === true });
    ack && ack({ ok: true });
  },

  adminClose(io, room, code) {
    const g = room.game || {};
    if (!g.open) return;
    g.open = false;
    g.resultsShown = true;

    // Constuire un tableau trié par nom
    const results = [];
    room.players.forEach(p => {
      const rec = g.answers.get(p.name);
      results.push({
        name: p.name,
        text: rec ? rec.text : '',
        validated: rec ? !!rec.validated : false
      });
    });
    // Inclure aussi ceux qui ont répondu mais sont déconnectés
    g.answers.forEach((rec, name) => {
      if (!results.find(r => r.name === name)) {
        results.push({ name, text: rec.text, validated: !!rec.validated });
      }
    });

    results.sort((a, b) => a.name.localeCompare(b.name));
    io.to(code).emit('free:results', { question: g.question, items: results });
  },

  // Toggle validation d'une réponse (donne/retranche 1 point)
  adminToggleValidate(io, room, code, playerName, broadcastPlayers) {
    const g = room.game || {};
    if (!g.resultsShown) return;
    const rec = g.answers.get(playerName) || { text: '', validated: false };
    rec.validated = !rec.validated;
    g.answers.set(playerName, rec);

    const prev = room.scores.get(playerName) || 0;
    const next = rec.validated ? prev + 1 : Math.max(0, prev - 1);
    room.scores.set(playerName, next);

    io.to(code).emit('free:validated', { name: playerName, validated: rec.validated, score: next });
    broadcastPlayers(code);
  }
};
