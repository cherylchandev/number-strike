/* ============================================================
   AudioManager — all sounds synthesized with the Web Audio API.
   To use real audio files later, fill in AudioManager.files, e.g.:
     AudioManager.files.knifeHit = 'assets/sounds/knife.mp3';
     AudioManager.files.music   = 'assets/sounds/music.mp3';
   Any sound with a file URL plays the file instead of the synth.
   ============================================================ */

const AudioManager = (() => {
  let ctx = null;
  let musicTimer = null;
  let musicGain = null;
  let muted = false;

  // Optional file overrides: { knifeHit, correct, wrong, tick, celebrate, music }
  const files = {};
  const buffers = {};   // decoded audio buffers for file overrides
  let musicEl = null;   // <audio> element used when files.music is set

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async function loadFile(name) {
    if (!files[name] || buffers[name]) return;
    try {
      const res = await fetch(files[name]);
      const data = await res.arrayBuffer();
      buffers[name] = await ensureCtx().decodeAudioData(data);
    } catch (e) {
      console.warn('AudioManager: could not load', files[name], e);
    }
  }

  function playBuffer(name) {
    const c = ensureCtx();
    if (!c || !buffers[name]) return false;
    const src = c.createBufferSource();
    src.buffer = buffers[name];
    src.connect(c.destination);
    src.start();
    return true;
  }

  // ---- synth helpers ----
  function tone(freq, dur, { type = 'square', vol = 0.18, when = 0, slideTo = null } = {}) {
    const c = ensureCtx();
    if (!c || muted) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, { vol = 0.25, when = 0, filterFreq = 2200 } = {}) {
    const c = ensureCtx();
    if (!c || muted) return;
    const t0 = c.currentTime + when;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t0);
  }

  // Soft, warm note: triangle wave + low-pass + a gentle fade-in, so it has
  // no hard electronic edge (same treatment used for the background music).
  function softTone(freq, when, dur, vol = 0.16, cutoff = 2600) {
    const c = ensureCtx();
    if (!c || muted) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(f).connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // ---- named sounds ----
  const synths = {
    knifeHit() {
      noise(0.08, { vol: 0.3, filterFreq: 3000 });
      tone(180, 0.09, { type: 'triangle', vol: 0.25, slideTo: 70 });
    },
    correct() {
      // soft rising C-E-G chime (same happy notes, gentler instrument).
      // Volume raised to ~match the background music's level.
      softTone(523.25, 0,    0.20, 0.40);   // C5
      softTone(659.25, 0.11, 0.20, 0.40);   // E5
      softTone(783.99, 0.22, 0.34, 0.44);   // G5
    },
    wrong() {
      tone(220, 0.3, { type: 'sawtooth', vol: 0.2, slideTo: 110 });
      tone(233, 0.3, { type: 'sawtooth', vol: 0.2, slideTo: 117 });
    },
    tick() {
      tone(1100, 0.05, { type: 'square', vol: 0.12 });
    },
    celebrate() {
      const notes = [523, 587, 659, 784, 880, 1047];
      notes.forEach((n, i) => tone(n, 0.16, { type: 'square', vol: 0.14, when: i * 0.11 }));
      noise(0.5, { vol: 0.08, when: 0.66, filterFreq: 5000 });
    },
    bounce() {
      tone(500, 0.12, { type: 'triangle', vol: 0.2, slideTo: 1200 });
    },
    coin() {
      // bright two-note "ding" for collecting the bonus coin
      tone(988, 0.08, { type: 'triangle', vol: 0.2 });
      tone(1319, 0.2, { type: 'triangle', vol: 0.2, when: 0.07 });
    },
    miss() {
      tone(400, 0.25, { type: 'sine', vol: 0.2, slideTo: 120 });
    }
  };

  function play(name) {
    if (muted) return;
    if (files[name]) {
      if (playBuffer(name)) return;
      loadFile(name); // lazy-load; synth covers this play
    }
    if (synths[name]) synths[name]();
  }

  // ============================================================
  //  Background music — an original, happy "party" tune, fully
  //  synthesized here (no external/online audio is used, so there is
  //  nothing to attribute). It is a 24-bar arrangement (~45s at 128 BPM)
  //  with drums, a bouncy bass, chord stabs and a melody across three
  //  sections (A / B / bridge) so it stays fun without obviously looping.
  //  Scheduled with a Web-Audio lookahead clock for steady timing.
  // ============================================================
  const MUSIC_BPM = 128;
  const STEPS_PER_BAR = 16;                 // sixteenth-note resolution
  const MUSIC_BARS = 24;

  // I–V–vi–IV style party progression, with a brighter bridge at the end.
  const PROG = [
    'C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F',   // A
    'F', 'G', 'C', 'G', 'F', 'G', 'Am', 'G',    // B
    'Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'G'    // bridge
  ];
  const CHORDS = {
    C:  { bass: 'C2', pad: ['C4', 'E4', 'G4'] },
    G:  { bass: 'G2', pad: ['G3', 'B3', 'D4'] },
    Am: { bass: 'A2', pad: ['A3', 'C4', 'E4'] },
    F:  { bass: 'F2', pad: ['F3', 'A3', 'C4'] }
  };
  // Melody: 8 eighth-notes per bar; '-' sustains the previous note, 0 = rest.
  const MELODY = [
    ['G4','C5','E5','G5','-','E5','C5','D5'],
    ['B4','D5','G5','-','-','D5','B4','G4'],
    ['A4','C5','E5','A5','-','E5','C5','B4'],
    ['A4','C5','F5','-','-','A5','G5','F5'],
    ['G4','C5','E5','G5','-','E5','G5','C6'],
    ['B5','-','G5','D5','-','B4','D5','G5'],
    ['C6','-','A5','E5','-','A5','C6','B5'],
    ['A5','-','F5','A5','-','G5','E5','C5'],
    ['F5','G5','A5','-','F5','-','C5','-'],
    ['G5','A5','B5','-','G5','-','D5','-'],
    ['C6','B5','G5','E5','-','G5','C6','-'],
    ['D6','-','B5','G5','-','D5','G5','-'],
    ['A5','F5','A5','C6','-','A5','F5','-'],
    ['B5','G5','B5','D6','-','B5','G5','-'],
    ['C6','A5','E5','A5','-','C6','B5','A5'],
    ['G5','-','D5','G5','-','B4','D5','-'],
    ['E5','-','A5','-','C6','-','B5','-'],
    ['A5','-','F5','-','A5','-','C6','-'],
    ['G5','-','E5','-','C5','-','G5','-'],
    ['D5','-','G5','-','B5','-','D6','-'],
    ['E5','A5','C6','B5','-','A5','E5','-'],
    ['F5','A5','C6','-','A5','-','F5','-'],
    ['G5','B5','D6','-','B5','-','G5','-'],
    ['D6','B5','G5','D5','-','G5','B5','-']
  ];

  const NOTE_SEMI = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };
  function noteFreq(name) {
    if (!name) return 0;
    const m = /^([A-G]#?)(\d)$/.exec(name);
    if (!m) return 0;
    const semi = NOTE_SEMI[m[1]] + (parseInt(m[2], 10) - 4) * 12; // semitones from C4
    return 440 * Math.pow(2, (semi - 9) / 12);                    // A4 = 440
  }

  let musicComp = null;
  let musicLP = null;   // master low-pass: rounds off harsh highs for a softer tone
  let schedStep = 0;
  let schedTime = 0;
  let secPerStep = 0;

  function shortNoise(dur) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function mGain(time, peak, dur, attack) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
    g.connect(musicGain);
    return g;
  }

  function mBass(freq, time, dur) {
    // triangle = round, warm bass (was sawtooth = buzzy/electronic)
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 450;
    o.connect(f).connect(mGain(time, 0.4, dur, 0.012));
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  function mLead(freq, time, dur) {
    // soft triangle + low-pass + a gentle attack → flute/music-box feel
    // (was a square wave, which is what made the melody sound electronic)
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    // subtle vibrato for warmth, lighter than before
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vibGain = ctx.createGain();
    vibGain.gain.value = freq * 0.004;
    vib.connect(vibGain).connect(o.frequency);
    o.connect(f).connect(mGain(time, 0.2, dur, 0.022));
    vib.start(time); o.start(time);
    vib.stop(time + dur + 0.05); o.stop(time + dur + 0.05);
  }

  function mPad(names, time, dur) {
    names.forEach(n => {
      // sine = the softest, mellowest chord bed
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = noteFreq(n);
      o.connect(mGain(time, 0.06, dur, 0.05));
      o.start(time);
      o.stop(time + dur + 0.05);
    });
  }

  function mKick(time) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.17);
    o.connect(g).connect(musicGain);
    o.start(time);
    o.stop(time + 0.2);
  }

  function mHat(time, peak) {
    // softer, less piercing shaker (lower cutoff + quieter than before)
    const dur = 0.03;
    const s = ctx.createBufferSource();
    s.buffer = shortNoise(dur);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    s.connect(f).connect(g).connect(musicGain);
    s.start(time);
  }

  function mClap(time) {
    const dur = 0.12;
    const s = ctx.createBufferSource();
    s.buffer = shortNoise(dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    s.connect(f).connect(g).connect(musicGain);
    s.start(time);
  }

  function scheduleMusicStep(step, time) {
    const bar = Math.floor(step / STEPS_PER_BAR) % MUSIC_BARS;
    const inBar = step % STEPS_PER_BAR;
    const chord = CHORDS[PROG[bar]];

    // drums: four-on-the-floor kick, off-beat hats, back-beat claps
    if (inBar % 4 === 0) mKick(time);
    if (inBar % 2 === 0) mHat(time, inBar % 4 === 0 ? 0.05 : 0.03);
    if (inBar === 4 || inBar === 12) mClap(time);

    // bass: bouncy eighths (root on the beat, an octave up off the beat)
    if (inBar % 2 === 0) {
      const up = inBar % 4 === 0 ? 0 : 12;
      mBass(noteFreq(chord.bass) * Math.pow(2, up / 12), time, secPerStep * 2 * 0.9);
    }

    // chord stab on each beat
    if (inBar % 4 === 0) mPad(chord.pad, time, secPerStep * 4 * 0.8);

    // lead melody on the eighth-note grid, with '-' extending the note
    if (inBar % 2 === 0) {
      const mel = MELODY[bar];
      const ei = inBar / 2;
      const tok = mel[ei];
      if (tok && tok !== '-' && tok !== 0) {
        let dur = 2;
        for (let k = ei + 1; k < 8 && mel[k] === '-'; k++) dur += 2;
        mLead(noteFreq(tok), time, secPerStep * dur * 0.95);
      }
    }
  }

  function musicScheduler() {
    // schedule a little ahead of the audio clock for rock-steady timing
    while (schedTime < ctx.currentTime + 0.12) {
      scheduleMusicStep(schedStep, schedTime);
      schedTime += secPerStep;
      schedStep++;
    }
  }

  function startMusic() {
    if (muted) return;
    if (files.music) {
      if (!musicEl) {
        musicEl = new Audio(files.music);
        musicEl.loop = true;
        musicEl.volume = 0.5;
      }
      musicEl.play().catch(() => {});
      return;
    }
    const c = ensureCtx();
    if (!c || musicTimer) return;

    musicGain = c.createGain();
    musicGain.gain.value = 0.48;
    // Warm, soft tone: roll off the harsh upper harmonics before the limiter.
    musicLP = c.createBiquadFilter();
    musicLP.type = 'lowpass';
    musicLP.frequency.value = 3200;
    musicLP.Q.value = 0.4;
    musicComp = c.createDynamicsCompressor(); // keep layered voices from clipping
    musicGain.connect(musicLP).connect(musicComp).connect(c.destination);

    secPerStep = 60 / MUSIC_BPM / 4;
    schedStep = 0;
    schedTime = c.currentTime + 0.1;
    musicTimer = setInterval(musicScheduler, 25);
  }

  function stopMusic() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
    if (musicGain) { musicGain.disconnect(); musicGain = null; }
    if (musicLP) { musicLP.disconnect(); musicLP = null; }
    if (musicComp) { musicComp.disconnect(); musicComp = null; }
    if (musicEl) musicEl.pause();
  }

  function unlock() {
    ensureCtx();
    Object.keys(files).forEach(loadFile);
  }

  return {
    files,
    play,
    startMusic,
    stopMusic,
    unlock,
    setMuted(m) { muted = m; if (m) stopMusic(); },
    get muted() { return muted; }
  };
})();
