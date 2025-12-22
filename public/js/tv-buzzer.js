// public/js/tv-buzzer.js
import { GameRegistry } from './tv-core.js';
import { GAME_EVENTS } from './types.js';

GameRegistry.register('buzzer', {
  onEnter() {
    // Rien de spécial à l'entrée
  },
  onQuestion(payload) {
    // round:open -> payload.opened === true
    // Boutons
    const startBtn = document.getElementById('startRoundBtn');
    const resetBtn = document.getElementById('resetRoundBtn');
    startBtn.onclick = () => {
      // 3-2-1 puis ouvrir
      import('./tv-core.js').then(({ Core }) => {
        Core.startCountdown(3, () => Core.socket.emit('buzz:open'));
      });
    };
    resetBtn.onclick = () => {
      import('./tv-core.js').then(({ Core }) => Core.socket.emit('round:reset'));
    };
  },
  onResult(data) {
    // Affichage overlay géré par le core (winnerName + overlay.show)
  },
  onClose() {}
});
