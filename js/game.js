/* ============================================================
   Game — state machine, round flow, timer, hearts and scoring.
   States: HOME → PLAYING → (round transitions) → GAME_OVER
   ============================================================ */

const Game = (() => {
  const ROUND_SECONDS = 20;
  const MAX_HEARTS = 3;
  const OOPS_MS = 2000;

  let state = 'HOME';            // HOME | PLAYING | TRANSITION | GAME_OVER
  let level = 1;
  let score = 0;
  let hearts = MAX_HEARTS;
  let formula = null;
  let timeLeft = ROUND_SECONDS;
  let retriedThisRound = false;
  let lastTickSecond = -1;
  let rafId = null;
  let lastFrame = 0;
  let onGameOver = null;         // callback(score)

  // ---- DOM ----
  const el = {};
  function cacheDom() {
    el.timer = document.getElementById('timer');
    el.formula = document.getElementById('formula');
    el.score = document.getElementById('score');
    el.level = document.getElementById('level');
    el.hearts = Array.from(document.querySelectorAll('#hearts .heart'));
    el.message = document.getElementById('round-message');
  }

  function init(canvas, gameOverCb) {
    cacheDom();
    onGameOver = gameOverCb;
    Target.init(canvas, handleKnifeResult);
  }

  // ---------- game lifecycle ----------
  function start() {
    level = 1;
    score = 0;
    hearts = MAX_HEARTS;
    retriedThisRound = false;
    state = 'PLAYING';
    updateHud();
    startRound();
    AudioManager.startMusic();
    if (!rafId) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }

  function stop() {
    state = 'HOME';
    AudioManager.stopMusic();
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function startRound() {
    Target.setupLevel(level);
    formula = FormulaGenerator.generate(level, Target.getMaxSafeKnives());
    timeLeft = ROUND_SECONDS;
    lastTickSecond = -1;
    retriedThisRound = false;
    state = 'PLAYING';
    el.formula.innerHTML = formula.html;
    fitFormula();
    hideMessage();
    updateHud();
  }

  // Shrink the formula font until it fits inside the fixed-width box, so long
  // multi-operation equations never spill outside it.
  function fitFormula() {
    const box = el.formula;
    box.style.fontSize = '';                       // back to the CSS default
    const base = parseFloat(getComputedStyle(box).fontSize) || 28;
    // If it overflows, scale the font down in ONE proportional step
    // (clientWidth / scrollWidth). The old loop shrank 1px at a time and read
    // scrollWidth each pass — up to 60 forced layouts per round, which stuttered.
    if (box.scrollWidth > box.clientWidth) {
      const size = Math.max(11, Math.floor(base * box.clientWidth / box.scrollWidth));
      box.style.fontSize = size + 'px';
      // one safety nudge in case rounding left it a hair too wide
      if (box.scrollWidth > box.clientWidth && size > 11) {
        box.style.fontSize = (size - 1) + 'px';
      }
    }
  }

  // ---------- round outcomes ----------
  function submit() {
    if (state !== 'PLAYING' || Target.isKnifeFlying) return;
    if (Target.getKnifeCount() === formula.answer) {
      const gained = retriedThisRound ? 5 : 10;
      score += gained;
      AudioManager.play('correct');
      showMessage(`Correct! +${gained}`, true);
      nextStage(900);
    } else {
      wrongAnswer('Oops, you are wrong! -1 ❤');
    }
  }

  function retry() {
    if (state !== 'PLAYING') return;
    Target.clearKnives();
    retriedThisRound = true;
  }

  function wrongAnswer(msg) {
    loseHeart();
    if (hearts <= 0) return; // loseHeart already ended the game
    AudioManager.play('wrong');
    showMessage(msg, false);
    nextStage(OOPS_MS);
  }

  function nextStage(delayMs) {
    state = 'TRANSITION';
    setTimeout(() => {
      if (state !== 'TRANSITION') return;
      level++;
      startRound();
    }, delayMs);
  }

  function loseHeart() {
    hearts = Math.max(0, hearts - 1);
    updateHud();
    if (hearts <= 0) {
      gameOver();
    }
  }

  function gameOver() {
    state = 'GAME_OVER';
    AudioManager.stopMusic();
    AudioManager.play('wrong');
    hideMessage();
    setTimeout(() => onGameOver && onGameOver(score), 600);
  }

  // ---------- knife handling ----------
  function throwKnife() {
    if (state !== 'PLAYING') return;
    Target.throwKnife();
  }

  function handleKnifeResult(result) {
    if (result === 'stuck') {
      AudioManager.play('knifeHit');
    } else if (result === 'coin') {
      // knife stuck AND collected the bonus coin
      AudioManager.play('knifeHit');
      AudioManager.play('coin');
      score += 10;
      updateHud();
      flashMessage('🪙 +10 bonus!', 1100, true);   // green "good" style, like a correct answer
    } else if (result === 'collision') {
      AudioManager.play('bounce');
      flashMessage('Knives collided! -1 ❤', 900);
      loseHeart();
    } else if (result === 'gap') {
      AudioManager.play('miss');
      flashMessage('Empty space! -1 ❤', 900);
      loseHeart();
    }
  }

  // ---------- main loop ----------
  // Drop frames only to avoid running well above 60fps on 90/120Hz screens.
  // The threshold (12ms) sits BELOW the 60Hz frame interval (16.7ms), so 60Hz
  // frames are never skipped. Using exactly 1000/60 here caused timing jitter to
  // wrongly drop ~half the frames on 60Hz screens — the stutter/"freeze".
  const FRAME_MS = 12;
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const elapsed = now - lastFrame;
    if (elapsed < FRAME_MS) return;   // drop only the extra frames on high-refresh screens
    const dt = Math.min(elapsed / 1000, 0.05);
    lastFrame = now;

    if (state === 'PLAYING') {
      timeLeft -= dt;
      const shown = Math.max(0, Math.ceil(timeLeft));
      el.timer.textContent = shown;
      el.timer.classList.toggle('timer-low', shown <= 5);
      if (shown <= 5 && shown >= 1 && shown !== lastTickSecond) {
        lastTickSecond = shown;
        AudioManager.play('tick');
      }
      if (timeLeft <= 0) {
        wrongAnswer('Oops, you are wrong! -1 ❤');
      }
    }

    if (state === 'PLAYING' || state === 'TRANSITION') {
      Target.update(dt);
      Target.render();
    }
  }

  // ---------- HUD ----------
  function updateHud() {
    el.score.textContent = score;
    el.level.textContent = level;
    el.hearts.forEach((h, i) => h.classList.toggle('lost', i >= hearts));
    el.timer.textContent = Math.max(0, Math.ceil(timeLeft));
  }

  let msgTimer = null;
  function showMessage(text, good) {
    el.message.textContent = text;
    el.message.classList.toggle('good', !!good);
    el.message.classList.remove('hidden');
    if (window.parseEmoji) window.parseEmoji(el.message);   // ❤ / 🪙 → Twemoji
  }
  function flashMessage(text, ms, good) {
    showMessage(text, !!good);
    clearTimeout(msgTimer);
    msgTimer = setTimeout(hideMessage, ms);
  }
  function hideMessage() {
    el.message.classList.add('hidden');
  }

  return {
    init,
    start,
    stop,
    submit,
    retry,
    throwKnife,
    get state() { return state; },
    get score() { return score; }
  };
})();
