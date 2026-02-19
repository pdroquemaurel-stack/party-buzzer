// public/js/tv-quiz.js
import { GameRegistry, Core } from './tv-core.js';

let bank = [];
let autoplay = { running: false, total: 0, done: 0 };

function startAutoplay(count) {
  if (!bank.length) { alert('Charge la banque de questions'); return; }
  Core.autoPlayRunning = true;
  autoplay = { running: true, total: count, done: 0 };
  runNext();

  function runNext() {
    if (!Core.autoPlayRunning || !autoplay.running) { autoplay.running = false; Core.hideProgress(); return; }
    if (autoplay.done >= autoplay.total) { autoplay.running = false; Core.hideProgress(); return; }

    const item = bank[Math.floor(Math.random() * bank.length)];
    const seconds = Math.max(1, Math.min(30, parseInt(document.getElementById('quizSeconds').value || '5', 10)));
    const q = String(item.q || '').trim();
    const correct = !!item.a;
    if (!q) { autoplay.running = false; Core.autoPlayRunning = false; alert('Question vide.'); return; }

    Core.showProgress(`Auto‑play Quiz: ${autoplay.done + 1}/${autoplay.total}`);
    Core.socket.emit('quiz:start', { question: q, correct, seconds });
    Core.socket.emit('countdown:start', seconds);
    setTimeout(() => {
      Core.socket.emit('quiz:close');
      autoplay.done++;
      if (Core.autoPlayRunning && autoplay.running) setTimeout(runNext, 1200);
    }, seconds * 1000);
  }
}

GameRegistry.register('quiz', {
  onEnter() {
    const loadBtn = document.getElementById('quizLoadBtn');
    const startBtn = document.getElementById('quizStartBtn');
    const randAskBtn = document.getElementById('quizRandomAskBtn');
    const seriesBtn = document.getElementById('quizSeriesBtn');
    const loadedInfo = document.getElementById('quizLoadedInfo');
    const sInput = document.getElementById('quizSeconds');
    const countInput = document.getElementById('quizSeriesCount');
    const trueRadio = document.getElementById('quizTrue');

    if (!loadBtn._wired) {
      loadBtn._wired = true;
      loadBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/questions.json', { cache: 'no-store' });
          const data = await res.json();
          bank = Array.isArray(data) ? data : [];
          loadedInfo.textContent = `${bank.length} question(s) chargée(s).`;
        } catch {
          alert('Impossible de charger /questions.json');
          bank = []; loadedInfo.textContent = '';
        }
      });

      startBtn.addEventListener('click', () => {
        const q = document.getElementById('quizQuestion').value.trim();
        const seconds = Math.max(1, Math.min(30, parseInt(sInput.value || '5', 10)));
        if (!q) { alert('Entre une question'); return; }
        const correct = trueRadio.checked;
        Core.socket.emit('quiz:start', { question: q, correct, seconds });
        Core.socket.emit('countdown:start', seconds);
        setTimeout(() => Core.socket.emit('quiz:close'), seconds * 1000);
      });

      randAskBtn.addEventListener('click', () => {
        if (!bank.length) { alert('Charge la banque'); return; }
        const item = bank[Math.floor(Math.random() * bank.length)];
        const q = item.q || '';
        const seconds = Math.max(1, Math.min(30, parseInt(sInput.value || item.s || '5', 10)));
        const correct = !!item.a;
        if (!q) return;
        Core.socket.emit('quiz:start', { question: q, correct, seconds });
        Core.socket.emit('countdown:start', seconds);
        setTimeout(() => Core.socket.emit('quiz:close'), seconds * 1000);
      });

      seriesBtn.addEventListener('click', () => {
        if (!bank.length) { alert('Charge la banque'); return; }
        const count = Math.max(1, Math.min(50, parseInt(countInput.value || '10', 10)));
        startAutoplay(count);
      });
    }
  },
  onQuestion({ question, seconds }) {
    document.getElementById('quizInfo').textContent = `Question en cours (${seconds}s): "${question}"`;
  },
  onResult({ correct, countTrue, countFalse, total, winners = [], losers = [], noAnswer = [] }) {
    const txt = correct ? 'Vrai' : 'Faux';
    const good = correct ? countTrue : countFalse;
    const bad = total - good;
    const noAnswer = Math.max(0, (document.querySelectorAll('#players .score-item').length || total) - total);
    document.getElementById('quizInfo').textContent = `Bonne réponse: ${txt} — Vrai: ${countTrue}, Faux: ${countFalse}, Total: ${total}`;
    Core.showResultsOverlay(`Quiz: bonne réponse = ${txt}`, [
      { type: 'good', label: `🟢 Bonne réponse (${winners.length}): ${winners.length ? winners.join(', ') : '—'}` },
      { type: 'bad', label: `🔴 Mauvaise réponse (${losers.length}): ${losers.length ? losers.join(', ') : '—'}` },
      { type: 'none', label: `⚪ Pas répondu (${noAnswer.length}): ${noAnswer.length ? noAnswer.join(', ') : '—'}` }
    ]);
  },
  onProgress() {},
  onClose() {}
});
