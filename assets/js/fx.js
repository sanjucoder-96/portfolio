/* FX — shared interaction primitives for everything below the hero.
   ─────────────────────────────────────────────────────────────────
   One place for the things every section needs, so no viz rolls its own
   observer, frame loop or pointer maths:

     FX.loop(el, fn)        frame callback that only runs while `el` is on
                            screen and the tab is visible (one shared rAF)
     FX.inView(el, cb)      fire once (or toggle) when `el` enters view
     FX.progress(el, cb)    scroll-linked 0..1 for `el`, rAF-throttled
     FX.canvas2d(canvas)    DPR-aware 2D context that tracks its own size
     FX.tilt(el)            pointer tilt that settles and then stops
     FX.scramble(el)        short decode effect for mono labels
     FX.splitWords(el)      wrap words in spans, keeping inline children
     FX.pal                 theme colours as rgb triplets for canvases

   Declarative hooks (no JS needed at the call site):
     [data-spot]            pointer-following light  → --mx / --my
     [data-tilt]            pointer tilt
     [data-scene="x"]       sets body[data-scene] while it owns the viewport

   Loaded before every other script. Nothing here depends on GSAP. */

(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hoverable = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement;

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

  // ── Theme palette (rgb triplets, canvas-safe) ──
  const pal = { fg: '242,241,234', fg3: '138,137,131', bg: '10,10,11', graph: '124,217,192',
                warm: '229,178,93', agent: '168,151,245', java: '240,131,108', edge: '180,200,195', isLight: false };
  function readTheme() {
    const s = getComputedStyle(root);
    const get = (name, fallback) => (s.getPropertyValue(name) || fallback).trim() || fallback;
    pal.fg    = get('--rgb-fg', pal.fg);
    pal.fg3   = get('--rgb-fg-3', pal.fg3);
    pal.bg    = get('--rgb-bg', pal.bg);
    pal.graph = get('--rgb-graph', pal.graph);
    pal.warm  = get('--rgb-warm', pal.warm);
    pal.agent = get('--rgb-agent', pal.agent);
    pal.java  = get('--rgb-java', pal.java);
    pal.edge  = get('--canvas-edge', pal.edge);
    pal.isLight = root.getAttribute('data-theme') === 'light';
  }
  readTheme();
  window.addEventListener('themechange', readTheme);

  // ── Shared frame loop ──
  const loops = new Set();
  let rafId = 0;
  function frame(now) {
    rafId = 0;
    let any = false;
    loops.forEach((l) => {
      if (!l.on) return;
      any = true;
      const dt = Math.min(50, now - l.last);
      l.last = now;
      l.fn(now, dt);
    });
    if (any && !document.hidden) rafId = requestAnimationFrame(frame);
  }
  function wake() { if (!rafId && !document.hidden) rafId = requestAnimationFrame(frame); }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const now = performance.now();
    loops.forEach((l) => { l.last = now; });
    wake();
  });

  function loop(el, fn, { margin = '80px' } = {}) {
    const l = { fn, on: false, last: performance.now() };
    loops.add(l);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        l.on = e.isIntersecting;
        if (l.on) { l.last = performance.now(); wake(); }
      });
    }, { rootMargin: margin });
    io.observe(el);
    return {
      get running() { return l.on; },
      stop() { io.disconnect(); loops.delete(l); },
    };
  }

  // ── Enter view ──
  function inView(el, cb, { threshold = 0.2, margin = '0px', once = true } = {}) {
    if (!el) return null;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (once) {
          if (!e.isIntersecting) return;
          io.disconnect();
          cb(true);
        } else cb(e.isIntersecting);
      });
    }, { threshold, rootMargin: margin });
    io.observe(el);
    return io;
  }

  // ── Scroll-linked progress ──
  //  start / end are viewport fractions (0 = top edge, 1 = bottom edge).
  //  p = 0 when the element's top reaches `start`; p = 1 when its top (or its
  //  bottom, with span: true) reaches `end`.
  const scrubs = [];
  let scrubQueued = false;
  function runScrubs() {
    scrubQueued = false;
    const vh = window.innerHeight;
    for (const s of scrubs) {
      if (!s.near) continue;
      const r = s.el.getBoundingClientRect();
      const from = vh * s.start, to = vh * s.end;
      const dist = from - to + (s.span ? r.height : 0);
      const p = dist > 0 ? clamp((from - r.top) / dist) : 1;
      if (Math.abs(p - s.p) < 0.0005) continue;
      s.p = p;
      s.cb(p);
    }
  }
  function queueScrubs() { if (!scrubQueued) { scrubQueued = true; requestAnimationFrame(runScrubs); } }
  window.addEventListener('scroll', queueScrubs, { passive: true });
  window.addEventListener('resize', queueScrubs);

  function progress(el, cb, { start = 0.85, end = 0.25, span = false } = {}) {
    if (!el) return;
    const s = { el, cb, start, end, span, p: -1, near: true };
    scrubs.push(s);
    new IntersectionObserver((entries) => {
      entries.forEach((e) => { s.near = e.isIntersecting; if (s.near) queueScrubs(); });
    }, { rootMargin: '25% 0px 25% 0px' }).observe(el);
    queueScrubs();
  }

  // ── Canvas helper ──
  function canvas2d(canvas, onResize) {
    const ctx = canvas.getContext('2d', { alpha: true });
    const st = { ctx, W: 1, H: 1 };
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      st.W = Math.max(1, r.width);
      st.H = Math.max(1, r.height);
      canvas.width = Math.round(st.W * dpr);
      canvas.height = Math.round(st.H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (onResize) onResize(st);
    };
    new ResizeObserver(fit).observe(canvas);
    fit();
    return st;
  }

  // ── Pointer light — one delegated listener for every [data-spot] ──
  if (hoverable) {
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest ? e.target.closest('[data-spot]') : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
    }, { passive: true });
  }

  // ── Tilt — eases toward the pointer, then stops its own loop ──
  function tilt(el, { max = 5 } = {}) {
    if (!hoverable || reduced || !el) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, inside = false;
    const step = () => {
      cx = lerp(cx, tx, 0.14);
      cy = lerp(cy, ty, 0.14);
      el.style.setProperty('--tilt-x', cx.toFixed(3) + 'deg');
      el.style.setProperty('--tilt-y', cy.toFixed(3) + 'deg');
      const settled = Math.abs(cx - tx) < 0.01 && Math.abs(cy - ty) < 0.01;
      if (settled && !inside) { raf = 0; el.classList.remove('is-tilting'); return; }
      raf = requestAnimationFrame(step);
    };
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      tx = -ny * max * 2;
      ty = nx * max * 2;
      inside = true;
      if (!raf) { el.classList.add('is-tilting'); raf = requestAnimationFrame(step); }
    });
    el.addEventListener('pointerleave', () => { tx = 0; ty = 0; inside = false; });
  }

  // ── Scramble — brief decode for mono labels ──
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/·—';
  function scramble(el, { duration = 520 } = {}) {
    if (!el || reduced) return;
    const text = el.dataset.text || el.textContent;
    el.dataset.text = text;
    const t0 = performance.now();
    const step = (now) => {
      const p = clamp((now - t0) / duration);
      const shown = Math.floor(p * text.length);
      let out = text.slice(0, shown);
      for (let i = shown; i < text.length; i++) {
        const ch = text[i];
        out += /\s/.test(ch) ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = text;
    };
    requestAnimationFrame(step);
  }

  // ── Split into word spans (inline children survive) ──
  function splitWords(el, cls = 'w') {
    const words = [];
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const span = document.createElement('span');
            span.className = cls;
            span.textContent = part;
            words.push(span);
            frag.appendChild(span);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1) walk(child);
      });
    };
    walk(el);
    return words;
  }

  // ── Scene tracking — whichever [data-scene] owns the viewport middle ──
  function initScenes() {
    const els = document.querySelectorAll('[data-scene]');
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) document.body.dataset.scene = e.target.dataset.scene;
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    els.forEach((el) => io.observe(el));
  }

  // ── Page progress line in the nav ──
  function initPageProgress() {
    const bar = document.querySelector('.nav__progress');
    if (!bar) return;
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? clamp(window.scrollY / max) : 0})`;
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    update();
  }

  function initDeclarative() {
    // Appended (not prepended) so :nth-child rules on the host keep counting the same.
    document.querySelectorAll('[data-spot]').forEach((el) => {
      const spot = document.createElement('span');
      spot.className = 'spot';
      spot.setAttribute('aria-hidden', 'true');
      el.appendChild(spot);
    });
    document.querySelectorAll('[data-tilt]').forEach((el) => tilt(el, { max: parseFloat(el.dataset.tilt) || 5 }));
    initScenes();
    initPageProgress();
  }

  root.classList.add('fx-ready');
  if (reduced) root.classList.add('fx-reduced');

  window.FX = { reduced, hoverable, pal, clamp, lerp, easeOut, wait,
                loop, inView, progress, canvas2d, tilt, scramble, splitWords };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDeclarative);
  else initDeclarative();
})();
