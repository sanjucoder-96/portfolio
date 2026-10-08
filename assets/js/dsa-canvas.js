/* DSA — topic radar on canvas
   ──────────────────────────
   Twelve topic clusters orbit a centre; the six rows beside the canvas
   and the radar highlight each other:

     window.__dsaHighlight(['ARR','STR'] | null)   rows → radar
     window.__dsaOnHover(name | null)              radar → rows (set by scenes.js)

   Highlighting a topic that has one also plays its algorithm in the
   middle of the radar — two pointers, BFS, a DP table, a sliding window,
   4-queens backtracking, a mutex — so the hover shows the technique, not
   just a brighter label.

   Runs on FX.loop, so it stops drawing as soon as it leaves the screen. */
(() => {
  const canvas = document.getElementById('dsa-canvas');
  const FX = window.FX;
  if (!canvas || !FX) return;

  let W = 0, H = 0, ctx = null;
  const dots = [];
  const N = 240;

  const TOPICS = [
    { name: 'ARR',    angle: 0,              r: 0.85, kind: 'graph', demo: 'array' },
    { name: 'TREE',   angle: Math.PI * 0.16, r: 0.72, kind: 'warm',  demo: 'tree' },
    { name: 'DP',     angle: Math.PI * 0.32, r: 0.65, kind: 'agent', demo: 'dp' },
    { name: 'GRPH',   angle: Math.PI * 0.48, r: 0.78, kind: 'graph', demo: 'tree' },
    { name: 'STR',    angle: Math.PI * 0.64, r: 0.68, kind: 'graph', demo: 'array' },
    { name: 'MATH',   angle: Math.PI * 0.80, r: 0.55, kind: 'warm' },
    { name: 'BT',     angle: Math.PI * 0.96, r: 0.58, kind: 'agent', demo: 'backtrack' },
    { name: 'SW',     angle: Math.PI * 1.12, r: 0.7,  kind: 'graph', demo: 'window' },
    { name: 'HEAP',   angle: Math.PI * 1.28, r: 0.5,  kind: 'warm' },
    { name: 'BIT',    angle: Math.PI * 1.44, r: 0.45, kind: 'graph' },
    { name: 'GREEDY', angle: Math.PI * 1.60, r: 0.6,  kind: 'agent' },
    { name: 'CONC',   angle: Math.PI * 1.76, r: 0.4,  kind: 'graph', demo: 'lock' },
  ];
  TOPICS.forEach((t) => { t.glow = 0; t.lx = 0; t.ly = 0; });
  const byName = new Map(TOPICS.map((t) => [t.name, t]));

  // highlight state: rows drive `external`, the pointer drives `hovered`
  let external = null, hovered = null;
  window.__dsaHighlight = (names) => { external = names && names.length ? names : null; if (FX.reduced) draw(0); };

  // ════════════════════════════════════════════════════════════
  //  Algorithm demos — each draws into a square (x, y, S) at local time t (s)
  // ════════════════════════════════════════════════════════════
  const mono = (px, weight = 400) => `${weight} ${px}px "JetBrains Mono", ui-monospace, monospace`;

  // 4-queens: record every placement attempt and every undo up to the first solution
  const QUEEN_STEPS = (() => {
    const steps = [], cols = [];
    const solve = (r) => {
      if (r === 4) return true;
      for (let c = 0; c < 4; c++) {
        const ok = cols.every((cc, rr) => cc !== c && Math.abs(cc - c) !== r - rr);
        steps.push({ r, c, ok, board: cols.slice() });
        if (!ok) continue;
        cols.push(c);
        if (solve(r + 1)) return true;
        cols.pop();
        steps.push({ r, c, undo: true, board: cols.slice() });
      }
      return false;
    };
    solve(0);
    steps.push({ done: true, board: cols.slice() });
    return steps;
  })();

  // grid-paths table: dp[i][j] = dp[i-1][j] + dp[i][j-1]
  const DP_N = 5;
  const DP = (() => {
    const g = [];
    for (let i = 0; i < DP_N; i++) {
      g.push([]);
      for (let j = 0; j < DP_N; j++) g[i].push(i === 0 || j === 0 ? 1 : g[i - 1][j] + g[i][j - 1]);
    }
    return g;
  })();

  const DEMOS = {
    array: {
      caption: 'two pointers · O(n)', still: 2.6,
      draw(c, x, y, S, t, P) {
        const vals = [1, 3, 4, 6, 8, 9, 11, 14], target = 13;
        const steps = [[0, 7], [0, 6], [1, 6], [1, 5], [2, 5]];
        const i = Math.min(steps.length - 1, Math.floor((t % 4.4) / 0.62));
        const [L, R] = steps[i], sum = vals[L] + vals[R], found = sum === target;
        const bw = S / vals.length, base = y + S * 0.8, maxH = S * 0.56;
        vals.forEach((v, k) => {
          const h = (v / 14) * maxH, on = k === L || k === R;
          c.fillStyle = on ? `rgb(${found ? P.warm : P.graph})` : `rgba(${P.fg},${k < L || k > R ? 0.1 : 0.26})`;
          c.fillRect(x + k * bw + 3, base - h, bw - 6, h);
        });
        c.font = mono(10, 500); c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = `rgb(${found ? P.warm : P.graph})`;
        c.fillText('L', x + L * bw + bw / 2, base + 12);
        c.fillText('R', x + R * bw + bw / 2, base + 12);
        c.fillStyle = `rgba(${P.fg},0.9)`;
        c.fillText(`${vals[L]} + ${vals[R]} ${found ? '= ' + target + '  ✓' : sum > target ? '> ' + target : '< ' + target}`, x + S / 2, y + S * 0.1);
      },
    },

    tree: {
      caption: 'BFS · level order', still: 3.2,
      draw(c, x, y, S, t, P) {
        const pos = [[0.5, 0.14], [0.26, 0.44], [0.74, 0.44], [0.12, 0.78], [0.4, 0.78], [0.6, 0.78], [0.88, 0.78]]
          .map(([px, py]) => [x + px * S, y + py * S]);
        const idx = Math.min(pos.length, Math.floor((t % 5) / 0.5));
        c.lineWidth = 1;
        [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]].forEach(([a, b]) => {
          c.strokeStyle = b < idx ? `rgba(${P.graph},0.7)` : `rgba(${P.fg},0.16)`;
          c.beginPath(); c.moveTo(pos[a][0], pos[a][1]); c.lineTo(pos[b][0], pos[b][1]); c.stroke();
        });
        const r = Math.max(7, S * 0.055);
        pos.forEach(([px, py], k) => {
          const visited = k < idx, current = k === idx;
          c.fillStyle = visited ? `rgb(${P.graph})` : current ? `rgb(${P.warm})` : `rgb(${P.bg})`;
          c.strokeStyle = visited || current ? 'transparent' : `rgba(${P.fg},0.35)`;
          c.beginPath(); c.arc(px, py, current ? r * 1.25 : r, 0, Math.PI * 2); c.fill(); c.stroke();
          c.font = mono(9, 500); c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillStyle = visited || current ? (P.isLight ? '#fff' : '#041614') : `rgba(${P.fg},0.6)`;
          c.fillText(String(k + 1), px, py + 0.5);
        });
      },
    },

    dp: {
      caption: 'tabulation · up + left', still: 9,
      draw(c, x, y, S, t, P) {
        const total = DP_N * DP_N;
        const idx = Math.min(total, Math.floor((t % (total * 0.16 + 1.6)) / 0.16));
        const cell = S / DP_N, pad = 2.5;
        const centre = (k) => [x + (k % DP_N) * cell + cell / 2, y + Math.floor(k / DP_N) * cell + cell / 2];
        for (let k = 0; k < total; k++) {
          const i = Math.floor(k / DP_N), j = k % DP_N, filled = k < idx, current = k === idx;
          c.fillStyle = current ? `rgba(${P.warm},0.9)` : filled ? `rgba(${P.agent},${(0.16 + (DP[i][j] / 70) * 0.5).toFixed(3)})` : `rgba(${P.fg},0.05)`;
          c.fillRect(x + j * cell + pad, y + i * cell + pad, cell - pad * 2, cell - pad * 2);
          if (filled || current) {
            c.font = mono(Math.max(8, cell * 0.28)); c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillStyle = current ? (P.isLight ? '#fff' : '#1a1206') : `rgba(${P.fg},0.9)`;
            const [tx, ty] = centre(k);
            c.fillText(String(DP[i][j]), tx, ty + 0.5);
          }
        }
        if (idx < total) {
          const i = Math.floor(idx / DP_N), j = idx % DP_N, [px, py] = centre(idx);
          c.strokeStyle = `rgb(${P.warm})`; c.lineWidth = 1.4;
          if (i > 0) { c.beginPath(); c.moveTo(px, py - cell + cell * 0.28); c.lineTo(px, py - cell * 0.36); c.stroke(); }
          if (j > 0) { c.beginPath(); c.moveTo(px - cell + cell * 0.28, py); c.lineTo(px - cell * 0.36, py); c.stroke(); }
        }
      },
    },

    window: {
      caption: 'sliding window · O(n)', still: 2.3,
      draw(c, x, y, S, t, P) {
        const vals = [2, 7, 1, 8, 3, 9, 4, 6], K = 3, last = vals.length - K;
        const pos = Math.min(last, Math.floor((t % (last * 0.55 + 2)) / 0.55));
        const sumAt = (p) => vals[p] + vals[p + 1] + vals[p + 2];
        let best = 0;
        for (let p = 1; p <= pos; p++) if (sumAt(p) > sumAt(best)) best = p;
        const cell = S / vals.length, cy = y + S * 0.5, side = cell - 5;
        vals.forEach((v, k) => {
          const inWin = k >= pos && k < pos + K;
          c.fillStyle = inWin ? `rgba(${P.graph},0.85)` : `rgba(${P.fg},0.08)`;
          c.fillRect(x + k * cell + 2.5, cy - side / 2, side, side);
          c.font = mono(Math.max(9, cell * 0.36), 500); c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillStyle = inWin ? (P.isLight ? '#fff' : '#041614') : `rgba(${P.fg},0.7)`;
          c.fillText(String(v), x + k * cell + cell / 2, cy + 0.5);
        });
        c.strokeStyle = `rgb(${P.graph})`; c.lineWidth = 1.4;
        c.strokeRect(x + pos * cell - 1, cy - side / 2 - 5, K * cell + 2, side + 10);
        c.strokeStyle = `rgb(${P.warm})`;
        c.beginPath(); c.moveTo(x + best * cell + 3, cy + side / 2 + 14); c.lineTo(x + (best + K) * cell - 3, cy + side / 2 + 14); c.stroke();
        c.font = mono(10, 500); c.textAlign = 'center';
        c.fillStyle = `rgba(${P.fg},0.9)`;
        c.fillText(`sum ${sumAt(pos)}`, x + S * 0.3, y + S * 0.16);
        c.fillStyle = `rgb(${P.warm})`;
        c.fillText(`best ${sumAt(best)}`, x + S * 0.7, y + S * 0.16);
      },
    },

    backtrack: {
      caption: '4-queens · place, conflict, undo', still: 99,
      draw(c, x, y, S, t, P) {
        const beat = 0.26, n = QUEEN_STEPS.length;
        const step = QUEEN_STEPS[Math.min(n - 1, Math.floor((t % (n * beat + 2)) / beat))];
        const B = S * 0.86, bx = x + (S - B) / 2, by = y + (S - B) / 2, cell = B / 4;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          c.fillStyle = `rgba(${P.fg},${(i + j) % 2 ? 0.09 : 0.03})`;
          c.fillRect(bx + j * cell, by + i * cell, cell, cell);
        }
        if (!step.done) {
          const rgb = step.undo ? P.warm : step.ok ? P.graph : P.java;
          c.fillStyle = `rgba(${rgb},0.3)`;
          c.fillRect(bx + step.c * cell, by + step.r * cell, cell, cell);
          c.strokeStyle = `rgb(${rgb})`; c.lineWidth = 1.4;
          c.strokeRect(bx + step.c * cell + 1, by + step.r * cell + 1, cell - 2, cell - 2);
        }
        const queens = step.board.map((col, row) => [row, col]);
        if (!step.done && step.ok && !step.undo) queens.push([step.r, step.c]);
        queens.forEach(([row, col]) => {
          c.fillStyle = `rgb(${step.done ? P.warm : P.agent})`;
          c.beginPath(); c.arc(bx + col * cell + cell / 2, by + row * cell + cell / 2, cell * 0.24, 0, Math.PI * 2); c.fill();
        });
      },
    },

    lock: {
      caption: 'mutex · one thread at a time', still: 0.6,
      draw(c, x, y, S, t, P) {
        const beat = 1.3, tt = t % (beat * 3), owner = Math.floor(tt / beat), f = (tt % beat) / beat;
        const start = x + S * 0.16, gate = x + S * 0.36, exit = x + S * 0.76, end = x + S * 0.94;
        c.fillStyle = `rgba(${P.graph},0.1)`; c.strokeStyle = `rgba(${P.graph},0.8)`; c.lineWidth = 1.2;
        c.beginPath();
        if (c.roundRect) c.roundRect(gate + 8, y + S * 0.16, exit - gate - 16, S * 0.68, 8); else c.rect(gate + 8, y + S * 0.16, exit - gate - 16, S * 0.68);
        c.fill(); c.stroke();
        c.font = mono(9); c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = `rgb(${P.graph})`;
        c.fillText('critical section', (gate + exit) / 2, y + S * 0.08);
        for (let i = 0; i < 3; i++) {
          const ly = y + S * (0.3 + i * 0.2);
          c.strokeStyle = `rgba(${P.fg},0.14)`; c.lineWidth = 1;
          c.beginPath(); c.moveTo(start, ly); c.lineTo(end, ly); c.stroke();
          c.font = mono(9, 500); c.textAlign = 'left';
          c.fillStyle = `rgba(${P.fg},0.75)`;
          c.fillText('T' + (i + 1), x, ly);
          let px, rgb = P.fg3, r = 4.5;
          if (i === owner) { px = FX.lerp(gate, end, f); rgb = P.graph; r = 5.5; }                  // holds the lock
          else if (i === (owner + 1) % 3) { px = gate - 4; rgb = P.warm; r = 4.5 + Math.sin(t * 9) * 1.2; }  // blocked at the gate
          else px = start + 6;                                                                       // not asking yet
          c.fillStyle = `rgb(${rgb})`;
          c.beginPath(); c.arc(px, ly, r, 0, Math.PI * 2); c.fill();
        }
      },
    },
  };
  const demo = { key: null, t0: 0, fade: 0 };
  const STAGE = 0.82;      // radius (× R) of the disc a demo clears for itself

  function seed() {
    dots.length = 0;
    const R = Math.min(W, H) * 0.42;
    TOPICS.forEach((t) => {
      const clusterCount = Math.round(t.r * (N / TOPICS.length) * 1.5);
      for (let i = 0; i < clusterCount; i++) {
        const spread = 0.14 + Math.random() * 0.08;
        dots.push({
          topic: t,
          a: t.angle + (Math.random() - 0.5) * spread,
          r: R * (t.r + (Math.random() - 0.5) * 0.18) * 0.9,
          size: Math.random() < 0.15 ? 2.2 : 1.2,
          phase: Math.random() * Math.PI * 2,
        });
      }
    });
  }

  function draw(now) {
    if (!ctx) return;
    const P = FX.pal;
    const elapsed = FX.reduced ? 0 : now / 1000;
    const spin = elapsed * 0.03;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.42;
    const active = hovered ? [hovered] : external;

    // which algorithm (if any) the highlighted topic plays
    const lead = active && byName.get(active[0]);
    const want = lead && lead.demo ? lead.demo : null;
    if (want && want !== demo.key) { demo.key = want; demo.t0 = now; }
    demo.fade = FX.reduced ? (want ? 1 : 0) : FX.lerp(demo.fade, want ? 1 : 0, 0.12);
    if (!want && demo.fade < 0.02) { demo.key = null; demo.fade = 0; }
    const stage = demo.key ? demo.fade : 0;      // 0..1 — how much the centre belongs to the demo

    ctx.clearRect(0, 0, W, H);

    // orbit rings
    ctx.strokeStyle = `rgba(${P.fg},${P.isLight ? 0.08 : 0.05})`;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * (i / 4) * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }
    // radial ticks
    ctx.strokeStyle = `rgba(${P.fg},${P.isLight ? 0.06 : 0.04})`;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.15, cy + Math.sin(a) * R * 0.15);
      ctx.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
      ctx.stroke();
    }

    // per-topic glow eases toward its target so highlights fade rather than snap
    TOPICS.forEach((t) => {
      const target = active && active.includes(t.name) ? 1 : 0;
      t.glow = FX.reduced ? target : FX.lerp(t.glow, target, 0.14);
      const a = t.angle + spin;
      t.lx = cx + Math.cos(a) * R * (t.r + 0.14);
      t.ly = cy + Math.sin(a) * R * (t.r + 0.14);
      if (t.glow < 0.02) return;
      // sector wedge + spoke from the centre
      const rgb = P[t.kind] || P.graph;
      ctx.fillStyle = `rgba(${rgb},${(0.09 * t.glow).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R * 0.92, a - 0.2, a + 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},${(0.55 * t.glow).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R * t.r, cy + Math.sin(a) * R * t.r);
      ctx.stroke();
    });

    // dots
    const dim = active ? 0.3 : 1;
    dots.forEach((d) => {
      const a = d.a + spin;
      const x = cx + Math.cos(a) * d.r, y = cy + Math.sin(a) * d.r;
      const pulse = 0.6 + Math.sin(elapsed * 1.4 + d.phase) * 0.4;
      const g = d.topic.glow;
      ctx.fillStyle = `rgb(${P[d.topic.kind] || P.graph})`;
      ctx.globalAlpha = Math.min(1, ((P.isLight ? 0.55 : 0.45) + 0.35 * pulse) * FX.lerp(dim, 1.25, g));
      ctx.beginPath();
      ctx.arc(x, y, d.size * (1 + g * 0.6), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // the demo clears itself a stage in the middle of the radar
    if (stage > 0) {
      ctx.fillStyle = `rgba(${P.bg},${(0.9 * stage).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(cx, cy, R * STAGE, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${P[lead ? lead.kind : 'graph'] || P.graph},${(0.35 * stage).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * STAGE, 0, Math.PI * 2); ctx.stroke();
    }

    // topic labels (inner ones step aside while a demo holds the centre)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    TOPICS.forEach((t) => {
      const inner = t.r + 0.14 < STAGE + 0.06;
      const hide = inner && t.glow < 0.5 ? 1 - stage : 1;
      if (hide < 0.02) return;
      ctx.font = `${t.glow > 0.5 ? '500 11px' : '10px'} "JetBrains Mono", monospace`;
      ctx.fillStyle = t.glow > 0.02
        ? `rgba(${P[t.kind] || P.graph},${(0.6 + 0.4 * t.glow).toFixed(3)})`
        : `rgba(${P.fg},${((P.isLight ? 0.75 : 0.55) * (active ? 0.5 : 1) * hide).toFixed(3)})`;
      // a highlighted inner label is pushed out to the rim of the stage so it never sits on the demo
      const push = inner && t.glow > 0.02 ? FX.lerp(1, ((STAGE + 0.08) * R) / Math.hypot(t.lx - cx, t.ly - cy), stage) : 1;
      ctx.fillText(t.name, cx + (t.lx - cx) * push, cy + (t.ly - cy) * push);
    });

    // centre: the monogram, or the algorithm
    if (stage < 0.98) {
      ctx.globalAlpha = 1 - stage;
      ctx.fillStyle = `rgb(${P.fg})`;
      ctx.font = '500 12px "JetBrains Mono", monospace';
      ctx.fillText('SU · DSA', cx, cy - 6);
      ctx.fillStyle = `rgba(${P.graph},0.9)`;
      ctx.font = '400 10px "JetBrains Mono", monospace';
      ctx.fillText('600+', cx, cy + 10);
      ctx.globalAlpha = 1;
    }
    if (stage > 0) {
      const d = DEMOS[demo.key];
      const S = R * 1.02;
      ctx.save();
      ctx.globalAlpha = stage;
      d.draw(ctx, cx - S / 2, cy - S / 2 - R * 0.04, S, FX.reduced ? d.still : (now - demo.t0) / 1000, P);
      ctx.font = mono(9.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${P.fg},0.7)`;
      ctx.fillText(d.caption, cx, cy + S / 2 + R * 0.05);
      ctx.restore();
    }
  }

  FX.canvas2d(canvas, (s) => {
    ctx = s.ctx; W = s.W; H = s.H;
    seed();
    if (FX.reduced) draw(0);
  });

  // pointer: nearest topic label within reach
  const setHover = (name) => {
    if (name === hovered) return;
    hovered = name;
    if (window.__dsaOnHover) window.__dsaOnHover(name);
    if (FX.reduced) draw(0);
  };
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bestD = 46 * 46;
    TOPICS.forEach((t) => {
      const d = (t.lx - x) * (t.lx - x) + (t.ly - y) * (t.ly - y);
      if (d < bestD) { bestD = d; best = t.name; }
    });
    // while a demo is on stage, staying over it keeps it there
    if (!best && hovered && demo.key && Math.hypot(x - W / 2, y - H / 2) < Math.min(W, H) * 0.42 * STAGE) return;
    setHover(best);
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => setHover(null));

  window.addEventListener('themechange', () => { if (FX.reduced) requestAnimationFrame(() => draw(0)); });
  if (!FX.reduced) FX.loop(canvas, draw);
})();
