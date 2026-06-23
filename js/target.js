/* ============================================================
   Target — the spinning oak, thrown knives, slices and collision.

   All graphics are drawn with canvas. To swap in sprite images later,
   set Target.assets.wood / Target.assets.knife to a loaded Image and
   the draw functions will use them instead of the drawn shapes.

   Angle conventions: wood rotation increases clockwise; a knife's
   stored angle is its position on the wood rim relative to the wood's
   own frame, so knives rotate together with the wood.
   ============================================================ */

const Target = (() => {
  const TAU = Math.PI * 2;
  const MIN_KNIFE_GAP = TAU / 40;      // min angular spacing between knives (9°),
                                       // matched to the knife's real visible width
                                       // so only genuinely touching knives collide
  const KNIFE_FLY_SPEED = 2200;        // px / second
  const POINT_DOWN = Math.PI / 2;      // rim angle facing the thrower (bottom)
  const KNIFE_LEN = 84;                // knife height in sprite units (× scale s)
  const KNIFE_TIP_R = 0.995;           // stuck-knife tip radius (× woodR): just touches rim

  // Optional sprite overrides: { wood: Image, knife: Image }
  const assets = {};

  let canvas = null, ctx = null;
  let W = 0, H = 0, dpr = 1;

  // wood state
  let woodX = 0, woodY = 0, woodR = 100;
  let rotation = 0;            // current wood rotation (radians)
  let direction = 1;           // 1 = clockwise, -1 = anti-clockwise
  let baseSpeed = 1.6;         // radians/sec, scales with level
  let speedPhase = 0;          // drives the spin → slow → spin cycle
  let gaps = [];               // removed sectors: { start, span } in wood frame
  let grainSeed = 1;

  // knives
  let stuckKnives = [];        // angles in wood frame
  let flyingKnife = null;      // { y } while animating
  let fallingKnives = [];      // rejected knives: { x, y, vx, vy, rot, vr }
  let knifeSprite = null;      // pre-scaled offscreen knife: { canvas, wCss, hCss }
  let woodSprite = null;       // pre-rendered wood disc (rebuilt per level / resize)
  let woodSpriteHalf = 0;      // half-size (css px) of the wood sprite
  let coin = null;             // bonus coin on a small wood sliver: { angle, halfSpan, collected }
  let coinSprite = null;       // pre-rendered coin image: { canvas, half }

  let onKnifeResult = null;    // callback(result: 'stuck'|'collision'|'gap')

  // ---------- setup ----------
  function init(canvasEl, resultCallback) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    onKnifeResult = resultCallback;
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    // cap at 2: retina iPads/phones are already crisp at 2x, and 3x triples the
    // per-frame pixel work for no visible gain — a common source of canvas lag
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;     // reset by canvas resize
    ctx.imageSmoothingQuality = 'high';
    // Centered horizontally; placed as high as possible while keeping the
    // stuck knives (which jut OUTWARD past the rim by one knife-length) from
    // overlapping the formula box at the top.
    woodX = W / 2;
    woodR = Math.min(W, H) * 0.17;
    const knifeLen = KNIFE_LEN * woodR / 100;     // how far a knife sticks out
    const formulaBottom = W <= 700 ? 185 : 80;    // approx bottom of the formula box
    const oakTopGap = formulaBottom + knifeLen + 18;
    woodY = oakTopGap + woodR;
    buildKnifeSprite();                   // re-scale knife for the new size
    buildWoodSprite();                    // re-render the wood at the new size
    buildCoinSprite();                    // re-render the coin at the new size
  }

  // Provide / swap the knife sprite (called once the image has loaded).
  function setKnifeImage(img) {
    assets.knife = img;
    buildKnifeSprite();
  }

  // Pre-scale the high-res knife image down to its on-screen size once,
  // using stepped halving so edges stay smooth instead of aliasing from a
  // single large downscale. Rendered at device pixels to stay crisp on HiDPI.
  function buildKnifeSprite() {
    const img = assets.knife;
    if (!img || !img.complete || !img.naturalWidth || !woodR) { knifeSprite = null; return; }
    const s = woodR / 100;
    const hCss = KNIFE_LEN * s;
    const wCss = hCss * (img.naturalWidth / img.naturalHeight);
    const wDev = Math.max(1, Math.round(wCss * dpr));
    const hDev = Math.max(1, Math.round(hCss * dpr));

    let srcW = img.naturalWidth, srcH = img.naturalHeight;
    let cur = img;
    // halve repeatedly until within 2x of the target, then final resample
    while (srcW > wDev * 2 && srcH > hDev * 2) {
      const nW = Math.max(wDev, Math.floor(srcW / 2));
      const nH = Math.max(hDev, Math.floor(srcH / 2));
      const step = makeCanvas(nW, nH);
      step.ctx.drawImage(cur, 0, 0, srcW, srcH, 0, 0, nW, nH);
      cur = step.canvas; srcW = nW; srcH = nH;
    }
    const out = makeCanvas(wDev, hDev);
    out.ctx.drawImage(cur, 0, 0, srcW, srcH, 0, 0, wDev, hDev);
    knifeSprite = { canvas: out.canvas, wCss, hCss };
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    return { canvas: c, ctx: cx };
  }

  // Render the (rotation-free) wood disc once per level into an offscreen canvas.
  // The frame loop then just blits + rotates this image instead of rebuilding the
  // path, clip and tree-rings every frame — the main perf win on iPad / retina.
  function buildWoodSprite() {
    if (!woodR) { woodSprite = null; return; }
    const margin = Math.ceil(woodR * 0.08) + 4;   // room for the outline stroke
    woodSpriteHalf = woodR + margin;
    // supersample at 2x device pixels so the outline stays sharp once the frame
    // loop rotates the sprite — rotating a 1x bitmap softens its edges
    const scale = dpr * 2;
    const px = Math.max(1, Math.ceil(woodSpriteHalf * 2 * scale));
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const cx = c.getContext('2d');
    cx.setTransform(scale, 0, 0, scale, 0, 0);
    cx.translate(woodSpriteHalf, woodSpriteHalf);  // origin at the wood centre
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';

    const woodPath = buildWoodPath();
    cx.save();
    cx.clip(woodPath);
    cx.fillStyle = '#c98e4e';
    cx.fillRect(-woodR, -woodR, woodR * 2, woodR * 2);
    const rings = 5;
    for (let i = rings; i >= 1; i--) {
      const r = (woodR * i) / (rings + 0.3);
      cx.beginPath();
      const wob = Math.sin(grainSeed + i * 1.7) * woodR * 0.015;
      cx.arc(wob, -wob, r, 0, TAU);
      cx.strokeStyle = i % 2 ? '#a9713a' : '#8d5a2b';
      cx.lineWidth = woodR * 0.05;
      cx.stroke();
    }
    cx.restore();

    cx.strokeStyle = '#6e4520';
    cx.lineWidth = Math.max(3, woodR * 0.06);
    cx.lineJoin = 'round';
    cx.lineCap = 'round';
    cx.stroke(woodPath);

    woodSprite = c;
  }

  // ---------- level configuration ----------
  function setupLevel(level) {
    stuckKnives = [];
    flyingKnife = null;
    fallingKnives = [];
    rotation = 0;
    speedPhase = Math.random() * TAU;
    direction = Math.random() < 0.5 ? 1 : -1;
    // spins noticeably faster at higher levels
    baseSpeed = 1.3 + Math.min(level - 1, 16) * 0.38;
    grainSeed = Math.random() * 1000;

    // Level 1: fully intact. Later: chance of removed pizza slices,
    // growing with level, but always leaving most of the rim usable.
    gaps = [];
    if (level >= 2) {
      const maxGaps = Math.min(1 + Math.floor((level - 2) / 2), 4);
      const n = Math.floor(Math.random() * (maxGaps + 1)); // 0..maxGaps
      let totalSpan = 0;
      for (let i = 0; i < n; i++) {
        const span = (TAU / 14) + Math.random() * (TAU / 10); // ~26°-62°
        if (totalSpan + span > TAU * 0.5) break;              // keep ≥50% wood
        const start = Math.random() * (TAU - span);           // no wrap past 0
        if (gaps.some(g => arcsOverlap(start, span, g.start, g.span, MIN_KNIFE_GAP))) {
          continue; // skip overlapping slice rather than stacking
        }
        gaps.push({ start, span });
        totalSpan += span;
      }
    }

    // Bonus coin: when the cuts leave a small sliver of wood, sometimes put a
    // 10-pt coin just outside the rim on that sliver. Hitting it scores +10.
    coin = null;
    if (gaps.length) {
      const sorted = [...gaps].sort((a, b) => a.start - b.start);
      const slivers = [];
      for (let i = 0; i < sorted.length; i++) {
        const from = sorted[i].start + sorted[i].span;     // this gap's end
        let to = sorted[(i + 1) % sorted.length].start;    // next gap's start
        if (to <= from) to += TAU;
        const span = to - from;
        // small but still wide enough for a knife to land on
        if (span >= MIN_KNIFE_GAP * 1.3 && span <= TAU / 6) {
          slivers.push({ mid: norm(from + span / 2), halfSpan: span / 2 });
        }
      }
      if (slivers.length && Math.random() < 0.9) {
        const s = slivers[Math.floor(Math.random() * slivers.length)];
        coin = { angle: s.mid, halfSpan: s.halfSpan, collected: false };
      }
    }

    buildWoodSprite();   // re-render the wood now that gaps/grain are set
    buildCoinSprite();   // and the coin (if this level has one)
  }

  function arcsOverlap(s1, sp1, s2, sp2, pad) {
    // sample-based overlap test on the circle, good enough for placement
    for (let t = 0; t <= 1; t += 0.1) {
      const a = norm(s1 + sp1 * t);
      if (angleInArc(a, s2 - pad, sp2 + pad * 2)) return true;
    }
    return false;
  }

  const norm = a => ((a % TAU) + TAU) % TAU;

  function angleInArc(angle, start, span) {
    const d = norm(angle - start);
    return d >= 0 && d <= span;
  }

  // How many knives can physically fit on the remaining wood,
  // with a safety margin so rounds stay fair.
  function getMaxSafeKnives() {
    const gapTotal = gaps.reduce((s, g) => s + g.span, 0);
    const usable = TAU - gapTotal - gaps.length * MIN_KNIFE_GAP * 2;
    const slots = Math.floor(usable / (MIN_KNIFE_GAP * 2));
    return Math.max(1, Math.min(10, slots - 1));
  }

  // ---------- gameplay ----------
  // tip position of the waiting knife: keep the whole knife on screen
  function readyKnifeY() {
    return H - 16 - KNIFE_LEN * (woodR / 100);
  }

  function throwKnife() {
    if (flyingKnife) return false;     // one knife in flight at a time
    flyingKnife = { y: readyKnifeY() };
    return true;
  }

  function clearKnives() {
    stuckKnives = [];
    flyingKnife = null;
    fallingKnives = [];
  }

  const getKnifeCount = () => stuckKnives.length;

  function landKnife() {
    // The knife arrives pointing up at the bottom of the wood.
    // Its angle in the wood's own frame:
    const hitAngle = norm(POINT_DOWN - rotation);

    // Empty space?
    if (gaps.some(g => angleInArc(hitAngle, g.start, g.span))) {
      rejectKnife(0.6);
      onKnifeResult && onKnifeResult('gap');
      return;
    }
    // Collision with an existing knife?
    const collides = stuckKnives.some(a => {
      const d = Math.abs(norm(a - hitAngle));
      return Math.min(d, TAU - d) < MIN_KNIFE_GAP;
    });
    if (collides) {
      rejectKnife(1);
      onKnifeResult && onKnifeResult('collision');
      return;
    }
    // Stuck. If it landed on the bonus coin's sliver, collect it (+10).
    stuckKnives.push(hitAngle);
    if (coin && !coin.collected) {
      let d = Math.abs(norm(hitAngle - coin.angle));
      d = Math.min(d, TAU - d);
      if (d <= coin.halfSpan) {
        coin.collected = true;
        onKnifeResult && onKnifeResult('coin');
        return;
      }
    }
    onKnifeResult && onKnifeResult('stuck');
  }

  function rejectKnife(spin) {
    fallingKnives.push({
      x: woodX, y: woodY + woodR + 10,
      vx: (Math.random() - 0.5) * 500,
      vy: -150,
      rot: 0,
      vr: (Math.random() < 0.5 ? -1 : 1) * 8 * spin
    });
  }

  // ---------- update & render ----------
  function update(dt) {
    // spin → gradually slow → spin again (eased cycle)
    speedPhase += dt * 0.45;
    const cycle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(speedPhase));
    rotation = norm(rotation + direction * baseSpeed * cycle * dt);

    if (flyingKnife) {
      flyingKnife.y -= KNIFE_FLY_SPEED * dt;
      if (flyingKnife.y <= woodY + woodR) {
        flyingKnife = null;
        landKnife();
      }
    }

    for (const k of fallingKnives) {
      k.vy += 2400 * dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.rot += k.vr * dt;
    }
    fallingKnives = fallingKnives.filter(k => k.y < H + 80);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawWood();
    drawCoin();
    drawStuckKnives();
    drawCenterCounter();
    if (flyingKnife) drawKnifeAt(woodX, flyingKnife.y, 0);
    for (const k of fallingKnives) drawKnifeAt(k.x, k.y, k.rot);
    if (!flyingKnife) drawReadyKnife();
  }

  // Pre-render the "10 pts" coin once — its art is static; only its orbit
  // position changes — so the frame loop just blits it instead of redrawing
  // arcs + text every frame.
  function buildCoinSprite() {
    if (!coin || !woodR) { coinSprite = null; return; }
    const cr = woodR * 0.22;
    const half = cr * 1.3;
    const px = Math.max(1, Math.ceil(half * 2 * dpr));
    const c = document.createElement('canvas');
    c.width = px; c.height = px;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(half, half);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    // gentle glow
    g.beginPath(); g.arc(0, 0, cr * 1.18, 0, TAU);
    g.fillStyle = 'rgba(255, 220, 90, .35)'; g.fill();
    // coin body
    g.beginPath(); g.arc(0, 0, cr, 0, TAU);
    g.fillStyle = '#ffd84d'; g.fill();
    g.lineWidth = Math.max(2, cr * 0.16); g.strokeStyle = '#e0a712'; g.stroke();
    g.beginPath(); g.arc(0, 0, cr * 0.74, 0, TAU);
    g.strokeStyle = '#f6cf3f'; g.lineWidth = Math.max(1, cr * 0.1); g.stroke();
    // text
    g.fillStyle = '#7a5300'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${Math.round(cr * 0.62)}px "Comic Sans MS", sans-serif`;
    g.fillText('10', 0, -cr * 0.2);
    g.font = `bold ${Math.round(cr * 0.36)}px "Comic Sans MS", sans-serif`;
    g.fillText('pts', 0, cr * 0.45);
    coinSprite = { canvas: c, half };
  }

  // Gold coin just outside the rim; orbits with the wood (text stays upright).
  function drawCoin() {
    if (!coin || coin.collected || !coinSprite) return;
    const world = norm(coin.angle + rotation);
    const cx = woodX + Math.cos(world) * woodR * 1.3;
    const cy = woodY + Math.sin(world) * woodR * 1.3;
    ctx.drawImage(coinSprite.canvas, cx - coinSprite.half, cy - coinSprite.half,
                  coinSprite.half * 2, coinSprite.half * 2);
  }

  function drawWood() {
    ctx.save();
    ctx.translate(woodX, woodY);
    ctx.rotate(rotation);
    if (assets.wood) {
      ctx.drawImage(assets.wood, -woodR, -woodR, woodR * 2, woodR * 2);
    } else if (woodSprite) {
      // pre-rendered disc (see buildWoodSprite) — just blit it, already rotated
      // by the transform above; far cheaper than redrawing paths every frame
      ctx.drawImage(woodSprite, -woodSpriteHalf, -woodSpriteHalf,
                    woodSpriteHalf * 2, woodSpriteHalf * 2);
    }
    ctx.restore();
  }

  // Polar → cartesian helper (wood-local frame, origin at wood center).
  function polar(ang, r) {
    return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
  }

  // A pie-wedge of intact wood spanning rim angles [from, to], with its two
  // outer corners (where the straight cut meets the round rim) rounded.
  function addRoundedWedge(p, from, to, crMax) {
    const R = woodR;
    const span = to - from;
    const cornerAng = Math.min(crMax / R, span / 3); // rounding, capped per wedge
    const inset = cornerAng * R;                     // how far down the cut to start

    const innerFrom = polar(from, R - inset);
    const cornerFrom = polar(from, R);
    const rimStart = polar(from + cornerAng, R);
    const cornerTo = polar(to, R);
    const innerTo = polar(to, R - inset);

    p.moveTo(0, 0);
    p.lineTo(innerFrom.x, innerFrom.y);
    p.quadraticCurveTo(cornerFrom.x, cornerFrom.y, rimStart.x, rimStart.y);
    p.arc(0, 0, R, from + cornerAng, to - cornerAng);
    p.quadraticCurveTo(cornerTo.x, cornerTo.y, innerTo.x, innerTo.y);
    p.lineTo(0, 0);
    p.closePath();
  }

  function buildWoodPath() {
    const p = new Path2D();
    if (gaps.length === 0) {
      p.arc(0, 0, woodR, 0, TAU);
      return p;
    }
    const cr = woodR * 0.12; // corner-rounding radius
    const sorted = [...gaps].sort((a, b) => a.start - b.start);
    const N = sorted.length;
    // Each kept wedge runs from one gap's end to the next gap's start
    // (wrapping past 0), so corners are only rounded at real cuts.
    for (let i = 0; i < N; i++) {
      const from = sorted[i].start + sorted[i].span;
      let to = sorted[(i + 1) % N].start;
      if (to <= from) to += TAU;
      addRoundedWedge(p, from, to, cr);
    }
    return p;
  }

  function drawCenterCounter() {
    ctx.save();
    ctx.translate(woodX, woodY);
    ctx.beginPath();
    ctx.arc(0, 0, woodR * 0.32, 0, TAU);
    ctx.fillStyle = '#fff6df';
    ctx.fill();
    ctx.strokeStyle = '#6e4520';
    ctx.lineWidth = Math.max(2, woodR * 0.045);
    ctx.stroke();
    ctx.fillStyle = '#5b3a18';
    ctx.font = `bold ${Math.round(woodR * 0.38)}px "Comic Sans MS", sans-serif`;
    ctx.textAlign = 'center';
    // center on the digit's true visual middle (the 'middle' baseline renders
    // digits a little high), using the glyph's measured bounding box
    ctx.textBaseline = 'alphabetic';
    const label = String(stuckKnives.length);
    const m = ctx.measureText(label);
    const yMid = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(label, 0, yMid);
    ctx.restore();
  }

  function drawStuckKnives() {
    for (const a of stuckKnives) {
      const world = norm(a + rotation);
      const tipX = woodX + Math.cos(world) * (woodR * KNIFE_TIP_R);
      const tipY = woodY + Math.sin(world) * (woodR * KNIFE_TIP_R);
      ctx.save();
      ctx.translate(tipX, tipY);
      // knife points toward the wood center; sprite is drawn point-up
      ctx.rotate(world - Math.PI / 2);
      drawKnifeSprite(0, 0);
      ctx.restore();
    }
  }

  function drawKnifeAt(x, y, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    drawKnifeSprite(0, 0);
    ctx.restore();
  }

  function drawReadyKnife() {
    drawKnifeAt(woodX, readyKnifeY(), 0);
  }

  // Drawn point-up with the tip at (x, y). Size scales with the wood.
  function drawKnifeSprite(x, y) {
    const s = woodR / 100; // scale factor
    if (knifeSprite) { // pre-scaled sprite, tip at (x, y), extending downward
      ctx.drawImage(knifeSprite.canvas, x - knifeSprite.wCss / 2, y,
                    knifeSprite.wCss, knifeSprite.hCss);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    // blade
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(8, 14);
    ctx.lineTo(8, 48);
    ctx.lineTo(-8, 48);
    ctx.lineTo(-8, 14);
    ctx.closePath();
    ctx.fillStyle = '#d9dee3';
    ctx.fill();
    ctx.strokeStyle = '#8e979e';
    ctx.lineWidth = 2;
    ctx.stroke();
    // shine
    ctx.beginPath();
    ctx.moveTo(-2, 8);
    ctx.lineTo(2, 14);
    ctx.lineTo(2, 44);
    ctx.lineTo(-2, 44);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fill();
    // guard
    ctx.fillStyle = '#f3b32a';
    ctx.fillRect(-11, 48, 22, 7);
    // handle
    ctx.beginPath();
    ctx.roundRect(-6, 55, 12, 30, 5);
    ctx.fillStyle = '#b04a32';
    ctx.fill();
    ctx.strokeStyle = '#7c2f1d';
    ctx.lineWidth = 2;
    ctx.stroke();
    // handle stripes
    ctx.fillStyle = '#7c2f1d';
    ctx.fillRect(-6, 62, 12, 4);
    ctx.fillRect(-6, 72, 12, 4);
    ctx.restore();
  }

  return {
    assets,
    init,
    setKnifeImage,
    setupLevel,
    getMaxSafeKnives,
    throwKnife,
    clearKnives,
    getKnifeCount,
    update,
    render,
    get isKnifeFlying() { return !!flyingKnife; }
  };
})();
