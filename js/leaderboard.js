/* ============================================================
   Leaderboard — Top 10 scores with dense (tie-aware) ranking.
   Players sharing a score share a rank, and the next rank is not
   skipped (e.g. 100, 100, 90  ->  ranks 1, 1, 2).
   Uses Firebase Firestore when js/firebase-config.js holds a real
   config; otherwise falls back to localStorage so the game works
   out of the box.
   Interface: getTopRanked(), submitScore(name, score), getRank(score)
   ============================================================ */

const Leaderboard = (() => {
  const TOP_RANKS = 10;         // only ranks 1-10 are shown / eligible
  const STORE_N = 50;           // keep extra rows so ties at rank 10 aren't lost
  const LS_KEY = 'numberStrike.leaderboard';

  const firebaseReady =
    typeof firebase !== 'undefined' &&
    typeof FIREBASE_CONFIG !== 'undefined' &&
    FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';

  let db = null;
  if (firebaseReady) {
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      console.log('%cLeaderboard: connected to Firebase Firestore ✅', 'color:green;font-weight:bold');
    } catch (e) {
      console.warn('Leaderboard: Firebase init failed, using localStorage.', e);
    }
  } else {
    console.warn('Leaderboard: Firebase not configured — using localStorage fallback.');
  }

  // ---------- localStorage backend ----------
  function lsGet() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || [];
    } catch {
      return [];
    }
  }
  function lsSave(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  }

  // ---------- public API ----------
  // Sorted (desc) entries, capped at STORE_N so we can rank ties correctly.
  async function getTopScores() {
    if (db) {
      try {
        const snap = await db.collection('leaderboard')
          .orderBy('score', 'desc')
          .orderBy('createdAt', 'desc')   // newest first when scores tie
          .limit(STORE_N)
          .get();
        return snap.docs.map(d => ({ name: d.data().name, score: d.data().score }));
      } catch (e) {
        console.warn('Leaderboard: Firestore read failed, using localStorage.', e);
      }
    }
    return lsGet()
      // score desc, then newest first on ties (matches the Firestore order)
      .sort((a, b) => b.score - a.score || (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, STORE_N);
  }

  // Mask any bad name that may already be stored (e.g. saved before the filter
  // existed, or from another device) so it never shows on screen.
  const cleanName = n =>
    (typeof ProfanityFilter !== 'undefined' && ProfanityFilter.isProfane(n)) ? 'Player' : n;

  // Entries within ranks 1-5 (dense ranking), each annotated with .rank.
  // `pending` (optional) is an entry the player just submitted. Firestore reads
  // can lag a moment behind a write (more noticeably on mobile), so we fold it
  // into the list when it isn't back yet — the player always sees their score.
  async function getTopRanked(pending) {
    let top = await getTopScores();
    if (pending &&
        !top.some(e => e.name === pending.name && e.score === pending.score)) {
      top = [...top, { name: pending.name, score: pending.score, createdAt: Date.now() }]
        .sort((a, b) => b.score - a.score || (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, STORE_N);
    }
    const out = [];
    let rank = 0, lastScore = null;
    for (const entry of top) {
      if (entry.score !== lastScore) { rank++; lastScore = entry.score; }
      if (rank > TOP_RANKS) break;
      out.push({ name: cleanName(entry.name), score: entry.score, rank });
    }
    return out;
  }

  async function submitScore(name, score) {
    name = String(name || 'Player').trim().slice(0, 20) || 'Player';
    // defense in depth: never store a bad word even if the UI check is bypassed
    if (typeof ProfanityFilter !== 'undefined' && ProfanityFilter.isProfane(name)) {
      name = 'Player';
    }
    if (db) {
      try {
        await db.collection('leaderboard').add({
          name,
          score,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return;
      } catch (e) {
        console.warn('Leaderboard: Firestore write failed, saving locally.', e);
      }
    }
    const list = lsGet();
    list.push({ name, score, createdAt: Date.now() });
    list.sort((a, b) => b.score - a.score || (b.createdAt || 0) - (a.createdAt || 0));
    lsSave(list.slice(0, STORE_N));
  }

  /**
   * Dense rank a score would take on the board (1-based), counting only
   * distinct higher scores so ties share a rank. Returns null if the score
   * is 0 or would fall outside the top 10.
   */
  async function getRank(score) {
    if (score <= 0) return null;
    const top = await getTopScores();
    const higher = new Set();
    for (const entry of top) if (entry.score > score) higher.add(entry.score);
    const rank = higher.size + 1;
    return rank <= TOP_RANKS ? rank : null;
  }

  return { getTopScores, getTopRanked, submitScore, getRank, get usingFirebase() { return !!db; } };
})();
