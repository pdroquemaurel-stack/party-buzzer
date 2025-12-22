// public/js/tv-free.js
import { GameRegistry, Core } from './tv-core.js';

let bank = [];

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function pickRandomFreeItems(src, amount, secondsOverride) {
  if (!Array.isArray(src) || src.length === 0) return [];
  const arr = src.slice();
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  const n = clamp(amount || 20, 1, 50);
  const out = [];
  for (let i = 0; i < n; i++) {
    const srcItem = arr[i % arr.length];
    out.push({ q: srcItem.q, s: secondsOverride || srcItem.s || 30 });
  }
  return out;
}

GameRegistry.register('free', {
  onEnter() {
    const loadBtn = document.getElementById('freeLoadBtn');
    const randBtn = document.getElementById('freeRandomBtn');
    const loadedInfo = document.getElementById('freeLoadedInfo');
    const qInput = document.getElementById('freeQuestion');
    const sInput = document.getElementById('freeSeconds');
    const countInput = document.getElementById('freeSeriesCount');
    const startBtn = document.getElementById('freeStartBtn');
    const seriesBtn = document.getElementById('freeSeriesBtn');
    const info = document.getElementById('freeInfo');

    if (!loadBtn._wired) {
      loadBtn._wired = true;
      loadBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/free-questions.json', { cache: 'no-store' });
          const data = await res.json();
          bank = Array.isArray(data) ? data : [];
          loadedInfo.textContent = `${bank.length} question(s) chargée(s).`;
          randBtn.disabled = bank.length === 0;
        } catch {
          alert('Impossible de charger /free-questions.json');
          bank = []; loadedInfo.textContent = ''; randBtn.disabled = true;
        }
      });
      randBtn.addEventListener('click', () => {
        if (!bank.length) return;
        const item = bank[Math.floor(Math.random() * bank.length)];
        qInput.value = item.q || '';
        sInput.value = item.s ?? 30;
      });
      startBtn.addEventListener('click', () => {
        const q = qInput.value.trim();
        const seconds = Math.max(5, Math.min(180, parseInt(sInput.value || '30', 10)));
        if (!q) { alert('Entre une question'); return; }
        Core.socket.emit('free:start', { question: q, seconds });
        Core.socket.emit('countdown:start', seconds);
        info.textContent = `Question posée (${seconds}s)`;
        setTimeout(() => Core.socket.emit('free:close'), seconds * 1000);
      });
      seriesBtn.addEventListener('click', () => {
        if (!bank.length) { alert('Charge d’abord la banque de questions'); return; }
        const count = Math.max(1, Math.min(50, parseInt(countInput.value || '20', 10)));
        const seconds = Math.max(5, Math.min(180, parseInt(sInput.value || '30', 10)));
        const items = pickRandomFreeItems(bank, count, seconds);
        Core.socket.emit('free:series:start', { items });
        info.textContent = `Série lancée (${items.length} question(s))`;
      });

      // Free overlays actions
      document.getElementById('freeResultsCloseBtn')?.addEventListener('click', () => {
        Core.els.freeResultsOverlay.classList.remove('show');
      });
      document.getElementById('freeReviewPrevBtn')?.addEventListener('click', () => {
        const pos = Core.els.freeReviewPosition.textContent.split('/').map(x => parseInt(x, 10));
        const idx = Math.max(0, (pos[0] || 1) - 2);
        Core.socket.emit('free:series:goto_index', { index: idx });
      });
      document.getElementById('freeReviewNextBtn')?.addEventListener('click', () => {
        const pos = Core.els.freeReviewPosition.textContent.split('/').map(x => parseInt(x, 10));
        const idx = Math.min((pos[1] || 1) - 1, (pos[0] || 1));
        Core.socket.emit('free:series:goto_index', { index: idx });
      });
      document.getElementById('freeReviewCloseBtn')?.addEventListener('click', () => {
        Core.els.freeReviewOverlay.classList.remove('show');
      });
    }
  },
  onQuestion(payload) {
    // Deux cas: question pendant série/single, ou ouverture de review
    if (payload.phase === 'review') {
      Core.els.freeReviewPosition.textContent = `${payload.index + 1}/${payload.total}`;
      Core.els.freeReviewQuestion.textContent = payload.question;
      const list = Core.els.freeReviewList;
      list.innerHTML = '';
      (payload.items || []).forEach(item => {
        const row = document.createElement('div');
        row.className = 'free-item' + (item.validated ? ' validated' : '');
        const who = document.createElement('div'); who.className = 'free-who'; who.textContent = item.name;
        const text = document.createElement('div'); text.className = 'free-text'; text.textContent = item.text || '';
        row.appendChild(who); row.appendChild(text);
        row.addEventListener('click', () => { Core.socket.emit('free:toggle_validate', { name: item.name }); });
        list.appendChild(row);
      });
      Core.els.freeReviewOverlay.classList.add('show');
      return;
    }

    const freeInfo = document.getElementById('freeInfo');
    if (typeof payload.index === 'number' && typeof payload.total === 'number') {
      freeInfo.textContent = `Question ${payload.index + 1}/${payload.total} en cours (${payload.seconds}s)`;
      // Planifie la question suivante lorsque le timer est terminé
      setTimeout(() => {
        Core.hideQuestionOverlay();
        setTimeout(() => Core.socket.emit('free:series:next_question'), 400);
      }, payload.seconds * 1000);
    } else {
      freeInfo.textContent = `Question en cours (${payload.seconds}s)`;
    }
  },
  onProgress({ name, validated, context }) {
    // Toggle visuel dans overlay single ou review
    const list = context === 'review' ? Core.els.freeReviewList : Core.els.freeResultsList;
    const rows = list.querySelectorAll('.free-item');
    rows.forEach(r => {
      const who = r.querySelector('.free-who');
      if (who && who.textContent === name) r.classList.toggle('validated', !!validated);
    });
  },
  onResult({ question, items }) {
    // Single results
    const list = Core.els.freeResultsList;
    list.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'hint';
    title.style.marginBottom = '.6rem';
    title.textContent = `Question: ${question}`;
    list.appendChild(title);

    (items || []).forEach(item => {
      const row = document.createElement('div');
      row.className = 'free-item' + (item.validated ? ' validated' : '');
      const who = document.createElement('div'); who.className = 'free-who'; who.textContent = item.name;
      const text = document.createElement('div'); text.className = 'free-text'; text.textContent = item.text || '';
      row.appendChild(who); row.appendChild(text);
      row.addEventListener('click', () => { Core.socket.emit('free:toggle_validate', { name: item.name }); });
      list.appendChild(row);
    });

    Core.els.freeResultsOverlay.classList.add('show');
  },
  onClose() {}
});
