// public/js/tv-quiz.js
import { GameRegistry, Core } from './tv-core.js';

let bank = [];
let autoplay = { running: false, total: 0, done: 0, timer: null };

function startAutoplay(count) {
  if (!bank.length) { alert('Charge la banque de questions'); return; }
  autoplay.running = true; autoplay.total = count; autoplay.done = 0;
  runNext();
  function runNext() {
    if (!autoplay.running) return;
    if (autoplay.done >= autoplay.total) { autoplay.running = false; Core.hideProgress(); return; }
    const item = bank[Math.floor(Math.random() * bank.length)];
    const seconds = Math.max(1, Math.min(30, parseInt(document.getElementById('quizSeconds').value || '5', 10)));
    const q = String(item.q || document.getElementById('quizQuestion').value || '').trim();
    const correct = !!item.a;
    if (!q) { autoplay.running = false; alert('Question vide.'); return; }
    Core.showProgress(`Auto‑play Quiz: ${autoplay.done + 1}/${autoplay.total}`);
    Core.socket.emit('quiz:start', { question: q, correct, seconds });
    Core.socket.emit('countdown:start', seconds);
    setTimeout(() => {
      Core.socket.emit('quiz:close');
      autoplay.done++;
      setTimeout(runNext, 1200);
    }, seconds * 1000);
  }
}

GameRegistry.register('quiz', {
  onEnter() {
    const loadBtn = document.getElementById('quizLoadBtn');
    const randBtn = document.getElementById('quizRandomBtn');
    const startBtn = document.getElementById('quizStartBtn');
    const closeBtn = document.getElementById('quizCloseBtn');
    const loadedInfo = document.getElementById('quizLoadedInfo');
    const qInput = document.getElementById('quizQuestion');
    const sInput = document.getElementById('quizSeconds');
    const trueRadio = document.getElementById('quizTrue');
    const autoBtnId = 'quizAutoBtn';

    if (!document.getElementById(autoBtnId)) {
      const autoBtn = document.createElement('button');
      autoBtn.id = autoBtnId;
      autoBtn.className = 'btn-cyan';
      autoBtn.textContent = 'Auto‑play (10)';
      autoBtn.style.marginLeft = '.4rem';
      closeBtn.parentElement.appendChild(autoBtn);
      autoBtn.addEventListener('click', () => startAutoplay(10));
    }

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
        if (item.a) trueRadio.checked = true; else document.getElementById('quizFalse').checked = true;
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
