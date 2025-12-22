// public/js/tv-core.js
import { EVENTS, GAME_EVENTS } from './types.js';

export const GameRegistry = (() => {
  const modules = new Map();
  return {
    register(name, mod) {
      modules.set(name, mod);
    },
    get(name) {
      return modules.get(name);
    },
    all() { return Array.from(modules.keys()); }
  };
})();

export const Core = (() => {
  const socket = io();
  let room = generateRoomCode(5);
  let currentMode = 'buzzer';

  // Elements
  const els = {
    roomCode: document.getElementById('roomCode'),
    qr: document.getElementById('qr'),
    qrLink: document.getElementById('qrLink'),
    regenBtn: document.getElementById('regenBtn'),
    players: document.getElementById('players'),
    resetScoresBtn: document.getElementById('resetScoresBtn'),
    status: document.getElementById('status'),
    overlay: document.getElementById('overlay'),
    winnerName: document.getElementById('winnerName'),
    countdown: document.getElementById('countdown'),
    countNum: document.getElementById('countNum'),
    modeSwitch: document.getElementById('modeSwitch'),
    panels: document.querySelectorAll('[data-game-panel]'),

    // Overlay question
    quizQOverlay: document.getElementById('quizQOverlay'),
    quizQText: document.getElementById('quizQText'),
    quizTimer: document.getElementById('quizTimer'),
    freeHint: document.getElementById('freeHint'),

    // Free overlays
    freeResultsOverlay: document.getElementById('freeResultsOverlay'),
    freeResultsList: document.getElementById('freeResultsList'),
    freeResultsCloseBtn: document.getElementById('freeResultsCloseBtn'),
    freeReviewOverlay: document.getElementById('freeReviewOverlay'),
    freeReviewPosition: document.getElementById('freeReviewPosition'),
    freeReviewQuestion: document.getElementById('freeReviewQuestion'),
    freeReviewList: document.getElementById('freeReviewList'),
    freeReviewPrevBtn: document.getElementById('freeReviewPrevBtn'),
    freeReviewNextBtn: document.getElementById('freeReviewNextBtn'),
    freeReviewCloseBtn: document.getElementById('freeReviewCloseBtn'),
  };

  const FIXED_BASE = 'https://party-buzzer.onrender.com';

  // State
  let cdTimer = null;
  let quizTimer = null;

  // Utils
  function generateRoomCode(len) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function playBeep(freq = 880, durMs = 120) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      o.start();
      setTimeout(() => {
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        o.stop(ctx.currentTime + 0.12);
      }, durMs);
    } catch {}
  }
  function setStatus(text) { els.status.textContent = text || ''; }

  function buildJoinUrl() { return FIXED_BASE + '/join?room=' + encodeURIComponent(room); }
  function renderInvite() {
    els.roomCode.textContent = room;
    const joinUrl = buildJoinUrl();
    els.qrLink.href = joinUrl;
    const qrApi = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=';
    els.qr.src = qrApi + encodeURIComponent(joinUrl);
  }

  function renderPlayers(list) {
    els.players.innerHTML = '';
    (list || []).forEach(p => {
      const li = document.createElement('li');
      li.className = 'score-item';
      const name = document.createElement('div'); name.className = 'score-name'; name.textContent = p.name;
      const score = document.createElement('div'); score.className = 'score-value'; score.textContent = p.score;
      const controls = document.createElement('div'); controls.className = 'score-controls';
      const btnPlus = document.createElement('button'); btnPlus.className = 'score-btn plus'; btnPlus.textContent = '▲';
      btnPlus.addEventListener('click', () => { score.textContent = String((parseInt(score.textContent||'0',10)||0)+1); socket.emit('scores:adjust', { name: p.name, delta: +1 }); });
      const btnMinus = document.createElement('button'); btnMinus.className = 'score-btn minus'; btnMinus.textContent = '▼';
      btnMinus.addEventListener('click', () => { score.textContent = String((parseInt(score.textContent||'0',10)||0)-1); socket.emit('scores:adjust', { name: p.name, delta: -1 }); });
      controls.appendChild(btnPlus); controls.appendChild(btnMinus);
      li.appendChild(name); li.appendChild(score); li.appendChild(controls);
      els.players.appendChild(li);
    });
  }

  function stopCountdownUI() { if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } els.countdown.classList.remove('show'); }
  function startCountdown(sec = 3, onEnd) {
    stopCountdownUI();
    els.countNum.textContent = sec;
    els.countdown.classList.add('show');
    socket.emit(EVENTS.COUNTDOWN_START, sec);
    playBeep(700, 120);
    let remain = sec;
    cdTimer = setInterval(() => {
      remain--;
      if (remain > 0) { els.countNum.textContent = remain; playBeep(700, 120); }
      else { stopCountdownUI(); playBeep(1200, 200); if (typeof onEnd === 'function') onEnd(); }
    }, 1000);
  }

  function showQuestionOverlay(question, seconds, showFreeHint = false) {
    if (quizTimer) { clearInterval(quizTimer); quizTimer = null; }
    els.quizQText.textContent = question;
    let remain = seconds || 5;
    els.quizTimer.textContent = `Temps restant: ${remain}s`;
    els.freeHint.style.display = showFreeHint ? 'block' : 'none';
    els.quizQOverlay.classList.add('show');
    quizTimer = setInterval(() => {
      remain--;
      if (remain > 0) els.quizTimer.textContent = `Temps restant: ${remain}s`;
      else { clearInterval(quizTimer); quizTimer = null; }
    }, 1000);
  }
  function hideQuestionOverlay() {
    if (quizTimer) { clearInterval(quizTimer); quizTimer = null; }
    els.quizQOverlay.classList.remove('show');
    els.quizTimer.textContent = '';
    els.freeHint.style.display = 'none';
  }

  // Mini routeur de mode
  function setModeUI(mode) {
    els.panels.forEach(p => {
      p.style.display = (p.dataset.gamePanel === mode) ? '' : 'none';
    });
    currentMode = mode;
    setStatus(
      mode === 'buzzer' ? 'Mode Buzzer' :
      mode === 'quiz' ? 'Mode Quiz' :
      mode === 'guess' ? 'Mode Devine' :
      mode === 'free' ? 'Mode Réponse libre' : `Mode ${mode}`
    );
    const mod = GameRegistry.get(mode);
    if (mod && mod.onEnter) mod.onEnter();
    // onExit pour l’ancien mode si besoin (optionnel si on garde une ref)
  }

  function emitGameEvent(type, payload) {
    // Dispatch vers le module du mode courant
    const mod = GameRegistry.get(currentMode);
    if (!mod) return;
    const handler = {
      [GAME_EVENTS.QUESTION]: mod.onQuestion,
      [GAME_EVENTS.PROGRESS]: mod.onProgress,
      [GAME_EVENTS.RESULT]: mod.onResult,
      [GAME_EVENTS.CLOSE]: mod.onClose
    }[type];
    if (typeof handler === 'function') handler(payload);
  }

  // Socket handlers communs
  socket.on(EVENTS.MODE_CHANGED, ({ mode }) => {
    hideQuestionOverlay();
    stopCountdownUI();
    setModeUI(mode);
  });
  socket.on(EVENTS.ROOM_PLAYERS, renderPlayers);
  socket.on(EVENTS.SCORES_RESET, () => setStatus('Scores réinitialisés'));
  socket.on(EVENTS.ROUND_RESET, () => { hideQuestionOverlay(); setStatus('Tour/Question réinitialisé.'); });

  // Buzzer → mapping vers évènements normalisés pour le module
  socket.on(EVENTS.BUZZ_OPEN, () => emitGameEvent(GAME_EVENTS.QUESTION, { opened: true }));
  socket.on(EVENTS.BUZZ_WINNER, (data) => {
    els.winnerName.textContent = data.name;
    els.overlay.classList.add('show');
    emitGameEvent(GAME_EVENTS.RESULT, data);
  });

  // Quiz
  socket.on(EVENTS.QUIZ_QUESTION, ({ question, seconds }) => {
    setModeUI('quiz');
    showQuestionOverlay(question, seconds, false);
    emitGameEvent(GAME_EVENTS.QUESTION, { question, seconds });
  });
  socket.on(EVENTS.QUIZ_RESULT, (payload) => {
    hideQuestionOverlay();
    emitGameEvent(GAME_EVENTS.RESULT, payload);
  });

  // Guess
  socket.on(EVENTS.GUESS_START, ({ question, min, max, seconds }) => {
    setModeUI('guess');
    showQuestionOverlay(question, seconds, false);
    emitGameEvent(GAME_EVENTS.QUESTION, { question, min, max, seconds });
  });
  socket.on(EVENTS.GUESS_PROGRESS, (prog) => emitGameEvent(GAME_EVENTS.PROGRESS, prog));
  socket.on(EVENTS.GUESS_RESULT, (payload) => { hideQuestionOverlay(); emitGameEvent(GAME_EVENTS.RESULT, payload); });

  // Free
  socket.on(EVENTS.FREE_QUESTION, ({ question, seconds, index, total }) => {
    setModeUI('free');
    showQuestionOverlay(question, seconds, true);
    emitGameEvent(GAME_EVENTS.QUESTION, { question, seconds, index, total });
  });
  socket.on(EVENTS.FREE_RESULTS, ({ question, items }) => {
    hideQuestionOverlay();
    emitGameEvent(GAME_EVENTS.RESULT, { question, items });
  });
  socket.on(EVENTS.FREE_VALIDATED, ({ name, validated }) => {
    emitGameEvent(GAME_EVENTS.PROGRESS, { name, validated, context: 'single' });
  });
  socket.on(EVENTS.FREE_REVIEW_OPEN, ({ index, total, question, items }) => {
    // Module free prend la main, il utilisera les éléments overlay free review
    emitGameEvent(GAME_EVENTS.QUESTION, { index, total, question, items, phase: 'review' });
  });
  socket.on(EVENTS.FREE_REVIEW_VALIDATED, ({ name, validated }) => {
    emitGameEvent(GAME_EVENTS.PROGRESS, { name, validated, context: 'review' });
  });

  // UI init
  window.addEventListener('DOMContentLoaded', () => {
    renderInvite();
    socket.emit('tv:create_room', room);

    // Mode radios -> serveur
    els.modeSwitch.querySelectorAll('input[name="mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) socket.emit('mode:set', { mode: radio.value });
      });
    });

    els.regenBtn.addEventListener('click', () => {
      room = generateRoomCode(5);
      renderInvite();
      socket.emit('tv:create_room', room);
    });

    els.resetScoresBtn?.addEventListener('click', () => socket.emit('scores:reset'));
  });

  // Expose utilités aux modules
  return {
    socket,
    setModeUI,
    setStatus,
    startCountdown,
    stopCountdownUI,
    showQuestionOverlay,
    hideQuestionOverlay,
    playBeep,
    els
  };
})();
