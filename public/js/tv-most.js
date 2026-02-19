// public/js/tv-most.js
import { GameRegistry, Core } from './tv-core.js';

function renderPodium(podium) {
  const container = document.getElementById('mostPodium');
  container.innerHTML = '';
  const slots = [
    { rank: 2, label: '🥈', cls: 'silver' },
    { rank: 1, label: '🥇', cls: 'gold' },
    { rank: 3, label: '🥉', cls: 'bronze' }
  ];
  slots.forEach((slot) => {
    const item = (podium || []).find((p, idx) => (idx + 1) === slot.rank);
    const card = document.createElement('div');
    card.className = `podium-step ${slot.cls}`;
    card.innerHTML = `
      <div class="podium-medal">${slot.label}</div>
      <div class="podium-name">${item ? item.name : '-'}</div>
      <div class="podium-votes">${item ? item.votes : 0} vote(s)</div>
    `;
    container.appendChild(card);
  });
}

GameRegistry.register('most', {
  onEnter() {
    const startBtn = document.getElementById('mostStartBtn');
    const closeBtn = document.getElementById('mostResultCloseBtn');

    if (!startBtn._wired) {
      startBtn._wired = true;
      startBtn.addEventListener('click', () => {
        const question = document.getElementById('mostQuestion').value.trim();
        const seconds = Math.max(5, Math.min(30, parseInt(document.getElementById('mostSeconds').value || '15', 10)));
        if (!question) {
          alert('Entre une question "Qui est le plus..."');
          return;
        }
        Core.socket.emit('most:start', { question, seconds });
        Core.socket.emit('countdown:start', seconds);
        setTimeout(() => Core.socket.emit('most:close'), seconds * 1000);
      });
    }

    if (!closeBtn._wired) {
      closeBtn._wired = true;
      closeBtn.addEventListener('click', () => {
        document.getElementById('mostPodiumOverlay')?.classList.remove('show');
      });
    }
  },
  onQuestion({ question, seconds }) {
    document.getElementById('mostInfo').textContent = `Question en cours (${seconds}s): ${question}`;
  },
  onProgress() {},
  onResult({ question, podium, totalVotes }) {
    document.getElementById('mostResultQuestion').textContent = question || '';
    document.getElementById('mostVotesMeta').textContent = `Total des votes enregistrés: ${totalVotes || 0}`;
    renderPodium(podium || []);
    document.getElementById('mostPodiumOverlay')?.classList.add('show');
    document.getElementById('mostInfo').textContent = 'Résultats affichés (Top 3).';
  },
  onClose() {}
});
