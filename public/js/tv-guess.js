// public/js/tv-guess.js
import { GameRegistry, Core } from './tv-core.js';

let bank = [];
let autoplay = { running: false, total: 0, done: 0 };

function renderGuessChart(prog) {
  const chart = document.getElementById('guessChart');
  const scale = document.getElementById('guessScale');
  chart.innerHTML = '';
  if (!prog || !Array.isArray(prog.bins) || prog.bins.length === 0) {
    scale.innerHTML = `<span>${prog?.min ?? ''}</span><span>${prog?.max ?? ''}</span>`;
    return;
  }
  const maxCount = Math.max(1, ...prog.bins.map(b => b.count));
  prog.bins.forEach(b => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const h = Math.round((b.count / maxCount) * 100);
    bar.style.height = (h || 2) + '%';
    bar.title = `${b.from}–${b.to}: ${b.count}`;
    const label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = b.count ? b.count : '';
    bar.appendChild(label);
    chart.appendChild(bar);
  });
  scale.innerHTML = `<span>${prog.min}</span><span>${prog.max}</span>`;
}

function startAutoplay(count) {
  if (!bank.length) { alert('Charge la banque'); return; }
  autoplay.running = true; autoplay.total = count; autoplay.done = 0;
  runNext();
  function runNext() {
    if (!autoplay.running) return;
    if (autoplay.done >= autoplay.total) { autoplay.running = false; Core.hideProgress(); return; }
    const item = bank[Math.floor(Math.random() * bank.length)];
    const q = item.q || document.getElementById('guessQuestion').value.trim();
    const min = item.min ?? parseInt(document.getElementById('guessMin').value || '0', 10);
    const max = item.max ?? parseInt(document.getElementById('guessMax').value || '100', 10);
    const correct = item.c ?? parseInt(document.getElementById('guessCorrect').value || '0', 10);
    const seconds = Math.max(1, Math.min(60, parseInt(document.getElementById('guessSeconds').value || '8', 10)));
    if (!q) { autoplay.running = false; alert('Question vide.'); return; }

    Core.showProgress(`Auto‑play Devine: ${autoplay.done + 1}/${autoplay.total}`);
    Core.socket.emit('guess:start', { question: q, correct, min, max, seconds });
    Core.socket.emit('countdown:start', seconds);
    setTimeout(() => {
      Core.socket.emit('guess:close');
      autoplay.done++;
      setTimeout(runNext, 1200);
    }, seconds * 1000);
  }
}

GameRegistry.register('guess', {
  onEnter() {
    const loadBtn = document.getElementById('guessLoadBtn');
    const randBtn = document.getElementById('guessRandomBtn');
    const loadedInfo = document.getElementById('guessLoadedInfo');
    const qInput = document.getElementById('guessQuestion');
    const cInput = document.getElementById('guessCorrect');
    const minInput = document.getElementById('guessMin');
    const maxInput = document.getElementById('guessMax');
    const sInput = document.getElementById('guessSeconds');
    const startBtn = document.getElementById('guessStartBtn');
    const closeBtn = document.getElementById('guessCloseBtn');
    const autoBtnId = 'guessAutoBtn';

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
          const res = await fetch('/guess-questions.json', { cache: 'no-store' });
          const data = await res.json();
          bank = Array.isArray(data) ? data : [];
          loadedInfo.textContent = `${bank.length} question(s) chargée(s).`;
          randBtn.disabled = bank.length === 0;
        } catch {
          alert('Impossible de charger /guess-questions.json');
          bank = []; loadedInfo.textContent=''; randBtn.disabled = true;
        }
      });
      randBtn.addEventListener('click', () => {
        if (!bank.length) return;
        const item = bank[Math.floor(Math.random() * bank.length)];
        qInput.value = item.q || '';
        cInput.value = item.c ?? '';
        minInput.value = item.min ?? 0;
        maxInput.value = item.max ?? 100;
        sInput.value = item.s ?? 8;
      });
      startBtn.addEventListener('click', () => {
        const q = qInput.value.trim();
        if (!q) { alert('Entre une question'); return; }
        const correct = parseInt(cInput.value || '0', 10);
        const min = parseInt(minInput.value || '0', 10);
        const max = parseInt(maxInput.value || '100', 10);
        const seconds = Math.max(1, Math.min(60, parseInt(sInput.value || '8', 10)));
        Core.socket.emit('guess:start', { question: q, correct, min, max, seconds });
        Core.socket.emit('countdown:start', seconds);
        setTimeout(() => Core.socket.emit('guess:close'), seconds * 1000);
      });
      closeBtn.addEventListener('click', () => Core.socket.emit('guess:close'));
    }
  },
  onQuestion({ question, min, max, seconds }) {
    document.getElementById('guessInfo').textContent = `Question en cours (${seconds}s) — Intervalle: ${min} à ${max}`;
    document.getElementById('guessChart').innerHTML = '';
    document.getElementById('guessScale').innerHTML = `<span>${min}</span><span>${max}</span>`;
  },
  onProgress(prog) { renderGuessChart(prog); },
  onResult({ correct, winners, bestDiff, tol }) {
    const maxShow = 5;
    const names = winners || [];
    const shown = names.slice(0, maxShow).join(', ');
    const more = names.length > maxShow ? ` (+${names.length - maxShow})` : '';
    const who = names.length ? shown + more : 'Aucun';
    const detail = (bestDiff === null) ? '' : ` — meilleur écart: ${bestDiff}${tol ? `, tolérance≈±${tol}` : ''}`;
    document.getElementById('guessInfo').textContent = `Réponse: ${correct} — Gagnants: ${who}${detail}`;
  },
  onClose() {}
});
