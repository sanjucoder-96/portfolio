/* GraphGST — 3D property graph with Cypher traversal
   ────────────────────────────────────────────────────
   A real 3D scene rendered with canvas 2D: nodes are placed on a
   Fibonacci sphere, rotated by 3x3 matrices, projected with
   perspective, then painted back-to-front (painter's algorithm) so
   depth reads correctly. No WebGL, no dependency.

   Depth drives size, opacity, and glow, so the graph genuinely
   feels volumetric rather than like a flat ring. Drag to orbit;
   release and it eases back into slow auto-rotation.

   The Cypher HUD loop is preserved — the traced cycle is now a
   3D polyline that travels through the sphere.                    */

(() => {
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  // ── Theme ────────────────────────────────────
  const pal = { fg: '242,241,234', graph: '124,217,192', warm: '229,178,93', edge: '180,200,195' };
  function readTheme() {
    const s = getComputedStyle(document.documentElement);
    pal.fg    = (s.getPropertyValue('--rgb-fg')    || pal.fg).trim();
    pal.graph = (s.getPropertyValue('--rgb-graph') || pal.graph).trim();
    pal.warm  = (s.getPropertyValue('--rgb-warm')  || pal.warm).trim();
    pal.edge  = (s.getPropertyValue('--canvas-edge') || pal.edge).trim();
  }
  readTheme();
  window.addEventListener('themechange', readTheme);

  // ── Build the graph in 3D ────────────────────
  const N_RING = 18;   // outer entities on the sphere
  const N_CORE = 3;    // inner hub nodes
  const nodes = [];

  // Fibonacci sphere — evenly distributes points, no clustering at poles
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N_RING; i++) {
    const y = 1 - (i / (N_RING - 1)) * 2;      // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * i;
    nodes.push({
      id: `E${(i + 1).toString().padStart(2, '0')}`,
      x: Math.cos(theta) * r,
      y: y,
      z: Math.sin(theta) * r,
      core: false,
      pulse: Math.random() * Math.PI * 2,
    });
  }
  // Inner hubs sit near the centre — they read as "deeper" in the volume
  const cores = [
    { id: 'HUB', x: 0,     y: 0,     z: 0 },
    { id: 'GSTIN', x: 0.34, y: 0.22, z: -0.2 },
    { id: 'ITC',  x: -0.3, y: -0.26, z: 0.24 },
  ];
  cores.forEach((c) => nodes.push({ ...c, core: true, pulse: Math.random() * Math.PI * 2 }));

  const HUB = N_RING, GSTIN = N_RING + 1, ITC = N_RING + 2;

  // Edges: spokes into the three hubs, hub interlinks, plus peripheral chords
  const edges = [];
  for (let i = 0; i < N_RING; i++) {
    const hub = i % 3 === 0 ? HUB : i % 3 === 1 ? GSTIN : ITC;
    edges.push([i, hub]);
  }
  edges.push([HUB, GSTIN], [HUB, ITC], [GSTIN, ITC]);
  for (let i = 0; i < N_RING; i += 2) edges.push([i, (i + 5) % N_RING]);
  for (let i = 1; i < N_RING; i += 4) edges.push([i, (i + 3) % N_RING]);

  // The circular-trade cycle Cypher surfaces
  const cycle = [2, 7, 11, HUB, 15, 2];
  const cycleSet = new Set(cycle);

  // ── Camera / interaction state ───────────────
  let rotY = 0.4, rotX = -0.25;
  let velY = 0.0016, velX = 0;      // idle auto-orbit
  let dragging = false, lastX = 0, lastY = 0;
  let visible = true;
  let traceT = -1;                   // -1 = idle, 0..1 = cycle drawing progress
  let hoverIdx = -1;                 // node under the pointer (-1 = none)
  let lastP = [];                    // last frame's projections, for hit-testing
  const FOV = 3.2;

  // Neighbour lookup so a hovered entity can light its own edges
  const neighbours = nodes.map(() => new Set());

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width  = Math.max(1, r.width) * DPR;
    canvas.height = Math.max(1, r.height) * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    RAD = Math.min(W, H) * 0.34;
  }
  let W = 1, H = 1, RAD = 100;
  resize();
  window.addEventListener('resize', resize);

  // Project a node into screen space with the current rotation
  function project(n) {
    const cy = Math.cos(rotY), sy = Math.sin(rotY);
    const cx = Math.cos(rotX), sx = Math.sin(rotX);
    // rotate about Y
    const x1 =  n.x * cy - n.z * sy;
    const z1 =  n.x * sy + n.z * cy;
    // rotate about X
    const y2 =  n.y * cx - z1 * sx;
    const z2 =  n.y * sx + z1 * cx;
    const scale = FOV / (FOV + z2);
    return {
      sx: W / 2 + x1 * RAD * scale,
      sy: H / 2 + y2 * RAD * scale,
      z: z2,
      scale,
      depth: (z2 + 1) / 2,   // 0 = near, 1 = far
    };
  }

  // ── Pointer orbit ────────────────────────────
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    canvas.parentElement?.classList.add('is-grabbed');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) {
      // inspect: nearest projected node within reach of the pointer
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = -1, bestD = 22 * 22;
      for (let i = 0; i < lastP.length; i++) {
        const dx = lastP[i].sx - x, dy = lastP[i].sy - y, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      hoverIdx = best;
      return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    rotY += dx * 0.008;
    rotX += dy * 0.006;
    rotX = Math.max(-1.2, Math.min(1.2, rotX));
    velY = dx * 0.0011;
    velX = dy * 0.0008;
  });
  const endDrag = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerleave', () => { hoverIdx = -1; });
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.style.cursor = 'grab';

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { visible = e.isIntersecting; });
  }, { threshold: 0.05 });
  io.observe(canvas);

  // ── Render loop ──────────────────────────────
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible) return;

    if (!dragging) {
      // ease velocity back toward the idle orbit rate (held still while inspecting a node)
      velY += ((hoverIdx >= 0 ? 0 : 0.0016) - velY) * (hoverIdx >= 0 ? 0.12 : 0.02);
      velX += (0 - velX) * 0.04;
      rotY += velY;
      rotX += velX;
      rotX += Math.sin(now * 0.00013) * 0.00035;   // gentle bob
      rotX = Math.max(-1.2, Math.min(1.2, rotX));
    }

    ctx.clearRect(0, 0, W, H);

    // Project everything once
    const P = nodes.map(project);
    lastP = P;
    const hov = dragging ? -1 : hoverIdx;

    // ── Edges, sorted far → near ──
    const edgeList = edges.map(([a, b]) => ({
      a, b, z: (P[a].z + P[b].z) / 2,
      hot: cycleSet.has(a) && cycleSet.has(b),
    })).sort((m, n) => n.z - m.z);

    edgeList.forEach((e) => {
      const A = P[e.a], B = P[e.b];
      const near = 1 - (A.depth + B.depth) / 2;      // 1 = closest
      const lit = hov >= 0 && (e.a === hov || e.b === hov);
      const alpha = lit ? 0.75 : (0.05 + near * 0.16) * (hov >= 0 ? 0.45 : 1);
      ctx.strokeStyle = `rgba(${lit ? pal.warm : pal.edge},${alpha.toFixed(3)})`;
      ctx.lineWidth = lit ? 1.4 : 0.4 + near * 0.7;
      ctx.beginPath();
      ctx.moveTo(A.sx, A.sy);
      ctx.lineTo(B.sx, B.sy);
      ctx.stroke();
    });

    // ── Traced cycle (3D polyline) ──
    if (traceT >= 0) {
      const segs = cycle.length - 1;
      const total = traceT * segs;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let s = 0; s < segs; s++) {
        const f = Math.max(0, Math.min(1, total - s));
        if (f <= 0) break;
        const A = P[cycle[s]], B = P[cycle[s + 1]];
        const near = 1 - (A.depth + B.depth) / 2;
        ctx.strokeStyle = `rgba(${pal.graph},${(0.45 + near * 0.5).toFixed(3)})`;
        ctx.lineWidth = 1.1 + near * 1.5;
        ctx.shadowColor = `rgba(${pal.graph},0.5)`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(A.sx, A.sy);
        ctx.lineTo(A.sx + (B.sx - A.sx) * f, A.sy + (B.sy - A.sy) * f);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // ── Nodes, sorted far → near ──
    const order = P.map((p, i) => i).sort((a, b) => P[b].z - P[a].z);

    order.forEach((i) => {
      const n = nodes[i], p = P[i];
      const near = 1 - p.depth;                        // 1 = closest to camera
      const isHot = traceT >= 0 && cycleSet.has(i);
      const isHov = i === hov;
      const isNbr = hov >= 0 && neighbours[hov].has(i);
      const base = (n.core ? 4.2 : 2.6) * p.scale;
      const twinkle = 0.85 + Math.sin(now * 0.0011 + n.pulse) * 0.15;
      const r = base * (isHov ? 1.9 : isHot ? 1.5 : isNbr ? 1.25 : 1);
      const rgb = isHov || isNbr ? pal.warm : isHot ? pal.graph : (n.core ? pal.graph : pal.fg);
      const alpha = isHov || isNbr ? 1 : (0.2 + near * 0.75) * twinkle * (isHot ? 1 : 0.9) * (hov >= 0 ? 0.6 : 1);

      // Volumetric halo — stronger the nearer the node is
      const glowR = r * (isHot ? 7 : n.core ? 5 : 3.4);
      const g = ctx.createRadialGradient(p.sx, p.sy, r * 0.3, p.sx, p.sy, glowR);
      g.addColorStop(0, `rgba(${rgb},${(alpha * (isHot ? 0.5 : 0.22)).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Ring
      ctx.strokeStyle = `rgba(${rgb},${(alpha * 0.45).toFixed(3)})`;
      ctx.lineWidth = 0.8 * p.scale;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r * 2.1, 0, Math.PI * 2);
      ctx.stroke();

      // Core dot
      ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.fill();

      // The inspected entity always names itself, with its degree
      if (isHov) {
        ctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = `rgb(${pal.warm})`;
        ctx.textAlign = 'left';
        ctx.fillText(`${n.id} · ${neighbours[i].size} edges`, p.sx + r * 2.6, p.sy - r * 1.6);
        return;
      }
      // Labels only on near-side nodes, so the back of the sphere stays clean
      if (near > 0.55 && (n.core || i % 2 === 0)) {
        ctx.font = `${(8.5 * p.scale).toFixed(1)}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillStyle = `rgba(${rgb},${((near - 0.55) * 1.5).toFixed(3)})`;
        ctx.textAlign = 'left';
        ctx.fillText(n.id, p.sx + r * 2.6, p.sy - r * 1.6);
      }
    });
  }
  requestAnimationFrame(frame);

  // ── Cypher HUD loop ──────────────────────────
  const cypherLines = [
    'MATCH (a:Entity)-[:INVOICE*1..5]->(a)',
    'MATCH (a)-[r:GSTIN]->(b) WHERE r.pattern="circular"',
    'CALL apoc.periodic.iterate("MATCH cycle...")',
    'RETURN a, collect(nodes) AS path, sum(amount) AS flow',
  ];
  const cypherEl = document.getElementById('cypher-line');
  const nodeCountEl = document.getElementById('node-count');
  const detectEl = document.getElementById('detect-line');
  let cypherIdx = 0, running = false;

  // The four narrative blocks beside the canvas follow the loop: each lights
  // while the graph is doing that step.
  const phaseBlocks = document.querySelectorAll('.case--graphgst [data-phase]');
  const setPhase = (name) => phaseBlocks.forEach((b) => b.classList.toggle('is-phase', b.dataset.phase === name));

  function typeText(el, text, speed = 20) {
    return new Promise((resolve) => {
      if (!el) return resolve();
      el.textContent = '';
      let i = 0;
      const step = () => {
        el.textContent = text.slice(0, i);
        i++;
        if (i <= text.length) setTimeout(step, speed);
        else resolve();
      };
      step();
    });
  }

  function animateTrace(to, duration) {
    return new Promise((resolve) => {
      const from = traceT < 0 ? 0 : traceT;
      const start = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        traceT = from + (to - from) * eased;
        if (p < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  async function loop() {
    if (running) return;
    running = true;
    while (running) {
      setPhase('ingest');
      await typeText(nodeCountEl,
        `${(Math.random() * 400 + 800).toFixed(0)} entities · ${(Math.random() * 6000 + 3000).toFixed(0)} edges`, 12);
      await new Promise(r => setTimeout(r, 500));
      setPhase('traverse');
      await typeText(cypherEl, cypherLines[cypherIdx++ % cypherLines.length], 22);
      await new Promise(r => setTimeout(r, 250));
      traceT = 0;
      await animateTrace(1, reduced ? 1 : 1900);
      setPhase('verify');
      await typeText(detectEl, 'isolation forest · scoring subgraph…', 15);
      await new Promise(r => setTimeout(r, 1100));
      setPhase('explain');
      await typeText(detectEl, '1 circular trade cycle · 5 entities · flagged', 15);
      await new Promise(r => setTimeout(r, 3000));
      traceT = -1;
      await new Promise(r => setTimeout(r, 450));
    }
    setPhase(null);
  }

  const io2 = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) loop(); else running = false; });
  }, { threshold: 0.25 });
  io2.observe(canvas);

  edges.forEach(([a, b]) => { neighbours[a].add(b); neighbours[b].add(a); });
})();
