/* Stack — technology ecosystem
   ───────────────────────────
   The stack is a graph, not a list: technologies are nodes, "works with"
   relationships are edges, projects are sub-graphs. Hover (or tap) a node
   and its neighbourhood lights up across clusters; pick a system and the
   whole stack behind that project is traced to a hub.

   One DOM, two layouts:
     graph  wide screens with a fine pointer — nodes sit on per-cluster
            orbits, edges are drawn on a canvas beneath them
     grid   everything else — the grouped tiles, with the same tracing
            behaviour and a readout that rides the bottom of the viewport

   Nodes stay real <button>s in both, so keyboard and screen-reader access
   never depends on the canvas. */

(() => {
  const FX = window.FX;
  const eco = document.getElementById('eco');
  if (!FX || !eco) return;

  const stage = eco.querySelector('.eco__stage');
  const canvas = eco.querySelector('.eco__links');
  const groupEls = [...eco.querySelectorAll('.stack__group')];
  const chips = [...eco.querySelectorAll('[data-eco-project]')];
  const ui = {
    idle: eco.querySelector('.eco__readout-idle'),
    live: eco.querySelector('.eco__readout-live'),
    cluster: eco.querySelector('[data-eco-cluster]'),
    name: eco.querySelector('[data-eco-name]'),
    context: eco.querySelector('[data-eco-context]'),
    rel: eco.querySelector('[data-eco-rel]'),
    projects: eco.querySelector('[data-eco-projects]'),
    total: eco.querySelector('[data-eco-total]'),
  };

  const PROJECTS = {
    graph: { name: 'GraphGST',     href: '#case-graph' },
    agent: { name: 'AgentGuard',   href: '#case-agent' },
    hook:  { name: 'Hookline',     href: '#case-hook' },
    soc:   { name: 'Sociovia',     href: '#case-soc' },
    veri:  { name: 'VeriCall',     href: '#case-veri' },
    bids:  { name: 'CodeBids',     href: '#case-bids' },
    pixel: { name: 'PixelCrypt',   href: '#case-pixel' },
    nova:  { name: 'Nova',         href: '#case-nova' },
  };

  // "Works with" — declared once per pair, symmetrised below.
  const REL = {
    java: ['spring', 'jdbc', 'spring-data-jpa', 'multithreading', 'concurrency', 'oop', 'intellij', 'androidstudio', 'xml'],
    python: ['flask', 'fastapi', 'sklearn', 'isolation-forest', 'graphrag', 'gemini', 'vertex', 'neo4j', 'vscode'],
    cpp: ['c', 'oop', 'vscode'],
    c: ['linux'],
    js: ['react', 'html', 'css', 'tailwind', 'rest-apis', 'vscode'],
    ts: ['js', 'react', 'node', 'vscode'],
    kotlin: ['java', 'androidstudio', 'rest-apis'],
    node: ['js', 'websocket', 'sqlite', 'rest-apis'],
    websocket: ['react'],
    sqlite: ['python'],
    xml: ['androidstudio'],
    spring: ['spring-data-jpa', 'jdbc', 'rest-apis', 'postgres', 'mysql', 'docker', 'intellij', 'multithreading'],
    flask: ['rest-apis', 'neo4j'],
    fastapi: ['rest-apis', 'neo4j', 'graphrag'],
    jdbc: ['mysql', 'postgres'],
    'spring-data-jpa': ['postgres', 'mysql'],
    'rest-apis': ['react', 'mongodb'],
    vertex: ['gemini'],
    gemini: ['graphrag'],
    sklearn: ['isolation-forest'],
    'isolation-forest': ['neo4j'],
    graphrag: ['neo4j'],
    react: ['html', 'css', 'tailwind'],
    html: ['css'],
    css: ['tailwind'],
    git: ['github', 'bash'],
    github: ['docker'],
    docker: ['linux', 'postgres'],
    linux: ['bash'],
    multithreading: ['concurrency'],
  };

  // Cluster orbits, normalised to the stage (graph layout). Order = DOM order.
  const ORBITS = [
    { x: 0.135, y: 0.262, rx: 128, ry: 118 },   // languages (8)
    { x: 0.405, y: 0.262, rx: 128, ry: 118 },   // backend (8)
    { x: 0.650, y: 0.290, rx: 100, ry: 96 },    // ai · ml (5)
    { x: 0.888, y: 0.760, rx: 92,  ry: 88 },    // graph & data (5)
    { x: 0.102, y: 0.775, rx: 88,  ry: 84 },    // frontend (4)
    { x: 0.500, y: 0.775, rx: 262, ry: 100 },   // tools & core cs (11)
  ];

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // ── Model ──
  const nodes = [];
  const byId = new Map();
  const groups = groupEls.map((el, gi) => {
    const title = el.querySelector('h3').textContent.trim();
    const hash = (el.querySelector('.stack__hash') || {}).textContent || '';
    const g = { el, head: el.querySelector('.stack__head'), title, hash: hash.trim(), nodes: [], cx: 0, cy: 0, rx: 0, ry: 0 };
    el.querySelectorAll('.tech').forEach((btn) => {
      const name = btn.querySelector('.tech__name').textContent.trim();
      const n = {
        id: btn.dataset.brand || slug(name), el: btn, name, gi, g,
        context: btn.dataset.context || '',
        projects: (btn.dataset.project || '').split(',').map((s) => s.trim()).filter(Boolean),
        rel: new Set(), color: '#7CD9C0',
        hx: 0, hy: 0, x: 0, y: 0, s: 1, phase: (nodes.length * 2.399) % (Math.PI * 2),
      };
      nodes.push(n); byId.set(n.id, n); g.nodes.push(n);
    });
    return g;
  });
  const edges = [];
  Object.keys(REL).forEach((a) => REL[a].forEach((b) => {
    const A = byId.get(a), B = byId.get(b);
    if (!A || !B || A.rel.has(B)) return;
    A.rel.add(B); B.rel.add(A);
    edges.push({ a: A, b: B, t: Math.random() });
  }));
  if (ui.total) ui.total.textContent = nodes.length;

  function readColors() {
    const fallback = `rgb(${FX.pal.graph})`;
    nodes.forEach((n) => { n.color = getComputedStyle(n.el).getPropertyValue('--brand').trim() || fallback; });
  }
  readColors();
  window.addEventListener('themechange', () => requestAnimationFrame(readColors));

  // ── Trace state ──
  //  hover wins over pin; either is { node } or { project }.
  let hover = null, pin = null, current = null;
  const sameTrace = (a, b) => (!a && !b) || (a && b && a.node === b.node && a.project === b.project);

  function render() {
    const t = hover || pin;
    if (sameTrace(t, current)) return;
    current = t;

    const on = new Set(), rel = new Set();
    if (t && t.node) { on.add(t.node); t.node.rel.forEach((n) => rel.add(n)); }
    if (t && t.project) nodes.forEach((n) => { if (n.projects.includes(t.project)) on.add(n); });

    eco.classList.toggle('is-tracing', !!t);
    nodes.forEach((n) => {
      n.on = on.has(n); n.isRel = rel.has(n);
      n.el.classList.toggle('is-on', n.on);
      n.el.classList.toggle('is-rel', n.isRel);
      n.el.setAttribute('aria-pressed', String(!!(pin && pin.node === n)));
    });
    groups.forEach((g) => g.el.classList.toggle('is-rel', g.nodes.some((n) => n.on || n.isRel)));
    chips.forEach((c) => c.setAttribute('aria-pressed', String(!!(pin && pin.project === c.dataset.ecoProject))));

    ui.idle.hidden = !!t;
    ui.live.hidden = !t;
    if (!t) return;
    ui.projects.textContent = '';
    const link = (key, label) => {
      const a = document.createElement('a');
      a.className = 'eco__proj';
      a.href = PROJECTS[key].href;
      a.textContent = label;
      ui.projects.appendChild(a);
    };
    if (t.node) {
      const n = t.node;
      ui.cluster.textContent = `${n.g.hash} · ${n.g.title}`;
      ui.name.textContent = n.name;
      ui.context.textContent = n.context;
      ui.rel.textContent = n.rel.size ? 'works with → ' + [...n.rel].map((r) => r.name).join(' · ') : 'foundational — used across the stack';
      n.projects.forEach((key) => { if (PROJECTS[key]) link(key, PROJECTS[key].name + ' →'); });
    } else {
      const members = [...on];
      ui.cluster.textContent = 'system';
      ui.name.textContent = PROJECTS[t.project].name;
      ui.context.textContent = `${members.length} technologies from ${new Set(members.map((n) => n.gi)).size} clusters.`;
      ui.rel.textContent = members.map((n) => n.name).join(' · ');
      link(t.project, 'open case study →');
    }
  }

  nodes.forEach((n) => {
    n.el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = { node: n }; render(); } });
    n.el.addEventListener('focus', () => { hover = { node: n }; render(); });
    n.el.addEventListener('blur', (e) => { if (!stage.contains(e.relatedTarget)) { hover = null; render(); } });
    n.el.addEventListener('click', () => {
      pin = pin && pin.node === n ? null : { node: n };
      hover = null;
      render();
    });
  });
  // Hover is sticky inside the stage so the readout's links stay reachable.
  stage.addEventListener('pointerleave', () => { hover = null; render(); });
  chips.forEach((c) => {
    const key = c.dataset.ecoProject;
    c.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = { project: key }; render(); } });
    c.addEventListener('pointerleave', () => { hover = null; render(); });
    c.addEventListener('click', () => {
      pin = pin && pin.project === key ? null : { project: key };
      hover = null;
      render();
    });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (pin || hover)) { pin = null; hover = null; render(); } });

  // Readout links are created on the fly, so they miss main.js's anchor binding.
  ui.projects.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    const target = a && document.getElementById(a.getAttribute('href').slice(1));
    if (!target) return;
    e.preventDefault();
    if (window.__lenis) window.__lenis.scrollTo(target, { offset: -20, duration: 1.4 });
    else target.scrollIntoView({ behavior: FX.reduced ? 'auto' : 'smooth' });
  });

  // ── Graph layout ──
  let graph = false, W = 1, H = 1, k = 1, ctx = null;
  let introAt = 0, entered = false;
  let mx = -9999, my = -9999;

  // n points at equal arc length around an ellipse (equal angles bunch at the long ends)
  function ellipsePoints(cx, cy, rx, ry, n) {
    const STEPS = 720, pts = [], cum = [0];
    for (let i = 0; i <= STEPS; i++) {
      const a = -Math.PI / 2 + (i / STEPS) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
      if (i) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = cum[STEPS], out = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const target = (i / n) * total;
      while (cum[j] < target) j++;
      out.push(pts[j]);
    }
    return out;
  }

  function layout() {
    const wantGraph = FX.hoverable && window.innerWidth >= 1200;
    if (wantGraph !== graph) {
      graph = wantGraph;
      eco.classList.toggle('eco--graph', graph);
      if (!graph) nodes.forEach((n) => { n.el.style.transform = ''; });
    }
    if (!graph) return;

    W = stage.clientWidth;
    k = FX.clamp(W / 1300, 0.86, 1.12);
    H = Math.round(800 * k);
    stage.style.setProperty('--eco-h', H + 'px');
    groups.forEach((g, gi) => {
      const o = ORBITS[gi] || ORBITS[ORBITS.length - 1];
      g.cx = o.x * W; g.cy = o.y * H; g.rx = o.rx * k; g.ry = o.ry * k;
      g.head.style.setProperty('--x', g.cx.toFixed(1) + 'px');
      g.head.style.setProperty('--y', g.cy.toFixed(1) + 'px');
      ellipsePoints(g.cx, g.cy, g.rx, g.ry, g.nodes.length).forEach((p, i) => {
        const n = g.nodes[i];
        n.hx = p[0]; n.hy = p[1];
        if (!entered) { n.x = W / 2; n.y = H / 2; }
      });
    });
    if (FX.reduced) { nodes.forEach((n) => place(n, n.hx, n.hy, 1)); draw(0); }
  }

  function place(n, x, y, s) {
    n.x = x; n.y = y; n.s = s;
    n.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
  }

  function frame(now) {
    if (!graph) return;
    const t = now / 1000;
    const intro = entered ? (now - introAt) / 1000 : 0;
    nodes.forEach((n, i) => {
      const born = entered ? FX.easeOut(FX.clamp((intro - i * 0.022) / 1.1)) : 0;
      let tx = n.hx + Math.sin(t * 0.42 + n.phase) * 4;
      let ty = n.hy + Math.cos(t * 0.37 + n.phase * 1.7) * 4;
      let ts = n.on ? 1.14 : n.isRel ? 1.05 : 1;

      const dx = mx - tx, dy = my - ty, d = Math.hypot(dx, dy);
      if (d < 150 && d > 0.5) {
        const f = (1 - d / 150);
        tx += (dx / d) * f * f * 8;
        ty += (dy / d) * f * f * 8;
        ts += f * 0.1;
      }
      tx = FX.lerp(W / 2, tx, born);
      ty = FX.lerp(H / 2, ty, born);
      ts *= 0.4 + born * 0.6;
      place(n, FX.lerp(n.x, tx, 0.16), FX.lerp(n.y, ty, 0.16), FX.lerp(n.s, ts, 0.16));
    });
    draw(now);
  }

  function draw(now) {
    if (!ctx) return;
    const P = FX.pal;
    const t = current;
    const fade = FX.reduced ? 1 : FX.clamp(((now - introAt) / 1000 - 0.5) / 1.2) * (entered ? 1 : 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';

    // orbits
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    groups.forEach((g) => {
      const lit = t && g.nodes.some((n) => n.on || n.isRel);
      ctx.strokeStyle = lit ? `rgba(${P.graph},${(0.3 * fade).toFixed(3)})` : `rgba(${P.fg},${((P.isLight ? 0.14 : 0.08) * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // relationships — quiet web at rest, lit neighbourhood when tracing a node
    edges.forEach((e) => {
      const hot = t && t.node && (e.a === t.node || e.b === t.node);
      if (hot) return;
      ctx.strokeStyle = `rgba(${P.edge},${((t ? 0.03 : (P.isLight ? 0.13 : 0.075)) * fade).toFixed(3)})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
    });

    if (t && t.node) {
      const src = t.node;
      edges.forEach((e) => {
        if (e.a !== src && e.b !== src) return;
        const dst = e.a === src ? e.b : e.a;
        const grad = ctx.createLinearGradient(src.x, src.y, dst.x, dst.y);
        grad.addColorStop(0, src.color); grad.addColorStop(1, dst.color);
        ctx.strokeStyle = grad; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(dst.x, dst.y); ctx.stroke();
        if (!FX.reduced) {
          const p = (now / 1400 + e.t) % 1;
          ctx.globalAlpha = Math.sin(p * Math.PI);
          ctx.fillStyle = dst.color;
          ctx.beginPath(); ctx.arc(FX.lerp(src.x, dst.x, p), FX.lerp(src.y, dst.y, p), 2.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      });
    } else if (t && t.project) {
      // a project is a sub-graph: every member tied to one hub
      const members = nodes.filter((n) => n.on);
      if (members.length) {
        const hx = members.reduce((s, n) => s + n.x, 0) / members.length;
        const hy = members.reduce((s, n) => s + n.y, 0) / members.length;
        members.forEach((n, i) => {
          ctx.strokeStyle = n.color; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(n.x, n.y); ctx.stroke();
          if (!FX.reduced) {
            const p = (now / 1500 + i * 0.17) % 1;
            ctx.globalAlpha = Math.sin(p * Math.PI);
            ctx.fillStyle = n.color;
            ctx.beginPath(); ctx.arc(FX.lerp(hx, n.x, p), FX.lerp(hy, n.y, p), 2.2, 0, Math.PI * 2); ctx.fill();
          }
        });
        ctx.globalAlpha = 1;
        const label = PROJECTS[t.project].name.toUpperCase();
        ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
        const tw = ctx.measureText(label).width + 22;
        ctx.fillStyle = `rgb(${P.graph})`;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(hx - tw / 2, hy - 12, tw, 24, 12); else ctx.rect(hx - tw / 2, hy - 12, tw, 24);
        ctx.fill();
        ctx.fillStyle = P.isLight ? '#fff' : '#041614';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, hx, hy + 0.5);
      }
    } else if (!FX.reduced) {
      // at rest: a few packets drift along the web so it reads as live
      for (let i = 0; i < edges.length; i += 9) {
        const e = edges[i];
        const p = (now / 3200 + e.t) % 1;
        ctx.fillStyle = `rgba(${P.graph},${(Math.sin(p * Math.PI) * 0.7 * fade).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(FX.lerp(e.a.x, e.b.x, p), FX.lerp(e.a.y, e.b.y, p), 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  FX.canvas2d(canvas, (s) => { ctx = s.ctx; });
  new ResizeObserver(layout).observe(stage);
  window.addEventListener('resize', layout);
  layout();

  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    mx = e.clientX - r.left; my = e.clientY - r.top;
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { mx = -9999; my = -9999; });

  FX.inView(eco, () => {
    entered = true; introAt = performance.now();
    eco.classList.add('is-in');
    if (FX.reduced) { introAt = -1e6; layout(); }
  }, { threshold: 0.05 });

  if (!FX.reduced) FX.loop(stage, frame);
  else window.addEventListener('themechange', () => requestAnimationFrame(() => { if (graph) draw(0); }));

  // Under reduced motion the canvas only repaints when the trace changes.
  if (FX.reduced) {
    const paint = () => { if (graph) draw(0); };
    eco.addEventListener('pointerover', paint);
    eco.addEventListener('focusin', paint);
    eco.addEventListener('click', paint);
    stage.addEventListener('pointerleave', paint);
  }
})();
