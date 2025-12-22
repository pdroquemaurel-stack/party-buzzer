// server/games/free.js
// Jeu "Réponse Libre" avec série et correction différée.

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  id: 'free',
  name: 'Réponse Libre',

  init(room) {
    room.game = {
      mode: 'single',             // 'single' | 'series'
      phase: 'idle',              // 'idle' | 'single_active' | 'series_active' | 'review'
      // Single
      open: false,
      question: '',
      seconds: 30,
      answers: new Map(),         // name -> { text, validated: false }
      // Series
      series: [],                 // [{ q, s }]
      seriesLength: 0,
      currentIndex: -1,
      answersByIdx: new Map(),    // idx -> Map(name -> { text, validated })
      reviewIndex: 0
    };
  },

  // ---------- SINGLE QUESTION ----------
  adminStart(io, room, code, { question, seconds }) {
    const q = String(question || '').trim().slice(0, 300);
    const sec = clampInt(seconds, 5, 180, 30);

    room.game.mode = 'single';
    room.game.phase = 'single_active';
    room.game.open = true;
    room.game.question = q;
    room.game.seconds = sec;
    room.game.answers = new Map();

    io.to(code).emit('mode:changed', { mode: 'free' });
    io.to(code).emit('free:question', { question: q, seconds: sec });
  },

  playerAnswer(io, room, code, playerName, text, ack) {
    const g = room.game || {};
    const t = String(text || '').slice(0, 280);

    if (g.mode === 'single' && g.phase === 'single_active' && g.open) {
      const prev = g.answers.get(playerName) || { text: '', validated: false };
      g.answers.set(playerName, { text: t, validated: prev.validated === true });
      ack && ack({ ok: true });
      return;
    }

    if (g.mode === 'series' && g.phase === 'series_active' && g.currentIndex >= 0) {
      const idx = g.currentIndex;
      let map = g.answersByIdx.get(idx);
      if (!map) { map = new Map(); g.answersByIdx.set(idx, map); }
      const prev = map.get(playerName) || { text: '', validated: false };
      map.set(playerName, { text: t, validated: prev.validated === true });
      ack && ack({ ok: true });
      return;
    }

    ack && ack({ ok: false });
  },

  adminClose(io, room, code) {
    const g = room.game || {};
    if (g.mode !== 'single' || g.phase !== 'single_active') return;

    g.open = false;
    g.phase = 'idle';

    // Construire résultats
    const results = [];
    // joueurs connectés d'abord
    room.players.forEach(p => {
      const rec = g.answers.get(p.name);
      results.push({ name: p.name, text: rec ? rec.text : '', validated: rec ? !!rec.validated : false });
    });
    // inclure les autres
    g.answers.forEach((rec, name) => {
      if (!results.find(r => r.name === name)) results.push({ name, text: rec.text, validated: !!rec.validated });
    });

    results.sort((a, b) => a.name.localeCompare(b.name));
    io.to(code).emit('free:results', { question: g.question, items: results });
  },

  adminToggleValidate(io, room, code, playerName, broadcastPlayers) {
    const g = room.game || {};
    // Single mode correction live
    if (g.mode === 'single' && g.phase === 'idle') {
      const rec = g.answers.get(playerName) || { text: '', validated: false };
      rec.validated = !rec.validated;
      g.answers.set(playerName, rec);
      const prev = room.scores.get(playerName) || 0;
      const next = rec.validated ? prev + 1 : Math.max(0, prev - 1);
      room.scores.set(playerName, next);
      io.to(code).emit('free:validated', { name: playerName, validated: rec.validated, score: next });
      broadcastPlayers(code);
      return;
    }

    // Series correction phase
    if (g.mode === 'series' && g.phase === 'review') {
      const idx = g.reviewIndex;
      let map = g.answersByIdx.get(idx);
      if (!map) { map = new Map(); g.answersByIdx.set(idx, map); }
      const rec = map.get(playerName) || { text: '', validated: false };
      rec.validated = !rec.validated;
      map.set(playerName, rec);

      const prev = room.scores.get(playerName) || 0;
      const next = rec.validated ? prev + 1 : Math.max(0, prev - 1);
      room.scores.set(playerName, next);
      io.to(code).emit('free:review_validated', { index: idx, name: playerName, validated: rec.validated, score: next });
      broadcastPlayers(code);
      return;
    }
  },

  // ---------- SERIES ----------
  adminSeriesStart(io, room, code, { items }) {
    const list = Array.isArray(items) ? items.slice(0, 20) : [];
    if (list.length === 0) return;

    room.game.mode = 'series';
    room.game.phase = 'series_active';
    room.game.series = list.map(it => ({
      q: String((it && it.q) || '').slice(0, 300),
      s: clampInt(it && it.s, 5, 180, 30)
    }));
    room.game.seriesLength = room.game.series.length;
    room.game.currentIndex = -1;
    room.game.answersByIdx = new Map();
    room.game.reviewIndex = 0;

    io.to(code).emit('mode:changed', { mode: 'free' });
    // TV va demander la prochaine question
  },

  adminSeriesNextQuestion(io, room, code) {
    const g = room.game || {};
    if (g.mode !== 'series' || g.phase !== 'series_active') return;
    const next = g.currentIndex + 1;
    if (next >= g.seriesLength) {
      // Fin des questions -> phase review
      g.phase = 'review';
      g.reviewIndex = 0;
      const first = g.series[0];
      const items = this._buildReviewItems(room, g, 0);
      io.to(code).emit('free:review_open', { index: 0, total: g.seriesLength, question: first.q, items });
      return;
    }
    g.currentIndex = next;
    const cur = g.series[next];
    // Emit la question courante (overlay question)
    io.to(code).emit('free:question', { question: cur.q, seconds: cur.s, index: next, total: g.seriesLength });
  },

  adminSeriesFinish(io, room, code) {
    const g = room.game || {};
    if (g.mode !== 'series' || g.phase !== 'series_active') return;
    g.phase = 'review';
    g.reviewIndex = 0;
    const first = g.series[0];
    const items = this._buildReviewItems(room, g, 0);
    io.to(code).emit('free:review_open', { index: 0, total: g.seriesLength, question: first.q, items });
  },

  adminSeriesGotoIndex(io, room, code, index) {
    const g = room.game || {};
    if (g.mode !== 'series' || g.phase !== 'review') return;
    const idx = clampInt(index, 0, g.seriesLength - 1, 0);
    g.reviewIndex = idx;
    const q = g.series[idx].q;
    const items = this._buildReviewItems(room, g, idx);
    io.to(code).emit('free:review_open', { index: idx, total: g.seriesLength, question: q, items });
  },

  _buildReviewItems(room, g, idx) {
    const items = [];
    const map = g.answersByIdx.get(idx) || new Map();

    // joueurs connectés d'abord
    room.players.forEach(p => {
      const rec = map.get(p.name);
      items.push({
        name: p.name,
        text: rec ? rec.text : '',
        validated: rec ? !!rec.validated : false
      });
    });
    // inclure ceux qui ont répondu mais ne sont pas connectés
    map.forEach((rec, name) => {
      if (!items.find(r => r.name === name)) {
        items.push({ name, text: rec.text, validated: !!rec.validated });
      }
    });

    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }
};
