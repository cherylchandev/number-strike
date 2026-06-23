/* ============================================================
   main.js — bootstrapping, screen switching and input bindings.
   ============================================================ */

(() => {
  const screens = {
    home: document.getElementById('home-screen'),
    game: document.getElementById('game-screen'),
    ending: document.getElementById('ending-screen')
  };

  const ui = {
    btnPlay: document.getElementById('btn-play'),
    btnInstructions: document.getElementById('btn-instructions'),
    btnCloseInstructions: document.getElementById('btn-close-instructions'),
    instructionsModal: document.getElementById('instructions-modal'),
    canvas: document.getElementById('game-canvas'),
    btnRetry: document.getElementById('btn-retry'),
    btnSubmit: document.getElementById('btn-submit'),
    endingMessage: document.getElementById('ending-message'),
    nameEntry: document.getElementById('name-entry'),
    playerName: document.getElementById('player-name'),
    btnSaveScore: document.getElementById('btn-save-score'),
    leaderboardList: document.getElementById('leaderboard-list'),
    btnPlayAgain: document.getElementById('btn-play-again'),
    btnHome: document.getElementById('btn-home')
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // Twemoji: replace native OS emoji with identical images on every device, so
  // iPhone/Android no longer show their own emoji style. Exposed on window so
  // game.js can re-render emoji in the messages it builds at runtime.
  function parseEmoji(node) {
    if (window.twemoji && node) {
      window.twemoji.parse(node, {
        folder: 'svg',
        ext: '.svg',
        base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/'
      });
    }
  }
  window.parseEmoji = parseEmoji;

  // ---------- home / instructions ----------
  ui.btnPlay.addEventListener('click', () => {
    AudioManager.unlock();
    showScreen('game');
    // canvas only has a size once the game screen is visible
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      Game.start();
    });
  });

  ui.btnInstructions.addEventListener('click', () => {
    ui.instructionsModal.classList.remove('hidden');
  });
  ui.btnCloseInstructions.addEventListener('click', () => {
    ui.instructionsModal.classList.add('hidden');
  });

  // ---------- in-game inputs ----------
  // Click / tap on the canvas throws a knife.
  ui.canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    Game.throwKnife();
  });
  // PC keyboard: Space throws a knife, Enter submits, R retries.
  document.addEventListener('keydown', e => {
    if (!screens.game.classList.contains('active')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      Game.throwKnife();
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      Game.submit();
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      Game.retry();
    }
  });

  ui.btnSubmit.addEventListener('click', () => Game.submit());
  ui.btnRetry.addEventListener('click', () => Game.retry());

  // ---------- ending screen ----------
  let pendingScore = 0;
  let pendingRank = null;

  const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

  async function handleGameOver(score) {
    pendingScore = score;
    pendingRank = await Leaderboard.getRank(score);   // 1-5, or null
    Game.stop();
    showScreen('ending');

    if (pendingRank) {
      // one sentence per line
      ui.endingMessage.innerHTML =
        `Congratulations!<br>You are ranked #${pendingRank}!<br>Your score is ${score}.`;
      ui.nameEntry.classList.remove('hidden');
      ui.playerName.value = '';
      ui.btnSaveScore.disabled = false;
      AudioManager.play('celebrate');
    } else {
      ui.endingMessage.textContent = `Your score is ${score}.`;
      ui.nameEntry.classList.add('hidden');
    }
    await renderLeaderboard();
  }

  async function renderLeaderboard(highlight) {
    // pass the just-submitted entry so it shows immediately even if Firestore
    // hasn't echoed the write back yet (notably on mobile networks)
    const top = await Leaderboard.getTopRanked(highlight);
    ui.leaderboardList.innerHTML = '';
    top.forEach(entry => {
      const li = document.createElement('li');
      if (highlight && entry.name === highlight.name && entry.score === highlight.score) {
        li.classList.add('me');
        highlight = null; // highlight only the first match
      }
      const rank = document.createElement('span');
      rank.className = 'rank';
      if (MEDALS[entry.rank]) {
        rank.classList.add('medal');
        rank.textContent = MEDALS[entry.rank];
      } else {
        rank.textContent = `${entry.rank}`;
      }
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = entry.name;
      const score = document.createElement('span');
      score.textContent = entry.score;
      li.append(rank, name, score);
      ui.leaderboardList.appendChild(li);
    });
    if (!top.length) {
      const li = document.createElement('li');
      li.textContent = 'No scores yet — be the first!';
      ui.leaderboardList.appendChild(li);
    }
    parseEmoji(ui.leaderboardList);   // convert the 🥇🥈🥉 medals to Twemoji
  }

  const nameWarning = document.getElementById('name-warning');

  ui.btnSaveScore.addEventListener('click', async () => {
    const name = ui.playerName.value.trim() || 'Player';
    // block bad/curse words before anything is saved
    if (ProfanityFilter.isProfane(name)) {
      nameWarning.classList.remove('hidden');
      ui.playerName.focus();
      return;
    }
    nameWarning.classList.add('hidden');
    ui.btnSaveScore.disabled = true;
    await Leaderboard.submitScore(name, pendingScore);
    ui.nameEntry.classList.add('hidden');
    await renderLeaderboard({ name, score: pendingScore });
  });
  ui.playerName.addEventListener('input', () => nameWarning.classList.add('hidden'));
  ui.playerName.addEventListener('keydown', e => {
    if (e.key === 'Enter') ui.btnSaveScore.click();
    e.stopPropagation(); // don't let Space throw knives while typing
  });

  ui.btnPlayAgain.addEventListener('click', () => {
    showScreen('game');
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      Game.start();
    });
  });

  ui.btnHome.addEventListener('click', () => {
    Game.stop();
    showScreen('home');
  });

  // ---------- boot ----------
  // Load the knife sprite; it replaces the drawn knife once ready.
  const knifeImg = new Image();
  knifeImg.onload = () => Target.setKnifeImage(knifeImg);
  knifeImg.src = 'assets/images/knife.png';

  Game.init(ui.canvas, handleGameOver);
  showScreen('home');
  parseEmoji(document.body);   // convert all static emoji (hearts, knife, buttons, 🏆) once at boot
})();
