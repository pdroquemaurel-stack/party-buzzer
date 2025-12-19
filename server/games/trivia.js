// server/games/trivia.js
function clearTid(g) {
  if (g && g.tid) { clearTimeout(g.tid); g.tid = null; }
}

module.exports = {
  id: 'trivia',
  name: 'Culture generale',

  init(room) {
    room.game = {
      phase: 'idle',         // 'idle' | 'ask' | 'review' | 'done'
      idx: -1,               // index question courante (phase ask)
      total: 0,
      seconds: 15,
      items: [],             // [{ q, a }]
      answers: new Map(),    // nom -> text (pendant la question courante)
      answersByQ: [],        // Array<Map<name,text>>
      marksByQ: [],          // Array<Map<name,bool>>
      tid: null,             // timer pour enchaîner
      reviewIdx: 0           // index courant en phase review
    };
  },

  // TV envoie 20 items [{q,a}] + seconds (ex:15)
  adminSetup(io, room, code, { items, seconds }) {
    const arr = Array.isArray(items) ? items.slice(0, 20) : [];
    const secs = Math.max(5, Math.min(60, parseInt(seconds, 10) || 15));
    room.game = {
      phase: 'idle',
      idx: -1,
      total: arr.length,
      seconds: secs,
      items: arr,
      answers: new Map(),
      answersByQ: Array.from({ length: arr.length }, () => new Map()),
      marksByQ: Array.from({ length: arr.length }, () => new Map()),
      tid: null,
      reviewIdx: 0
    };
    io.to(code).emit('mode:changed', { mode: 'trivia' });
    io.to(code).emit('trivia:setup', { total: room.game.total, seconds: room.game.seconds });
  },

  // Lance la série: enchaîne automatiquement les 20 questions
  adminStart(io, room, code) {
    const g = room.game;
    if (!g || g.total === 0) return;
    g.phase = 'ask';
    g.idx = 0;
    g.answers = new Map();
    this.emitQuestion(io, room, code);
    this.armNext(io, room, code);
  },

  emitQuestion(io, room, code) {
    const g = room.game;
    const item = g.items[g.idx];
    io.to(code).emit('trivia:question', {
      index: g.idx + 1,
      total: g.total,
      question: item.q,
      seconds: g.seconds
    });
  },

  armNext(io, room, code) {
    const g = room.game;
    clearTid(g);
    g.tid = setTimeout(() => {
      this.closeCurrent(io, room, code);
    }, g.seconds * 1000);
  },

  closeCurrent(io, room, code) {
    const g = room.game;
    if (!g || g.phase !== 'ask') return;
    // Figé: on enregistre les réponses de la question courante
    g.answersByQ[g.idx] = g.answers;
    io.to(code).emit('trivia:closed', { index: g.idx + 1 });

    // Passe à la question suivante ou démarre la revue
    if (g.idx < g.total - 1) {
      g.idx += 1;
      g.answers = new Map();
      this.emitQuestion(io, room, code);
      this.armNext(io, room, code);
    } else {
      clearTid(g);
      this.startReview(io, room, code);
    }
  },

  // Les joueurs envoient la DERNIÈRE valeur (throttle côté client)
  playerAnswer(io, room, code, playerName, text) {
    const g = room.game;
    if (!g || g.phase !== 'ask') return;
    const t = String(text || '').slice(0, 120);
    g.answers.set(playerName || 'Joueur', t);

    // Option: on peut diffuser un live des réponses — ici on évite de spammer la TV.
    // Si besoin: io.to(code).emit('trivia:answers_live', { count: g.answers.size });
  },

  // Phase revue (après les 20 questions)
  startReview(io, room, code) {
    const g = room.game;
    g.phase = 'review';
    g.reviewIdx = 0;
    io.to(code).emit('trivia:review_start', { total: g.total });
    this.emitReview(io, room, code);
  },

  emitReview(io, room, code) {
    const g = room.game;
    const i = g.reviewIdx;
    const item = g.items[i];
    const answersMap = g.answersByQ[i] || new Map();
    const marksMap = g.marksByQ[i] || new Map();

    const answers = Array.from(answersMap.entries())
      .map(([name, text]) => ({ name, text, correct: !!marksMap.get(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    io.to(code).emit('trivia:review', {
      index: i + 1,
      total: g.total,
      question: item.q,
      correct: item.a ?? '',
      answers
    });
  },

  // TV: clique pour marquer correct/annuler (phase review seulement)
  reviewMark(io, room, code, name, correct) {
    const g = room.game;
    if (!g || g.phase !== 'review') return;
    const i = g.reviewIdx;
    const marksMap = g.marksByQ[i] || new Map();
    marksMap.set(String(name || ''), !!correct);
    g.marksByQ[i] = marksMap;
    io.to(code).emit('trivia:marked', { name: String(name || ''), correct: !!correct });
  },

  // TV: question suivante (phase review)
  reviewNext(io, room, code) {
    const g = room.game;
    if (!g || g.phase !== 'review') return;
    if (g.reviewIdx < g.total - 1) {
      g.reviewIdx += 1;
      this.emitReview(io, room, code);
    } else {
      this.finish(io, room, code);
    }
  },

  // Fin: produit le classement du mini‑jeu (sans toucher aux scores globaux)
  finish(io, room, code) {
    const g = room.game;
    const tally = new Map(); // name -> scoreTrivia
    g.marksByQ.forEach(mk => {
      mk.forEach((isOk, name) => {
        if (isOk) tally.set(name, (tally.get(name) || 0) + 1);
      });
    });

    const scores = Array.from(tally.entries())
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));

    g.phase = 'done';
    io.to(code).emit('trivia:summary', { scores });
  }
};
