/* ============================================================
   Formula generator.
   - The hidden answer ("?") is always an integer 1..maxAnswer (≤10).
   - All values in the equation are non-negative integers
     (no decimals, no negatives at any step).
   - Levels 1-2: single operation; the "?" may sit in any slot.
   - Levels 3-5: two operations, rendered FLAT (no brackets), e.g. 1 + 2 × ? = 15.
   - Levels 6+:  more operations and, when precedence needs it, brackets.
     Minimal bracketing keeps lots of variety (flat and bracketed forms) so a
     higher level isn't just "more brackets".
   Returns: { html, text, answer }
   ============================================================ */

const FormulaGenerator = (() => {
  const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = arr => arr[rnd(0, arr.length - 1)];

  const Q = '<span class="q">?</span>';
  const TIMES = '×';
  const DIV = '÷';

  // ---------- single-operation builders ----------
  // Each builder receives the answer (the value of "?") and returns
  // the displayed pieces with "?" already substituted in.
  const singleOps = [
    // a + ? = c
    ans => { const a = rnd(1, 12); return parts(`${a} + ${Q}`, a + ans); },
    // ? + b = c
    ans => { const b = rnd(1, 12); return parts(`${Q} + ${b}`, ans + b); },
    // a + b = ?  (a+b must equal ans)
    ans => {
      if (ans < 2) return null;
      const a = rnd(1, ans - 1);
      return parts(`${a} + ${ans - a}`, null); // "?" is the result
    },
    // a - ? = c  → a = ans + c
    ans => { const c = rnd(1, 12); return parts(`${ans + c} - ${Q}`, c); },
    // ? - b = c  → ans - b = c, need b < ans... c ≥ 0; keep c ≥ 1
    ans => {
      if (ans < 2) return null;
      const b = rnd(1, ans - 1);
      return parts(`${Q} - ${b}`, ans - b);
    },
    // a - b = ?  → a - b = ans
    ans => { const b = rnd(1, 12); return parts(`${b + ans} - ${b}`, null); },
    // a × ? = c
    ans => { const a = rnd(2, 9); return parts(`${a} ${TIMES} ${Q}`, a * ans); },
    // ? × b = c
    ans => { const b = rnd(2, 9); return parts(`${Q} ${TIMES} ${b}`, ans * b); },
    // a × b = ?  → need factor pair of ans
    ans => {
      const fs = factorPairs(ans);
      if (!fs.length) return null;
      const [a, b] = pick(fs);
      return parts(`${a} ${TIMES} ${b}`, null);
    },
    // a ÷ ? = c  → a = ans * c
    ans => { const c = rnd(2, 9); return parts(`${ans * c} ${DIV} ${Q}`, c); },
    // ? ÷ b = c  → ans / b = c, need b | ans
    ans => {
      const ds = divisors(ans).filter(d => d > 1 || ans === 1);
      if (!ds.length) return null;
      const b = pick(ds);
      return parts(`${Q} ${DIV} ${b}`, ans / b);
    },
    // a ÷ b = ?  → a = ans * b
    ans => { const b = rnd(2, 9); return parts(`${ans * b} ${DIV} ${b}`, null); }
  ];

  function parts(lhs, rhs) {
    // rhs === null means the "?" is the result side.
    return rhs === null
      ? { html: `${lhs} = ${Q}` }
      : { html: `${lhs} = ${rhs}` };
  }

  function factorPairs(n) {
    const out = [];
    for (let a = 1; a <= n; a++) if (n % a === 0) out.push([a, n / a]);
    return out;
  }

  function divisors(n) {
    const out = [];
    for (let d = 1; d <= n; d++) if (n % d === 0) out.push(d);
    return out;
  }

  const MINUS = '-';
  const MAX_VALUE = 60; // keep intermediate values reasonable

  // ---------- multi-operation builder ----------
  // Builds a RANDOM binary expression tree, assigns concrete positive-integer
  // values bottom-up, hides ONE leaf as "?", and renders with MINIMAL brackets.
  // Minimal bracketing means many equations come out FLAT (e.g. "1 + 2 × ? = 15",
  // "3 + 5 + ? = 9") and brackets only appear when operator precedence actually
  // needs them — so higher levels get more variety, not just more nesting.
  // Each operation is monotonic in its operands, so the answer is unique.

  // random tree shape with exactly `opCount` internal (operation) nodes
  function randomShape(opCount) {
    if (opCount === 0) return { leaf: true };
    const leftOps = rnd(0, opCount - 1);
    return {
      leaf: false,
      left: randomShape(leftOps),
      right: randomShape(opCount - 1 - leftOps)
    };
  }

  // pick leaf values + a valid op per node so every node is a positive integer
  function evalShape(node) {
    if (node.leaf) { node.val = rnd(1, 9); return node.val; }
    const lv = evalShape(node.left);
    const rv = evalShape(node.right);
    const choices = ['+'];
    if (lv - rv >= 1) choices.push('-');
    if (lv * rv <= MAX_VALUE) choices.push('×');
    if (rv >= 2 && lv % rv === 0) choices.push('÷');
    node.op = pick(choices);
    node.val =
      node.op === '+' ? lv + rv :
      node.op === '-' ? lv - rv :
      node.op === '×' ? lv * rv : lv / rv;
    return node.val;
  }

  function collectLeaves(node, out) {
    if (node.leaf) out.push(node);
    else { collectLeaves(node.left, out); collectLeaves(node.right, out); }
    return out;
  }

  const prec = op => (op === '×' || op === '÷') ? 2 : 1;

  // Whether a child subtree needs brackets to preserve its grouping when the
  // parent's operator is applied (standard minimal-parenthesization rule).
  function needsBrackets(childOp, parentOp, side) {
    const cp = prec(childOp), pp = prec(parentOp);
    if (cp < pp) return true;
    if (cp > pp) return false;
    if (side === 'left') return false;            // left-associative: left child is safe
    return parentOp === '-' || parentOp === '÷';  // right child only safe for + and ×
  }

  // Render with minimal brackets; counts the bracket pairs added.
  function renderShape(node, parentOp, side, counter) {
    if (node.leaf) return node.qMark ? Q : String(node.val);
    const sym = node.op === '-' ? MINUS : node.op === '×' ? TIMES : node.op === '÷' ? DIV : '+';
    const inner = `${renderShape(node.left, node.op, 'left', counter)} ${sym} ` +
                  `${renderShape(node.right, node.op, 'right', counter)}`;
    if (parentOp && needsBrackets(node.op, parentOp, side)) {
      counter.pairs++;
      return `(${inner})`;
    }
    return inner;
  }

  function buildTree(opCount, cap) {
    const root = randomShape(opCount);
    evalShape(root);
    const leaves = collectLeaves(root, []);
    const candidates = leaves.filter(l => l.val >= 1 && l.val <= cap);
    if (!candidates.length) return null;
    pick(candidates).qMark = true;
    const q = leaves.find(l => l.qMark);
    const counter = { pairs: 0 };
    const expr = renderShape(root, null, null, counter);
    return { html: `${expr} = ${root.val}`, answer: q.val, pairs: counter.pairs };
  }

  // Guaranteed-flat fallback: a + b + ... + ? = sum (always valid, never bracketed)
  function buildFlatAddition(opCount, cap) {
    const answer = rnd(1, cap);
    const others = [];
    for (let i = 0; i < opCount; i++) others.push(rnd(1, 9));
    const total = answer + others.reduce((a, b) => a + b, 0);
    const qpos = rnd(0, opCount);
    const parts = [];
    let oi = 0;
    for (let i = 0; i <= opCount; i++) parts.push(i === qpos ? Q : String(others[oi++]));
    return { html: `${parts.join(' + ')} = ${total}`, answer, pairs: 0 };
  }

  // Operations grow with level; brackets are only ALLOWED from level 6.
  //   1-5   -> 1 op            (single operation, no brackets)
  //   6-10  -> 2 ops           (brackets now possible)
  //   11-13 -> 3 ops           (brackets possible)
  //   14+   -> 4 ops           (brackets possible)
  function opCountForLevel(level) {
    if (level <= 5) return 1;
    if (level <= 10) return 2;
    if (level <= 13) return 3;
    return 4;
  }

  /**
   * Generate a formula for the given level.
   * @param {number} level     current level (1-based)
   * @param {number} maxAnswer cap from the target module (physical knife space)
   */
  function generate(level, maxAnswer = 10) {
    const cap = Math.max(1, Math.min(10, maxAnswer));
    const opCount = opCountForLevel(level);
    const allowBrackets = level >= 6;   // brackets only after level 5

    if (opCount === 1) {
      // single-operation tier: "?" may sit in any slot
      for (let tries = 0; tries < 60; tries++) {
        const answer = rnd(1, cap);
        const built = pick(singleOps)(answer);
        if (built) return { html: built.html, text: built.html.split(Q).join('?'), answer };
      }
    } else {
      // multi-operation tier; reject bracketed results when not yet allowed
      for (let tries = 0; tries < 200; tries++) {
        const built = buildTree(opCount, cap);
        if (!built) continue;
        if (!allowBrackets && built.pairs > 0) continue;
        return { html: built.html, text: built.html.split(Q).join('?'), answer: built.answer };
      }
      // guaranteed flat fallback keeps the right op count without brackets
      const flat = buildFlatAddition(opCount, cap);
      return { html: flat.html, text: flat.html.split(Q).join('?'), answer: flat.answer };
    }

    // Final fallback: a + ? = c
    const answer = rnd(1, cap);
    const a = rnd(1, 9);
    return { html: `${a} + ${Q} = ${a + answer}`, text: `${a} + ? = ${a + answer}`, answer };
  }

  return { generate };
})();
