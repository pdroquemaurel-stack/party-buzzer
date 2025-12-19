// server/games/trivia.js
module.exports = {
  id: 'trivia',
  name: 'Culture generale',

  init(room) {
    room.game = {
      open: false,           // question en cours ouverte ?
      idx: -1,               // index question courante (0..n-1)
      total: 0,
      seconds: 15,           // durée par question
      items: [],             // [{ q, a }]
      answers: new Map(),    // name -> text (derniere valeur)
      marks: new Map()       // name -> boolean (correct ?) pour la question courante
    };
  },

  // TV envoie la liste des 20 questions (items: [{q, a}]) + seconds (ex: 15)
  adminSetup(io, room, code, { items, seconds }) {
    const arr = Array.isArray(items) ? items.slice(0, 20) : [];
    room.game = {
      open: false,
      idx: -1,
      total: arr.length,
      seconds: Math.max(5, Math.min(60, parseInt(seconds, 10) || 15)),
      items: arr,
      answers: new Map(),
      marks: new Map()
    };
    // Bascule en mode trivia coté clients
    io.to(code).emit('mode:changed', { mode: 'trivia' });
    io.to(code).emit('trivia:setup', { total: room.game.total, seconds: room.game.seconds });
  },

  // Ouvre la premiere question
  adminStart(io, room, code) {
    if (!room.game || room.game.total === 0) return;
    room.game.idx = 0;
    room.game.open = true;
    room.game.answers = new Map();
    room.game.marks = new Map();
    const item = room.game.items[room.game.idx];
    io.to(code).emit('trivia:question', {
      index: room.game.idx + 1,
      total: room.game.total,
      question: item.q,
      seconds: room.game.seconds
    });
  },

  // Ouvre la question suivante (ou termine)
  adminNext(io, room, code, broadcastPlayers) {
    if (!room.game) return;
    // si on était déjà à la fin -> summary
    if (room.game.idx >= room.game.total - 1) {
      this.adminFinish(io, room, code, broadcastPlayers);
      return;
    }
    room.game.idx += 1;
    room.game.open = true;
    room.game.answers = new Map();
    room.game.marks = new Map();
    const item = room.game.items[room.game.idx];
    io.to(code).emit('trivia:question', {
      index: room.game.idx + 1,
      total: room.game.total,
      question: item.q,
      seconds: room.game.seconds
    });
  },

  // Clore la question courante (stopper les réponses)
  adminClose(io, room, code) {
    if (!room.game) return;
    room.game.open = false;
    // Diffuser la liste finale des réponses (tri alpha nom)
    const answers = Array.from(room.game.answers.entries())
      .map(([name, text]) => ({ name, text }))
      .sort((a, b) => a.name.localeCompare(b.name));
    io.to(code).emit('trivia:closed', { index: room.game.idx + 1 });
    io.to(code).emit('trivia:answers', { answers });
  },

  // Marquer/demarquer correct une réponse (idempotent, ajuste les scores)
  adminMark(io, room, code, name, correct, broadcastPlayers) {
    if (!room.game) return;
    const prev = room.game.marks.get(name) || false;
    const next = !!correct;
    if (prev === next) {
      // rien à faire
    } else {
      room.game.marks.set(name, next);
      // ajuster le score global
      const cur = room.scores.get(name) || 0;
      room.scores.set(name, cur + (next ? 1 : -1));
      broadcastPlayers(code);
    }
    io.to(code).emit('trivia:marked', { name, correct: !!correct });
  },

  // Reponses des joueurs (dernière valeur retenue)
  playerAnswer(io, room, code, playerName, text) {
    if (!room.game || !room.game.open) return;
    const t = String(text || '').slice(0, 120); // limite taille
    room.game.answers.set(playerName || 'Joueur', t);
    // On peut pousser la progression (liste live) si tu veux voir en temps réel:
    const answers = Array.from(room.game.answers.entries())
      .map(([name, txt]) => ({ name, text: txt }))
      .sort((a, b) => a.name.localeCompare(b.name));
    io.to(code).emit('trivia:answers', { answers });
  },

  // Fin de la serie => summary
  adminFinish(io, room, code, broadcastPlayers) {
    // Classement final depuis room.scores
    const scoreList = Array.from(room.scores.entries())
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
    io.to(code).emit('trivia:summary', { scores: scoreList });
    broadcastPlayers(code);
  }
};
