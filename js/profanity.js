/* ============================================================
   ProfanityFilter — blocks bad/curse words in leaderboard names.
   It normalizes common evasion tricks before matching a blocklist:
     • leetspeak       sh1t, @ss, f.u.c.k, fu(k   -> letters
     • separators      "f u c k", "s-h-i-t"        -> removed
     • repeated chars  "fuuuck", "shiiit"          -> collapsed
   Tuned for short (≤12 char) player names. Exposes isProfane(name).
   ============================================================ */

const ProfanityFilter = (() => {
  // Curated to catch strong profanity/slurs while avoiding common
  // false positives in real names (e.g. "ass" would block Cassie/class,
  // "hell" would block Michelle — so those mild stems are intentionally out).
  const BLOCKLIST = [
    'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'piss', 'cunt',
    'slut', 'whore', 'douche', 'wank', 'bollock', 'prick', 'twat',
    'dick', 'cock', 'pussy', 'dildo', 'jizz', 'boob', 'penis', 'vagina',
    'porn', 'hentai', 'sex', 'nigger', 'nigga', 'faggot', 'retard',
    'spic', 'chink', 'nazi', 'rape', 'rapist', 'pedo', 'molest', "chingchong"
  ];

  // leetspeak / look-alike characters -> plain letters
  const LEET = {
    '@': 'a', '4': 'a', '8': 'b', '(': 'c', '<': 'c', '3': 'e',
    '1': 'i', '!': 'i', '|': 'i', '0': 'o', '$': 's', '5': 's',
    '7': 't', '+': 't', '9': 'g'
  };

  function normalize(str) {
    let s = String(str).toLowerCase();
    s = s.replace(/./g, ch => LEET[ch] || ch); // map leet look-alikes
    s = s.replace(/[^a-z]/g, '');              // keep letters only (drops spaces, dots, etc.)
    return s;
  }

  // "fuuuck" -> "fuck", "biiitch" -> "bitch"
  const collapse = s => s.replace(/(.)\1+/g, '$1');

  function isProfane(name) {
    const n = normalize(name);
    if (!n) return false;
    const variants = [n, collapse(n)];
    return BLOCKLIST.some(word => variants.some(v => v.includes(word)));
  }

  return { isProfane };
})();
