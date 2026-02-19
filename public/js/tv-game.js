import { Core } from './tv-core.js';

const GAME_DEFS = [
  { id: 'quiz', label: 'Quiz Vrai/Faux', bankUrl: '/questions.json', defaults: { count: 3, seconds: 10 } },
  { id: 'guess', label: 'Devine le nombre', bankUrl: '/guess-questions.json', defaults: { count: 3, seconds: 10 } },
  { id: 'free', label: 'Réponse libre', bankUrl: '/free-questions.json', defaults: { count: 5, seconds: 10 } },
  { id: 'most', label: 'Qui est le plus', bankUrl: '/most-questions.json', defaults: { count: 3, seconds: 15 } }
];

const state = {
  running: false,
  stopRequested: false,
  banks: new Map(),
  selectedOrder: [],
  configByGameId: new Map()
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function clamp(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getGameDef(gameId) {
  return GAME_DEFS.find((g) => g.id === gameId) || null;
}

function ensureConfig(gameId) {
  if (!state.configByGameId.has(gameId)) {
    const def = getGameDef(gameId);
    if (!def) return null;
    state.configByGameId.set(gameId, { count: def.defaults.count, seconds: def.defaults.seconds });
  }
  return state.configByGameId.get(gameId);
}

function isSelected(gameId) {
  return state.selectedOrder.includes(gameId);
}

function toggleGame(gameId) {
  if (isSelected(gameId)) {
    state.selectedOrder = state.selectedOrder.filter((id) => id !== gameId);
  } else {
    state.selectedOrder.push(gameId);
    ensureConfig(gameId);
  }
  renderBuilder();
}

function moveGame(gameId, delta) {
  const index = state.selectedOrder.indexOf(gameId);
  if (index < 0) return;
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= state.selectedOrder.length) return;
  const nextOrder = [...state.selectedOrder];
  [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
  state.selectedOrder = nextOrder;
  renderBuilder();
}

function setConfig(gameId, field, value) {
  const cfg = ensureConfig(gameId);
  if (!cfg) return;
  if (field === 'count') cfg.count = clamp(value, 1, 50, cfg.count);
  if (field === 'seconds') cfg.seconds = clamp(value, 5, 45, cfg.seconds);
}

function getPlan() {
  return state.selectedOrder.map((gameId) => {
    const cfg = ensureConfig(gameId);
    return {
      id: gameId,
      count: clamp(cfg?.count, 1, 50, 3),
      seconds: clamp(cfg?.seconds, 5, 45, 10)
    };
  });
}

function renderAvailableList() {
  const list = document.getElementById('gameBuilderList');
  if (!list) return;
  list.innerHTML = '';

  GAME_DEFS.forEach((g) => {
    const selected = isSelected(g.id);
    const item = document.createElement('div');
    item.className = 'game-builder-list-item';
    item.innerHTML = `
      <div>
        <div><strong>${g.label}</strong></div>
        <div class="hint">Banque: ${g.bankUrl.replace('/', '')}</div>
      </div>
      <button type="button" class="${selected ? '' : 'btn-cyan'}">${selected ? 'Retirer' : 'Ajouter'}</button>
    `;
    item.querySelector('button')?.addEventListener('click', () => toggleGame(g.id));
    list.appendChild(item);
  });
}

function renderConfigList() {
  const configWrap = document.getElementById('gameBuilderConfig');
  const summary = document.getElementById('gameBuilderSummary');
  const startBtn = document.getElementById('gameBuilderStartBtn');
  if (!configWrap) return;

  const plan = getPlan();
  const totalQ = plan.reduce((sum, p) => sum + p.count, 0);
  if (summary) {
    summary.textContent = plan.length
      ? `${plan.length} jeu(x) • ${totalQ} question(s)`
      : 'Aucun jeu sélectionné';
  }
  if (startBtn) startBtn.disabled = plan.length === 0;

  configWrap.innerHTML = '';
  if (!plan.length) {
    const empty = document.createElement('div');
    empty.className = 'game-builder-empty';
    empty.textContent = 'Ajoute des jeux depuis la colonne de gauche.';
    configWrap.appendChild(empty);
    return;
  }

  plan.forEach((step, index) => {
    const def = getGameDef(step.id);
    const item = document.createElement('div');
    item.className = 'game-builder-config-item';
    item.setAttribute('data-game-id', step.id);
    item.innerHTML = `
      <div class="game-builder-config-head">
        <div>
          <div class="game-builder-order">#${index + 1}</div>
          <strong>${def ? def.label : step.id}</strong>
        </div>
        <div class="btn-row" style="gap:.35rem;">
          <button type="button" data-act="up" title="Monter">↑</button>
          <button type="button" data-act="down" title="Descendre">↓</button>
          <button type="button" data-act="remove" title="Retirer">✖</button>
        </div>
      </div>
      <div class="game-builder-config-grid">
        <div class="field">
          <label>Nombre de questions</label>
          <input data-field="count" type="number" min="1" max="50" value="${step.count}" />
        </div>
        <div class="field">
          <label>Durée / question (secondes)</label>
          <input data-field="seconds" type="number" min="5" max="45" value="${step.seconds}" />
        </div>
      </div>
    `;

    item.querySelector('[data-act="up"]')?.addEventListener('click', () => moveGame(step.id, -1));
    item.querySelector('[data-act="down"]')?.addEventListener('click', () => moveGame(step.id, +1));
    item.querySelector('[data-act="remove"]')?.addEventListener('click', () => toggleGame(step.id));

    item.querySelector('[data-field="count"]')?.addEventListener('change', (ev) => {
      setConfig(step.id, 'count', ev.target.value);
      renderConfigList();
    });
    item.querySelector('[data-field="seconds"]')?.addEventListener('change', (ev) => {
      setConfig(step.id, 'seconds', ev.target.value);
      renderConfigList();
    });

    configWrap.appendChild(item);
  });
}

function renderBuilder() {
  renderAvailableList();
  renderConfigList();
}

async function loadBank(url) {
  if (state.banks.has(url)) return state.banks.get(url);
  const u = new URL(url, window.location.origin);
  u.searchParams.set('t', String(Date.now()));
  const res = await fetch(u.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const items = Array.isArray(data) ? data : [];
  state.banks.set(url, items);
  return items;
}

function sample(items, count) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, count));
}

function openBuilder() {
  renderBuilder();
  document.getElementById('gameBuilderOverlay')?.classList.add('show');
}

function closeBuilder() {
  document.getElementById('gameBuilderOverlay')?.classList.remove('show');
}

async function runQuiz(item, seconds) {
  const q = String(item.q || '').trim();
  if (!q) return;
  Core.socket.emit('quiz:start', { question: q, correct: !!item.a, seconds });
  Core.socket.emit('countdown:start', seconds);
  await sleep(seconds * 1000);
  Core.socket.emit('quiz:close');
}

async function runGuess(item, seconds) {
  const q = String(item.q || '').trim();
  if (!q) return;
  const min = Number.isFinite(Number(item.min)) ? Number(item.min) : 0;
  const max = Number.isFinite(Number(item.max)) ? Number(item.max) : 100;
  const correct = Number.isFinite(Number(item.c)) ? Number(item.c) : min;
  Core.socket.emit('guess:start', { question: q, correct, min, max, seconds });
  Core.socket.emit('countdown:start', seconds);
  await sleep(seconds * 1000);
  Core.socket.emit('guess:close');
}

async function runFree(item, seconds) {
  const q = String(item.q || '').trim();
  if (!q) return;
  Core.socket.emit('free:start', { question: q, seconds, answer: String(item.a || '') });
  Core.socket.emit('countdown:start', seconds);
  await sleep(seconds * 1000);
  Core.socket.emit('free:close');
}

async function runMost(item, seconds) {
  const q = String(item.q || '').trim();
  if (!q) return;
  Core.socket.emit('most:start', { question: q, seconds });
  Core.socket.emit('countdown:start', seconds);
  await sleep(seconds * 1000);
  Core.socket.emit('most:close');
}

async function runGame(step, globalIndex, globalTotal) {
  const def = getGameDef(step.id);
  if (!def) return;
  const bank = await loadBank(def.bankUrl);
  if (!bank.length) return;
  const questions = sample(bank, Math.min(step.count, bank.length));
  for (let i = 0; i < questions.length; i++) {
    if (state.stopRequested) return;
    Core.showProgress(`GAME: ${globalIndex + i + 1}/${globalTotal} • ${def.label}`);
    if (def.id === 'quiz') await runQuiz(questions[i], step.seconds);
    else if (def.id === 'guess') await runGuess(questions[i], step.seconds);
    else if (def.id === 'free') await runFree(questions[i], step.seconds);
    else if (def.id === 'most') await runMost(questions[i], step.seconds);
    await sleep(1000);
  }
}

async function startGamePlan() {
  if (state.running) return;
  const plan = getPlan();
  if (!plan.length) {
    alert('Sélectionne au moins un jeu pour la GAME.');
    return;
  }

  closeBuilder();
  state.running = true;
  state.stopRequested = false;

  try {
    const totalQuestions = plan.reduce((sum, p) => sum + p.count, 0);
    let done = 0;
    for (const step of plan) {
      if (state.stopRequested) break;
      await runGame(step, done, totalQuestions);
      done += step.count;
    }
    Core.showProgress(state.stopRequested ? 'GAME interrompue' : 'GAME terminée ✅');
    await sleep(1400);
  } catch {
    Core.showProgress('Erreur pendant la GAME');
    await sleep(1400);
  } finally {
    Core.hideProgress();
    state.running = false;
    state.stopRequested = false;
  }
}

function wire() {
  const btn = document.getElementById('gameBuilderBtn');
  const closeBtn = document.getElementById('gameBuilderCloseBtn');
  const startBtn = document.getElementById('gameBuilderStartBtn');
  const overlay = document.getElementById('gameBuilderOverlay');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';

  btn.addEventListener('click', openBuilder);
  closeBtn?.addEventListener('click', closeBuilder);
  startBtn?.addEventListener('click', startGamePlan);
  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeBuilder();
  });

  document.getElementById('overlayStopBtn')?.addEventListener('click', () => {
    if (state.running) state.stopRequested = true;
  });

  if (!state.selectedOrder.length) {
    state.selectedOrder = ['quiz'];
    ensureConfig('quiz');
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', wire, { once: true });
} else {
  wire();
}
