// public/js/tv-quiz.js
import { GameRegistry, Core } from './tv-core.js';
import { GAME_EVENTS } from './types.js';

let bank = [];

GameRegistry.register('quiz', {
  onEnter() {
    // Hooker les boutons une seule fois
    const loadBtn = document.getElementById('quizLoadBtn');
    const randBtn = document.getElementById('quizRandomBtn');
    const startBtn = document.getElementById('quizStartBtn');
    const closeBtn = document.getElementById('quizCloseBtn');
    const loadedInfo = document.getElementById('quizLoadedInfo');
    const qInput = document.getElementById('quizQuestion');
    const sInput = document.getElementById('quizSeconds');
    const trueRadio = document.getElementById('quizTrue');
    const falseRadio = document.getElementById('quizFalse');
    const info = document.getElementById('quizInfo');

    if (!loadBtn._wired) {
      loadBtn._wired = true;
      loadBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/questions.json', { cache: 'no-store' });
          const data = await res.json();
          bank = Array.isArray(data) ? data : [];
          loadedInfo.textContent = `${bank.length} question(s) chargée(s).`;
          randBtn.disabled = bank.length === 0;
        } catch {
          alert('Impossible de charger /questions.json');
          bank = []; loadedInfo.textContent = ''; randBtn.disabled = true;
        }
      });
      randBtn.addEventListener('click', () => {
        if (!bank.length) return;
        const item = bank[Math.floor(Math.random() * bank.length)];
        qInput.value = item.q || '';
        (item.a ? trueRadio : falseRadio).checked = true;
      });
      startBtn.addEventListener('click', () => {
        const q = qInput.value.trim();
        const seconds = Math.max(1, Math.min(30, parseInt(sInput.value || '5', 10)));
        if (!q) { alert('Entre une question'); return; }
        const correct = trueRadio.checked;
        Core.socket.emit('quiz:start', { question: q, correct, seconds });
        Core.socket.emit('countdown:start', seconds);
        setTimeout(() => Core.socket.emit('quiz:close'), seconds * 1000);
      });
      closeBtn.addEventListener('click', () => Core.socket.emit('quiz:close'));
    }
  },
  onQuestion({ question, seconds }) {
    document.getElementById('quizInfo').textContent = `Question en cours (${seconds}s): "${question}"`;
  },
  onResult({ correct, countTrue, countFalse, total }) {
    const txt = correct ? 'Vrai' : 'Faux';
    document.getElementById('quizInfo').textContent = `Bonne réponse: ${txt} — Vrai: ${countTrue}, Faux: ${countFalse}, Total: ${total}`;
  },
  onProgress() {},
  onClose() {}
});
