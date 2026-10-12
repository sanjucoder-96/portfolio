/* Contact hub — the signal line and the three places it leads
   ─────────────────────────────────────────────────────────
   One line of light runs down the margin of the contact section. Its lit
   length is scrubbed by scroll: it arrives from the section above, reaches
   the email call, feeds a bus that drops into GitHub, LinkedIn and LeetCode,
   and ends in the footer. A branch opens — and its destination wakes up —
   when the line gets to it.

   Each destination then runs its own motif:
     GitHub    a commit graph; hover/focus pushes a commit down main
     LinkedIn  an identity plate that leans toward the pointer
     LeetCode  a grid where BFS finds the shortest path, a new maze each time

   Nothing here invents numbers about the profiles — the only counts shown
   (path length, cells explored) describe the maze on screen.

   Depends on fx.js. All geometry is measured, so it follows the layout at any
   width; under reduced motion the line is simply drawn and the motifs rest
   in their finished state. */

(() => {
  const FX = window.FX;
  const sec = document.getElementById('contact');
  if (!FX || !sec) return;
  const { reduced } = FX;
  const svg = sec.querySelector('.signal-line');
  const inner = sec.querySelector('.contact__inner');
  const grid = sec.querySelector('.hub__grid');
  const foot = sec.querySelector('.foot');
  const mail = document.getElementById('mail-link');
  const dests = [...sec.querySelectorAll('.dest')];
  if (!svg || !inner || !grid || !mail) return;

  // ════════════════════════════════════════════════════════════
  //  Destinations
  // ════════════════════════════════════════════════════════════
  const wake = new Map();            // element → what to start when the line reaches it

  // every destination: a small launch flourish on the way out (the link itself is never delayed)
  dests.forEach((d) => {
    d.addEventListener('click', () => {
      d.classList.remove('is-launching');
      void d.offsetWidth;
      d.classList.add('is-launching');
      setTimeout(() => d.classList.remove('is-launching'), 700);
    });
  });

  // ── GitHub: push a commit ──
  const github = sec.querySelector('.dest--github');
  if (github && !reduced) {
    let last = 0;
    const push = () => {
      const now = performance.now();
      if (now - last < 1700) return;          // let one land before the next
      last = now;
      github.classList.remove('is-push');
      void github.offsetWidth;                // restart the keyframes
      github.classList.add('is-push');
      setTimeout(() => github.classList.remove('is-push'), 1700);
    };
    github.addEventListener('pointerenter', push);
    github.addEventListener('focus', push);
  }

  // ── LinkedIn: the plate leans toward the pointer, and settles ──
  const linkedin = sec.querySelector('.dest--linkedin');
  if (linkedin && FX.hoverable && !reduced) {
    const plate = linkedin.querySelector('.idplate');
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, inside = false;
    const step = () => {
      // a loose spring: quick to follow, a little slow to come home
      cx = FX.lerp(cx, tx, inside ? 0.16 : 0.08);
      cy = FX.lerp(cy, ty, inside ? 0.16 : 0.08);
      plate.style.setProperty('--ry', (cx * 15).toFixed(2) + 'deg');
      plate.style.setProperty('--rx', (-cy * 11).toFixed(2) + 'deg');
      plate.style.setProperty('--shine', (cx * 1.6).toFixed(3));
      if (!inside && Math.abs(cx) < 0.003 && Math.abs(cy) < 0.003) { raf = 0; return; }
      raf = requestAnimationFrame(step);
    };
    linkedin.addEventListener('pointermove', (e) => {
      const r = linkedin.getBoundingClientRect();
      tx = FX.clamp((e.clientX - r.left) / r.width, 0, 1) - 0.5;
      ty = FX.clamp((e.clientY - r.top) / r.height, 0, 1) - 0.5;
      inside = true;
      if (!raf) raf = requestAnimationFrame(step);
    });
    linkedin.addEventListener('pointerleave', () => { tx = 0; ty = 0; inside = false; });
  }

  // ── LeetCode: BFS on a fresh maze ──
  const leet = sec.querySelector('.dest--leetcode');
  if (leet) {
    const maze = leet.querySelector('[data-maze]');
    const read = leet.querySelector('[data-maze-read]');
    const COLS = 13, ROWS = 7, N = COLS * ROWS;
    const START = Math.floor(ROWS / 2) * COLS, GOAL = START + COLS - 1;
    maze.style.setProperty('--cols', COLS);
    const cells = [];
    for (let i = 0; i < N; i++) { const c = document.createElement('i'); maze.appendChild(c); cells.push(c); }

    function solve(walls) {
      const dist = new Int16Array(N).fill(-1), prev = new Int16Array(N).fill(-1);
      const queue = [START];
      dist[START] = 0;
      for (let head = 0; head < queue.length; head++) {
        const at = queue[head];
        if (at === GOAL) break;
        const x = at % COLS;
        for (const next of [at - COLS, at + COLS, x > 0 ? at - 1 : -1, x < COLS - 1 ? at + 1 : -1]) {
          if (next < 0 || next >= N || walls[next] || dist[next] >= 0) continue;
          dist[next] = dist[at] + 1; prev[next] = at;
          queue.push(next);
        }
      }
      if (dist[GOAL] < 0) return null;
      const path = [];
      for (let at = GOAL; at !== -1; at = prev[at]) path.push(at);
      return { dist, path: path.reverse(), explored: queue.length };
    }

    function generate() {
      for (let tries = 0; tries < 60; tries++) {
        const walls = Array.from({ length: N }, (_, i) => i !== START && i !== GOAL && Math.random() < 0.28);
        const out = solve(walls);
        if (out && out.path.length > COLS + 1) return { walls, ...out };     // a path that has to turn is more interesting
      }
      const walls = new Array(N).fill(false);
      return { walls, ...solve(walls) };
    }

    let timers = [], running = false, visible = false, next = 0;
    function run() {
      timers.forEach(clearTimeout); timers = [];
      const m = generate();
      const reach = m.dist[GOAL];
      // snap to the new maze with transitions off, then let the search play through CSS delays
      maze.classList.add('is-reset');
      cells.forEach((c, i) => {
        c.className = m.walls[i] ? 'is-wall' : i === START ? 'is-start' : i === GOAL ? 'is-goal' : '';
        c.style.setProperty('--d', 0);
      });
      void maze.offsetWidth;
      maze.classList.remove('is-reset');
      cells.forEach((c, i) => {
        if (m.walls[i] || i === START || i === GOAL) return;
        const onPath = m.path.indexOf(i);
        if (m.dist[i] >= 0 && m.dist[i] <= reach) { c.style.setProperty('--d', m.dist[i]); c.classList.add('is-seen'); }
        if (onPath > 0 && !reduced) {
          timers.push(setTimeout(() => { c.style.setProperty('--d', onPath); c.classList.add('is-path'); }, reach * 30 + 260));
        } else if (onPath > 0) c.classList.add('is-path');
      });
      const done = () => { read.innerHTML = `bfs · shortest path <b>${m.path.length - 1} steps</b> · ${m.explored} cells explored`; };
      if (reduced) { done(); return; }
      read.textContent = 'bfs · searching…';
      running = true;
      timers.push(setTimeout(done, reach * 30 + 260 + m.path.length * 30));
      timers.push(setTimeout(() => { running = false; }, reach * 30 + 600 + m.path.length * 30));
    }
    const loop = () => {
      clearTimeout(next);
      if (!visible || reduced) return;
      next = setTimeout(() => { run(); loop(); }, 6200);
    };
    const again = () => { if (!running) { run(); loop(); } };
    leet.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') again(); });
    leet.addEventListener('focus', again);
    FX.inView(leet, (on) => { visible = on; if (on) loop(); else clearTimeout(next); }, { threshold: 0.2, once: false });
    wake.set(leet, run);
    if (reduced) run();
  }

  // ════════════════════════════════════════════════════════════
  //  The line
  // ════════════════════════════════════════════════════════════
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, cls) => { const e = document.createElementNS(NS, tag); e.setAttribute('class', cls); svg.appendChild(e); return e; };
  const trunk = { base: mk('path', 'sl__base'), glow: mk('path', 'sl__glow sl__glow--trunk'), lit: mk('path', 'sl__lit sl__lit--trunk') };
  const branches = [mail, ...dests].map((el) => ({
    el, y: 0, len: 1, open: false,
    base: mk('path', 'sl__base'), glow: mk('path', 'sl__glow'), lit: mk('path', 'sl__lit'), dash: mk('path', 'sl__dash'),
  }));
  const end = mk('circle', 'sl__end');
  const halo = mk('circle', 'sl__halo'), head = mk('circle', 'sl__head');
  end.setAttribute('r', 5); halo.setAttribute('r', 9); head.setAttribute('r', 3);

  let tx = 0, yEnd = 1, p = reduced ? 1 : 0, measured = false;

  function open(b) {
    b.open = true;
    b.lit.style.strokeDashoffset = 0; b.glow.style.strokeDashoffset = 0;
    if (!reduced) b.dash.classList.add('is-on');
    b.el.classList.add('is-in');
    const start = wake.get(b.el);
    if (start) { wake.delete(b.el); if (!reduced) start(); }
  }

  function apply(progress) {
    p = progress;
    if (!measured) return;
    const y = p * yEnd;
    trunk.lit.style.strokeDashoffset = yEnd - y;
    trunk.glow.style.strokeDashoffset = yEnd - y;
    head.setAttribute('cy', y); halo.setAttribute('cy', y);
    svg.classList.toggle('is-drawn', p > 0.002 && p < 0.998);
    end.classList.toggle('is-on', p >= 0.998);
    branches.forEach((b) => { if (!b.open && y >= b.y) open(b); });
  }

  function layout() {
    const s = sec.getBoundingClientRect();
    const r = inner.getBoundingClientRect();
    if (!s.width) return;
    const H = sec.offsetHeight;
    svg.setAttribute('width', s.width); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${s.width} ${H}`);

    // the trunk lives in the page margin, clear of the content
    const gutter = r.left - s.left;
    tx = Math.round(Math.max(7, gutter - Math.min(24, gutter * 0.5)));
    const stacked = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length < 3;
    const busY = Math.round(grid.getBoundingClientRect().top - s.top - 26);
    yEnd = Math.round((foot ? foot.getBoundingClientRect().top - s.top : H) + 44);

    const d = `M${tx} 0 V${yEnd}`;
    [trunk.base, trunk.glow, trunk.lit].forEach((path) => path.setAttribute('d', d));
    trunk.lit.style.strokeDasharray = yEnd; trunk.glow.style.strokeDasharray = yEnd;
    [head, halo, end].forEach((c) => c.setAttribute('cx', tx));
    end.setAttribute('cy', yEnd);

    branches.forEach((b, i) => {
      const port = i === 0 ? b.el.querySelector('.signal__core') : b.el.querySelector('.dest__port');
      const q = port.getBoundingClientRect();
      const px = q.left - s.left + q.width / 2, py = q.top - s.top + q.height / 2;
      let path;
      if (i === 0) { path = `M${tx} ${py} H${px - q.width / 2 - 5}`; b.y = py; }                 // straight into the call
      else if (stacked) { path = `M${tx} ${py} H${px - q.width / 2 - 2}`; b.y = py; }            // straight into each field
      else { path = `M${tx} ${busY} H${px - 9} Q${px} ${busY} ${px} ${busY + 9} V${py - q.height / 2 - 2}`; b.y = busY; }   // along the bus, then down
      [b.base, b.glow, b.lit, b.dash].forEach((el) => el.setAttribute('d', path));
      b.len = b.lit.getTotalLength();
      [b.lit, b.glow].forEach((el) => { el.style.strokeDasharray = b.len; el.style.strokeDashoffset = b.open ? 0 : b.len; });
      b.dash.style.strokeDasharray = `12 ${b.len + 12}`;
      b.dash.style.setProperty('--len', b.len.toFixed(1));
    });
    measured = true;
    apply(p);
  }

  let queued = false;
  const relayout = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; layout(); }); };
  new ResizeObserver(relayout).observe(sec);
  new ResizeObserver(relayout).observe(inner);
  window.addEventListener('resize', relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  layout();
  if (measured) sec.classList.add('hub-ready');      // from here the line decides when each destination appears

  /* Scrub: nothing lit when the section's top is low in the viewport, all of it
     lit exactly when the page can scroll no further — so the head of the line
     travels down the page a little ahead of the reader. */
  if (reduced) apply(1);
  else FX.progress(sec, apply, { start: 0.8, end: 1, span: true });

  // pause every looping motif while the section is off screen
  FX.inView(sec, (on) => sec.classList.toggle('is-live', on), { threshold: 0, once: false });

  // hovering the call quickens the whole network
  const calling = (on) => sec.classList.toggle('is-calling', on);
  mail.addEventListener('pointerenter', () => calling(true));
  mail.addEventListener('pointerleave', () => calling(false));
  mail.addEventListener('focus', () => calling(true));
  mail.addEventListener('blur', () => calling(false));
})();
