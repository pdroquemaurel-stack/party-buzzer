import { Core } from './tv-core.js';

const GAME_DEFS = [
  { id: 'quiz', label: 'Quiz Vrai/Faux', bankUrl: '/questions.json' },
  { id: 'guess', label: 'Devine le nombre', bankUrl: '/guess-questions.json' },
  { id: 'free', label: 'Réponse libre', bankUrl: '/free-questions.json' },
  { id: 'most', label: 'Qui est le plus', bankUrl: '/most-questions.json' }
];

const state = {
  running: false,
  stopRequested: false,
  banks: new Map()
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
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

function parsePlan() {
  const rows = document.querySelectorAll('.game-builder-row');
  const plan = [];
  rows.forEach((row) => {
    const id = row.getAttribute('data-game-id');
    const enabled = row.querySelector('input[type="checkbox"]')?.checked;
    if (!enabled) return;
    const count = clamp(row.querySelector('[data-field="count"]')?.value, 1, 50, 3);
    const seconds = clamp(row.querySelector('[data-field="seconds"]')?.value, 5, 45, 10);
    plan.push({ id, count, seconds });
  });
  return plan;
}

function buildRows() {
  const rowsWrap = document.getElementById('gameBuilderRows');
  if (!rowsWrap || rowsWrap.childElementCount > 0) return;
  GAME_DEFS.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'game-builder-row';
    row.setAttribute('data-game-id', g.id);
    row.innerHTML = `
      <div class="field">
        <label><input type="checkbox" data-field="enabled" ${g.id === 'quiz' ? 'checked' : ''} /> ${g.label}</label>
      </div>
      <div class="field">
        <label>Nombre de questions</label>
        <input data-field="count" type="number" min="1" max="50" value="${g.id === 'free' ? 5 : 3}" />
      </div>
      <div class="field">
        <label>Durée par question (secondes)</label>
        <input data-field="seconds" type="number" min="5" max="45" value="${g.id === 'most' ? 15 : 10}" />
      </div>
    `;
    rowsWrap.appendChild(row);
  });
}

function openBuilder() {
  buildRows();
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

async function runGame(planItem, globalIndex, globalTotal) {
  const def = GAME_DEFS.find((g) => g.id === planItem.id);
  if (!def) return;
  const bank = await loadBank(def.bankUrl);
  if (!bank.length) return;
  const questions = sample(bank, Math.min(planItem.count, bank.length));
  for (let i = 0; i < questions.length; i++) {
    if (state.stopRequested) return;
    Core.showProgress(`GAME: ${globalIndex + i + 1}/${globalTotal} • ${def.label}`);
    if (def.id === 'quiz') await runQuiz(questions[i], planItem.seconds);
    else if (def.id === 'guess') await runGuess(questions[i], planItem.seconds);
    else if (def.id === 'free') await runFree(questions[i], planItem.seconds);
    else if (def.id === 'most') await runMost(questions[i], planItem.seconds);
    await sleep(1000);
  }
}

async function startGamePlan() {
  if (state.running) return;
  const plan = parsePlan();
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
    for (const item of plan) {
      if (state.stopRequested) break;
      await runGame(item, done, totalQuestions);
      done += item.count;
    }
    Core.showProgress(state.stopRequested ? 'GAME interrompue' : 'GAME terminée ✅');
    await sleep(1400);
  } catch (err) {
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
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', wire, { once: true });
} else {
  wire();
}
