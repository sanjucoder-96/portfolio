/* Intro — the page materialises out of the particles that spell its owner's name
   ─────────────────────────────────────────────────────────────────────────────
   One 2D canvas, no dependencies (it has to run before GSAP or Three.js exist,
   and still work if they never arrive).

     drift     a loose constellation fades up out of the dark
     assemble  it pulls together into "Sanjay Utchula"
     hold      …and rests there, still and legible, for a deliberate beat (and
               for whatever is genuinely still loading)
     travel    the name shrinks into the exact glyphs of the hero headline
     release   the real headline takes over; the particles stream off toward
               the hero's particle figure and the overlay is gone

   The name is a hybrid, because particles alone cannot be both sparse enough
   to read as particles and dense enough to read as type:
     · the glyphs are rasterised once, in the hero headline's own fonts, into
       a sharp bitmap that condenses underneath the particles as they arrive
       (plus a soft glow kept behind it);
     · every particle is given its own point inside a letter — sampled on an
       even grid, no two sharing one — so strokes fill without clumps or holes;
     · once assembled nothing moves: particles sit on whole device pixels and
       only a few glint.
   The same bitmap is what travels into the hero, so the hand-off to the real
   headline is one continuous shape rather than a cross-fade between two; once
   seated it is swapped for one set at exactly the headline's size and position,
   and that stays on top until the real text has faded in beneath it.

   The boot log is real: each row settles when that thing has actually loaded
   (document.fonts, GSAP, the Three.js module, the figure's reconstruction) or
   is known to have failed. Nothing here is on a timer except the animation
   itself, and a hard cap after which the page is shown regardless.

   The gate in <head> decides whether this runs at all (window.__intro): only
   on a fresh navigation to the top of the page, once per session, never under
   reduced motion. Everything else lands here with intro.active === false.

   Events (window):  intro:handoff → intro:landed → intro:done
     handoff   motion.js starts the hero choreography, the figure starts forming
     landed    the name is sitting on the headline; it fades in underneath
     done      overlay removed, scrolling handed back

   Whatever goes wrong, done() runs: on any exception, when the tab is hidden,
   on a watchdog timer, and — if this file never executes — the overlay's own
   CSS animation hides it. */

(() => {
  'use strict';
  const root = document.documentElement;
  const intro = window.__intro || (window.__intro = { active: false, done: true, mode: 'none' });
  const el = document.getElementById('loader');
  const fire = (name) => { try { window.dispatchEvent(new Event(name)); } catch (e) { /* old engines */ } };

  if (!intro.active || !el) {
    intro.active = false; intro.done = true;
    root.classList.remove('is-intro');
    return;
  }

  intro.alive = true;                // tells the gate in <head> that this script is in charge
  const FULL = intro.mode === 'full';
  // ms. `cap` is measured from navigation start; past it the page is shown whatever is still loading.
  const T = FULL ? { drift: 420, assemble: 800, hold: 620, travel: 760, release: 720, cap: 4600 }
                 : { drift: 200, assemble: 600, hold: 320, travel: 640, release: 640, cap: 3200 };
  const GATHER = 1.45;               // assemble lasts T.assemble × this: the last particle's delay plus its own move
  const t0 = intro.t0 || performance.now();
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 4);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let raf = 0, watchdog = 0, closed = false, handed = false, landed = false;
  let ownLine = null;                               // the real headline, if this script had to hide it for the flight
  const off = [];                                   // listener disposers
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); off.push(() => target.removeEventListener(type, fn, opts)); };

  function done() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    clearTimeout(watchdog);
    off.forEach((dispose) => dispose());
    if (!handed) { handed = true; intro.handed = true; fire('intro:handoff'); }
    if (!landed) { landed = true; fire('intro:landed'); }
    if (ownLine) { ownLine.style.opacity = ''; ownLine.style.transition = ''; ownLine = null; }
    intro.active = false; intro.done = true;
    root.classList.remove('is-intro');
    if (el.parentNode) el.parentNode.removeChild(el);
    // once per session, even on a page where GSAP (which normally records this) never loaded
    try { sessionStorage.setItem('su_intro', '1'); localStorage.setItem('su_intro_seen', '1'); } catch (e) { /* storage blocked */ }
    fire('intro:done');
  }

  try {
    // ════════════════════════════════════════════════════════════
    //  What is actually loading
    // ════════════════════════════════════════════════════════════
    const steps = { type: 'wait', motion: 'wait', webgl: 'wait', figure: 'wait' };
    const rows = {};
    el.querySelectorAll('[data-step]').forEach((li) => { rows[li.dataset.step] = li; });
    const bar = el.querySelector('.loader__bar i');
    const settledState = (s) => s === 'ok' || s === 'skip';

    function mark(step, state, text) {
      if (settledState(steps[step])) return;
      steps[step] = state;
      const row = rows[step];
      if (row) { row.dataset.state = state; row.querySelector('b').textContent = text; }
      if (bar) bar.style.transform = `scaleX(${Object.values(steps).filter(settledState).length / 4})`;
    }
    const allSettled = () => Object.values(steps).every(settledState);

    // typefaces — ask for the faces the headline is set in, rather than trusting fonts.ready,
    // which resolves immediately if nothing has started loading yet
    let fontsReady = false;
    const fontsDone = (text, state) => { fontsReady = true; mark('type', state || 'ok', text); };
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('500 1em "Space Grotesk"'),
        document.fonts.load('italic 400 1em "Instrument Serif"'),
        document.fonts.load('400 1em "JetBrains Mono"'),
      ]).then((faces) => fontsDone(faces.some((f) => f && f.length) ? 'ready' : 'system fallback', faces.some((f) => f && f.length) ? 'ok' : 'skip'),
              () => fontsDone('system fallback', 'skip'));
      setTimeout(() => { if (!fontsReady) fontsDone('system fallback', 'skip'); }, 2600);
    } else fontsDone('system fallback', 'skip');

    // motion engine — the CDN scripts are synchronous, so by DOMContentLoaded they are in or they failed
    let domReady = document.readyState !== 'loading';
    const onDom = () => {
      domReady = true;
      mark('motion', window.gsap ? 'ok' : 'skip', window.gsap ? (window.Lenis ? 'gsap + lenis' : 'gsap') : 'offline · static page');
    };
    if (domReady) onDom(); else on(document, 'DOMContentLoaded', onDom);

    // webgl renderer + particle figure — reported by the hero module itself (core:stage)
    const coreFailed = (why) => { mark('webgl', 'skip', why || 'unavailable'); mark('figure', 'skip', 'skipped'); };
    const onStage = (stage) => {
      if (stage === 'engine') mark('webgl', 'ok', 'three.js');
      else if (stage === 'reference') { mark('webgl', 'ok', 'three.js'); mark('figure', 'busy', 'reconstructing'); }
      else if (stage === 'ready') { mark('webgl', 'ok', 'three.js'); mark('figure', 'ok', 'ready'); }
      else if (stage === 'failed') coreFailed(steps.webgl === 'ok' ? null : 'unavailable');
    };
    if (window.__coreStage) onStage(window.__coreStage);
    on(window, 'core:stage', (e) => onStage(e.detail && e.detail.stage));
    // a module (or one of its CDN imports) that fails to load never runs, so it cannot report —
    // resource errors do not bubble, but they can be captured
    on(window, 'error', (e) => {
      const src = e.target && e.target.tagName === 'SCRIPT' ? (e.target.src || '') : '';
      if (/computational-robot|three/.test(src)) coreFailed('offline');
    }, true);

    // ════════════════════════════════════════════════════════════
    //  Stage
    // ════════════════════════════════════════════════════════════
    const canvas = el.querySelector('.loader__canvas');
    let ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }

    let W = 0, H = 0, dpr = 1;
    const size = () => {
      W = window.innerWidth; H = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!ctx) return;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    };
    size();

    const css = getComputedStyle(root);
    const tone = (name, fallback) => (css.getPropertyValue(name) || fallback).trim() || fallback;
    const RGB = { fg: tone('--rgb-fg', '242,241,234'), accent: tone('--rgb-graph', '124,217,192'), warm: tone('--rgb-warm', '229,178,93') };

    const LIGHT = root.getAttribute('data-theme') === 'light';
    const snap = (v) => Math.round(v * dpr) / dpr;              // whole device pixels: sharp, not smeared

    // ── particles ──
    //  Enough of them that a letter is filled, not suggested: one per ~330 px² of screen.
    const N = ctx ? Math.round(clamp((W * H) / 330, 1400, 4200)) : 0;
    const P = {
      x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N),
      hx: new Float32Array(N), hy: new Float32Array(N),          // drift home
      nx: new Float32Array(N), ny: new Float32Array(N),          // place in the assembled name
      sx: new Float32Array(N), sy: new Float32Array(N),          // start of the current move
      u: new Float32Array(N), v: new Float32Array(N),            // that place, relative to its word (advance, ems)
      ox: new Float32Array(N), oy: new Float32Array(N),          // dust only: offset from the glyph, in ems
      seed: new Float32Array(N), delay: new Float32Array(N), size: new Float32Array(N),
      word: new Uint8Array(N), accent: new Uint8Array(N), dust: new Uint8Array(N),
      rim: new Uint8Array(N),                                    // sits on the edge of a stroke: drawn small, so outlines stay clean
    };
    for (let i = 0; i < N; i++) {
      P.hx[i] = Math.random() * W; P.hy[i] = Math.random() * H;
      // born slightly off their homes so the field breathes in rather than popping
      P.x[i] = P.hx[i] + (Math.random() - 0.5) * 120; P.y[i] = P.hy[i] + (Math.random() - 0.5) * 120;
      P.seed[i] = Math.random();
      P.size[i] = 1.2 + Math.random() * 0.9;
      P.accent[i] = Math.random() < 0.09 ? 1 : 0;
      P.dust[i] = Math.random() < 0.055 ? 1 : 0;       // a little loose dust around the letters keeps it from looking stamped
    }
    const NODES = Math.min(N, W < 640 ? 46 : 84);      // the few that get constellation edges while drifting

    // ── the name, in the hero headline's own fonts ──
    const NAME = [
      { text: 'Sanjay',  font: '500 %px "Space Grotesk", ui-sans-serif, system-ui, sans-serif', spacing: -0.035, px: 48, color: '' },
      { text: 'Utchula', font: 'italic 400 %px "Instrument Serif", "Times New Roman", serif',     spacing: -0.035, px: 48, color: '' },
    ];
    let words = null;          // per word: { adv, pts, bmp, glow, pad, asc, F0 }
    let sampled = null;        // the same objects, before they have bitmaps
    let big = null;            // per word: { x, y (baseline), f (font px), w (advance px) } — the assembled name
    let hero = null;           // the same, for the real headline (measured at hand-off)
    let seat = null;           // per word: the type set at exactly the headline's size and sub-pixel position
    let heroWords = [];        // the real <span class="hero__word"> elements, once the DOM has them
    let stacked = W < 640, gapEm = 0.24;
    let nameLeft = 0, nameSpan = 1;                    // horizontal extent of the assembled name
    let grain = 1;                                     // particle size once in the name, relative to its drifting size
    off.push(() => { words = sampled = seat = null; }); // let the bitmaps go when the overlay closes

    // Everything the name needs is read from the headline it will become: fonts (so theme
    // overrides are honoured), colour, letter-spacing, the gap between the two words, and
    // whether they share a line.
    function readHero() {
      heroWords = [...document.querySelectorAll('.hero__title .hero__line:first-child .hero__word')];
      heroWords.slice(0, 2).forEach((w, i) => {
        const cs = getComputedStyle(w), px = parseFloat(cs.fontSize) || 16;
        NAME[i].text = w.textContent.trim() || NAME[i].text;
        NAME[i].font = `${cs.fontStyle} ${cs.fontWeight} %px ${cs.fontFamily}`;
        NAME[i].color = cs.color;
        NAME[i].px = px;
        const ls = parseFloat(cs.letterSpacing);
        if (!Number.isNaN(ls)) NAME[i].spacing = ls / px;
      });
      if (heroWords.length >= 2) {
        const a = heroWords[0].getBoundingClientRect(), b = heroWords[1].getBoundingClientRect();
        if (a.width > 4 && b.width > 4) {
          // on a phone one line would be a third of the size: two big lines there, even though the
          // headline they fly into sets the words side by side (each word travels on its own)
          stacked = W < 640 || Math.abs(a.top - b.top) > a.height * 0.5;
          if (b.left > a.right) gapEm = clamp((b.left - a.right) / NAME[0].px, 0.12, 0.5);
        }
      }
    }

    const setFont = (x, def, F) => { x.font = def.font.replace('%', F); if ('letterSpacing' in x) x.letterSpacing = (def.spacing * F).toFixed(2) + 'px'; };

    // Where the ink is: every point of an even 2px grid that falls inside the glyphs. Each is
    // marked as body or rim (a neighbour is already outside), because a full-size particle on
    // the rim of a stroke hangs over its edge and roughens the outline; hairlines are all rim.
    function sampleWord(def) {
      const F = 150;
      const c = document.createElement('canvas');
      const x = c.getContext('2d', { willReadFrequently: true });
      setFont(x, def, F);
      const adv = Math.max(1, x.measureText(def.text).width);
      const pad = Math.ceil(F * 0.25), asc = Math.ceil(F * 1.05);
      c.width = Math.ceil(adv + pad * 2); c.height = asc + Math.ceil(F * 0.4);
      setFont(x, def, F);                                  // resizing a canvas resets its state
      x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
      x.fillText(def.text, pad, asc);
      const cw = c.width, ch = c.height;
      const data = x.getImageData(0, 0, cw, ch).data;
      const ink = (px, py) => (px < 0 || py < 0 || px >= cw || py >= ch ? 0 : data[(py * cw + px) * 4 + 3]);
      const pts = [];
      for (let py = 0; py < ch; py += 2) {
        for (let px = 0; px < cw; px += 2) {
          if (ink(px, py) < 112) continue;
          const rim = Math.min(ink(px - 2, py), ink(px + 2, py), ink(px, py - 2), ink(px, py + 2)) < 128 ? 1 : 0;
          pts.push([(px - pad) / adv, (py - asc) / F, rim]);
        }
      }
      return { adv: adv / F, pts };
    }

    // The crisp layer: the word set once at the size (and pixel density) it is held at,
    // and a soft glow of it at a third of that.
    function renderWord(def, adv, F0) {
      const pad = Math.ceil(F0 * 0.3), asc = Math.ceil(F0 * 1.05);
      const bmp = document.createElement('canvas');
      bmp.width = Math.ceil(adv * F0 + pad * 2); bmp.height = asc + Math.ceil(F0 * 0.42);
      const x = bmp.getContext('2d');
      setFont(x, def, F0);
      x.fillStyle = def.color || `rgb(${RGB.fg})`; x.textBaseline = 'alphabetic';
      x.fillText(def.text, pad, asc);

      const G = 3, Fg = F0 / G;
      const glow = document.createElement('canvas');
      glow.width = Math.ceil(bmp.width / G); glow.height = Math.ceil(bmp.height / G);
      const g = glow.getContext('2d');
      setFont(g, def, Fg);
      g.textBaseline = 'alphabetic';
      // only the shadow is wanted: draw the text far off-canvas and offset its shadow back in
      const OFF = glow.width + 64;
      g.shadowColor = `rgba(${RGB.accent},1)`; g.shadowBlur = Fg * 0.2; g.shadowOffsetX = OFF;
      g.fillStyle = '#000';
      g.fillText(def.text, pad / G - OFF, asc / G);
      return { bmp, glow, pad, asc, F0 };
    }

    // Building the name is the one expensive thing the intro does (glyph readback, two large
    // bitmaps), so it comes in three pieces that can be spread over three frames.
    function measure() {
      readHero();
      sampled = NAME.map(sampleWord);
      // canvas readback can be blocked or randomised (privacy modes): without real glyphs there is no name to form
      return !sampled.some((w) => w.pts.length < 60);
    }

    function typeset() {
      let F, origin;
      if (stacked) {
        F = Math.min((W * 0.84) / Math.max(sampled[0].adv, sampled[1].adv), H * 0.17, 132);
        F = Math.round(F * dpr) / dpr;                     // a whole number of device pixels: the held type is blitted 1:1
        origin = [
          { x: (W - sampled[0].adv * F) / 2, y: H * 0.45 },
          { x: (W - sampled[1].adv * F) / 2, y: H * 0.45 + F * 1.06 },   // enough leading that descenders clear the line below
        ];
      } else {
        const total = sampled[0].adv + gapEm + sampled[1].adv;
        F = Math.min((W * 0.82) / total, H * 0.25, 216);
        F = Math.round(F * dpr) / dpr;
        // on a short screen (a phone on its side) sit a little higher, clear of the status rows
        const x0 = (W - total * F) / 2, y = H * 0.5 + F * 0.3 - Math.max(0, 520 - H) * 0.2;
        origin = [{ x: x0, y }, { x: x0 + (sampled[0].adv + gapEm) * F, y }];
      }
      big = origin.map((o, k) => ({ x: snap(o.x), y: snap(o.y), f: F, w: sampled[k].adv * F }));
      words = sampled.map((w, k) => Object.assign(w, renderWord(NAME[k], w.adv, Math.max(24, Math.round(F * dpr)))));
    }

    // One glyph point per particle, dealt from a shuffled deck so none is shared and every
    // stroke — the hairlines of the italic included — gets its share.
    function deal() {
      const F = big[0].f;
      const deck = [];
      words.forEach((w, k) => w.pts.forEach((pt) => deck.push(k, pt[0], pt[1], pt[2])));
      const cards = deck.length / 4;
      for (let i = cards - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        for (let c = 0; c < 4; c++) { const t = deck[i * 4 + c]; deck[i * 4 + c] = deck[j * 4 + c]; deck[j * 4 + c] = t; }
      }
      grain = clamp(F / 120, 0.7, 1.15);                // small type gets finer grain, or it turns to gravel
      const left = nameLeft = Math.min(big[0].x, big[1].x);
      const span = nameSpan = Math.max(1, Math.max(big[0].x + big[0].w, big[1].x + big[1].w) - left);
      for (let i = 0; i < N; i++) {
        const c = (i % cards) * 4, k = deck[c];
        // past the end of the deck (very large screens) points are reused, nudged half a grid step
        const again = i >= cards ? 0.004 : 0;
        P.word[i] = k; P.u[i] = deck[c + 1] + again; P.v[i] = deck[c + 2] + again;
        P.rim[i] = P.dust[i] ? 0 : deck[c + 3];
        P.ox[i] = P.dust[i] ? (Math.random() - 0.5) * 0.5 : 0;
        P.oy[i] = P.dust[i] ? (Math.random() - 0.5) * 0.6 : 0;
        P.nx[i] = big[k].x + P.u[i] * big[k].w + P.ox[i] * F;
        P.ny[i] = big[k].y + P.v[i] * F + P.oy[i] * F;
        // left-to-right sweep, loosened so it reads as gathering rather than wiping
        P.delay[i] = clamp((P.nx[i] - left) / span) * 0.3 + P.seed[i] * 0.15;
      }
    }

    function buildName() {
      if (!measure()) return false;
      typeset(); deal();
      return true;
    }

    // where the name belongs in the real headline
    function aimAtHero() {
      if (!words || heroWords.length < 2) return false;
      const out = heroWords.slice(0, 2).map((w) => {
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        w.insertBefore(probe, w.firstChild);
        const base = probe.getBoundingClientRect().bottom;      // an empty inline-block sits on the baseline
        probe.remove();
        const r = w.getBoundingClientRect();
        return { x: r.left, y: base, f: parseFloat(getComputedStyle(w).fontSize) || 16, w: r.width, ok: r.width > 4 && r.bottom > 0 && r.top < H };
      });
      if (!out.every((r) => r.ok)) return false;
      hero = out;
      seat = setSeat(out);
      return true;
    }

    // The flight carries the big bitmap, scaled down — fine in motion, a little soft at rest.
    // So for the moment the name sits in the headline it is set again at exactly that size, on
    // exactly those sub-pixels: the swap to the real text is then glyph for glyph.
    function setSeat(at) {
      if (!('letterSpacing' in ctx)) return null;      // without it canvas type is wider than the headline's
      const made = at.map((L, k) => {
        const F0 = L.f * dpr, pad = Math.ceil(F0 * 0.3), asc = Math.ceil(F0 * 1.05);
        const px = L.x * dpr, py = L.y * dpr, ix = Math.floor(px), iy = Math.floor(py);
        const c = document.createElement('canvas');
        c.width = Math.ceil(L.w * dpr) + pad * 2 + 1; c.height = asc + Math.ceil(F0 * 0.42) + 1;
        const x = c.getContext('2d');
        setFont(x, NAME[k], F0);
        if (Math.abs(x.measureText(NAME[k].text).width - L.w * dpr) > 1.5) return null;   // not the headline's metrics after all
        x.fillStyle = NAME[k].color || `rgb(${RGB.fg})`; x.textBaseline = 'alphabetic';
        x.fillText(NAME[k].text, pad + (px - ix), asc + (py - iy));
        return { bmp: c, x: (ix - pad) / dpr, y: (iy - asc) / dpr, w: c.width / dpr, h: c.height / dpr };
      });
      return made.every(Boolean) ? made : null;
    }

    // ════════════════════════════════════════════════════════════
    //  Timeline
    // ════════════════════════════════════════════════════════════
    let phase = 'drift', phaseAt = performance.now(), named = false, plain = !ctx, skipping = false;
    let prep = 0;                      // how much of the name is built: 0 nothing · 1 measured · 2 typeset · 3 dealt
    let travelMs = T.travel, aimed = false, landedAt = 0;
    let textA = 0, glowA = 0;          // how present the crisp name and its glow are (eased every frame)
    let reveal = -1;                   // the type's leading edge, in name-widths: it sweeps in behind the particles
    const TEXT_HOLD = 0.86;            // not quite solid while held, so the grain of the particles still shows
    const GLOW_HOLD = LIGHT ? 0.2 : 0.42;
    const since = () => performance.now() - phaseAt;
    const enter = (name) => {
      phase = name; phaseAt = performance.now();
      for (let i = 0; i < N; i++) { P.sx[i] = P.x[i]; P.sy[i] = P.y[i]; }
    };

    function unlock() { el.classList.add('is-leaving'); }
    function land() {
      if (landed) return;
      landed = true; landedAt = performance.now();
      fire('intro:landed');
      if (ownLine) { ownLine.style.transition = 'opacity .45s ease'; ownLine.style.opacity = '1'; }
    }

    function handoff() {
      if (handed) return;
      handed = true;
      intro.handed = true;
      unlock();
      fire('intro:handoff');                    // motion.js seats the headline synchronously in its listener…
      aimed = !plain && named && aimAtHero();   // …so it can be measured here
      // …and hides it until the flight lands. Without the motion engine (its CDN failed) nobody
      // does, and the name would be on screen twice — so hide it here, and show it on landing.
      const line = aimed && heroWords[0].closest('.hero__line-inner');
      if (line && +getComputedStyle(line).opacity > 0.5) {
        ownLine = line; line.style.transition = 'none'; line.style.opacity = '0';
      }
      if (!aimed) land();
      enter(aimed ? 'travel' : 'release');
    }

    function goPlain() {
      // no canvas, or no readable glyphs: the name is set in type instead and the overlay simply lifts
      plain = true;
      el.classList.add('loader--plain');
    }

    const ready = () => domReady && fontsReady && (allSettled() || performance.now() - t0 > T.cap);

    function advance() {
      const t = since();
      if (phase === 'drift') {
        if (plain) { if (t > T.drift + T.assemble) enter('hold'); return; }
        // glyphs need the DOM (for the headline's fonts) and the fonts themselves
        if (!domReady || !(fontsReady || t > 1400)) return;
        // built over the last frames of the drift, a piece per frame, so no frame carries all of it
        if (prep < 3) {
          if (t < T.drift - 100) return;
          if (prep === 0) { if (!measure()) { goPlain(); return; } }
          else if (prep === 1) typeset();
          else deal();
          prep++;
          return;
        }
        if (t > T.drift) { named = true; enter('assemble'); }
      } else if (phase === 'assemble') {
        if (t > T.assemble * GATHER) enter('hold');
      } else if (phase === 'hold') {
        if (t > T.hold && ready()) handoff();
      } else if (phase === 'travel') {
        if (t > travelMs * 0.95) land();
        if (t > travelMs) enter('release');
      } else if (phase === 'release') {
        if (t > (plain ? 460 : T.release) && textA < 0.03) done();     // never cut while the name is still showing
      }
    }

    // the name's position and size right now: assembled, in flight, or seated in the headline
    const flight = [{ x: 0, y: 0, f: 1, w: 1 }, { x: 0, y: 0, f: 1, w: 1 }];
    function layoutNow() {
      if (!aimed || !hero) return big;
      if (phase === 'release') return hero;
      if (phase !== 'travel') return big;
      const q = clamp(since() / travelMs);
      // Two lines becoming one (phones): moved together the words would pass through each
      // other. So both shrink and slide first, and the second rises into its place last.
      const merge = stacked && Math.abs(hero[1].y - hero[0].y) < hero[0].f * 0.5;
      const p = easeInOut(merge ? clamp(q / 0.7) : q);
      for (let k = 0; k < 2; k++) {
        const rise = merge && k === 1 ? easeInOut(clamp((q - 0.3) / 0.7)) : p;
        flight[k].x = lerp(big[k].x, hero[k].x, p); flight[k].y = lerp(big[k].y, hero[k].y, rise);
        flight[k].f = lerp(big[k].f, hero[k].f, p); flight[k].w = lerp(big[k].w, hero[k].w, p);
      }
      return flight;
    }

    // ── motion ──
    function step(now, dt) {
      const t = since();
      const fx = W * (W < 760 ? 0.6 : 0.69), fy = H * 0.46;         // roughly where the hero figure stands
      const at = phase === 'travel' ? layoutNow() : null;
      const lock = phase === 'travel' ? easeOut(clamp(t / (travelMs * 0.42))) : 1;   // particles catch the moving letters, then ride them
      for (let i = 0; i < N; i++) {
        if (phase === 'drift' || (phase === 'assemble' && t < P.delay[i] * T.assemble)) {
          const a = now * 0.00042 + P.seed[i] * 6.283;
          const gx = P.hx[i] + Math.sin(a) * 26, gy = P.hy[i] + Math.cos(a * 1.3) * 26;
          P.vx[i] = (P.vx[i] + (gx - P.x[i]) * 0.012) * 0.9;
          P.vy[i] = (P.vy[i] + (gy - P.y[i]) * 0.012) * 0.9;
          P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
          P.sx[i] = P.x[i]; P.sy[i] = P.y[i];
        } else if (phase === 'assemble') {
          const p = easeOut(clamp((t - P.delay[i] * T.assemble) / T.assemble));
          // a slight arc on the way in, so the gather has depth instead of straight lines
          const bow = Math.sin(p * Math.PI) * (P.seed[i] - 0.5) * 90;
          P.x[i] = lerp(P.sx[i], P.nx[i], p) + bow * 0.4;
          P.y[i] = lerp(P.sy[i], P.ny[i], p) + bow;
        } else if (phase === 'hold') {
          // still. Only the dust around the letters keeps drifting.
          if (P.dust[i]) {
            const a = now * 0.0007 + P.seed[i] * 40;
            P.x[i] = P.nx[i] + Math.sin(a) * 5; P.y[i] = P.ny[i] + Math.cos(a * 1.3) * 5;
          } else { P.x[i] = P.nx[i]; P.y[i] = P.ny[i]; }
        } else if (phase === 'travel') {
          const L = at[P.word[i]];
          const gx = L.x + P.u[i] * L.w + P.ox[i] * L.f, gy = L.y + P.v[i] * L.f + P.oy[i] * L.f;
          P.x[i] = lerp(P.sx[i], gx, lock); P.y[i] = lerp(P.sy[i], gy, lock);
          P.vx[i] = 0; P.vy[i] = 0;
        } else {
          // release: a third stream toward the figure, the rest lift off where they are
          if (P.seed[i] < 0.34) {
            const dx = fx - P.x[i], dy = fy - P.y[i], d = Math.hypot(dx, dy) || 1;
            P.vx[i] = (P.vx[i] + (dx / d) * 0.9 + (dy / d) * 0.35) * 0.965;
            P.vy[i] = (P.vy[i] + (dy / d) * 0.9 - (dx / d) * 0.35) * 0.965;
          } else {
            P.vx[i] = (P.vx[i] + (P.seed[i] - 0.5) * 0.16) * 0.97;
            P.vy[i] = (P.vy[i] - 0.05 - P.seed[i] * 0.05) * 0.97;
          }
          P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
        }
      }
    }

    function drawName(layout) {
      if (seat && phase === 'release') {
        ctx.globalAlpha = textA;
        for (let k = 0; k < 2; k++) ctx.drawImage(seat[k].bmp, seat[k].x, seat[k].y, seat[k].w, seat[k].h);
        ctx.globalAlpha = 1;
        return;
      }
      for (let k = 0; k < 2; k++) {
        const w = words[k], L = layout[k];
        const kx = L.w / (w.adv * w.F0), ky = L.f / w.F0;          // bitmap px → CSS px, per axis
        const x = L.x - w.pad * kx, y = L.y - w.asc * ky, bw = w.bmp.width * kx, bh = w.bmp.height * ky;
        if (glowA > 0.01) { ctx.globalAlpha = glowA; ctx.drawImage(w.glow, x, y, bw, bh); }
        ctx.globalAlpha = textA;
        ctx.drawImage(w.bmp, x, y, bw, bh);
      }
      ctx.globalAlpha = 1;
      if (reveal >= 2) return;
      // The type only shows where particles have already landed: the same left-to-right
      // sweep they arrive in, with an edge as soft as the name is wide.
      const x1 = nameLeft + nameSpan * reveal;
      const g = ctx.createLinearGradient(x1 - nameSpan, 0, x1, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    function paint(now, lapse) {
      const t = since();
      ctx.clearRect(0, 0, W, H);
      const born = clamp((now - t0) / 420);

      // the crisp name first (it is masked, and the mask must not eat anything else)
      let wantText = 0, wantGlow = 0;
      if (phase === 'assemble') {
        wantText = TEXT_HOLD; wantGlow = GLOW_HOLD;
        // a particle has visibly locked ~0.62 of the way through its (eased) move; the type follows that front
        reveal = (t / T.assemble - 0.62) / 0.3;
      } else if (phase !== 'drift') {
        reveal = Math.min(2, reveal + lapse * 0.12);     // left early: let the sweep finish, quickly
        if (phase === 'hold') { wantText = TEXT_HOLD; wantGlow = GLOW_HOLD; }
        else if (phase === 'travel') wantText = 1;
        // seated in the headline, it stays until the real one has faded in over it — then it lets go
        else if (aimed) wantText = now - landedAt < 440 ? 1 : 0;
      }
      const ease = 1 - Math.pow(0.8, lapse);         // by the clock, not the frame count: a slow device fades just as fast
      textA = lerp(textA, wantText, ease); glowA = lerp(glowA, wantGlow, ease);
      const layout = words ? layoutNow() : null;
      if (layout && (textA > 0.01 || glowA > 0.01)) drawName(layout);

      // constellation edges while the field is loose
      const loose = phase === 'drift' ? 1 : phase === 'assemble' ? 1 - clamp(t / (T.assemble * 0.7)) : 0;
      if (loose > 0.01) {
        ctx.lineWidth = 0.6;
        const reach = W < 640 ? 96 : 132;
        for (let i = 0; i < NODES; i++) {
          for (let j = i + 1; j < NODES; j++) {
            const dx = P.x[i] - P.x[j], dy = P.y[i] - P.y[j], d2 = dx * dx + dy * dy;
            if (d2 > reach * reach) continue;
            ctx.strokeStyle = `rgba(${RGB.accent},${((1 - Math.sqrt(d2) / reach) * 0.34 * loose * born).toFixed(3)})`;
            ctx.beginPath(); ctx.moveTo(P.x[i], P.y[i]); ctx.lineTo(P.x[j], P.y[j]); ctx.stroke();
          }
        }
      }

      // particles: one flat tone per pass (so nothing shimmers), a few glints on top
      let alpha = 0.72 * born, scale = 1, trim = 0;
      if (phase === 'assemble') { alpha = lerp(0.72, 0.94, clamp(t / (T.assemble * GATHER))); trim = clamp(t / (T.assemble * 0.5)); }
      else if (phase === 'hold') { alpha = 0.94; trim = 1; }
      else if (phase === 'travel') { alpha = lerp(0.94, 0.5, clamp(t / travelMs)); scale = layout[0].f / big[0].f; trim = 1; }
      else if (phase === 'release') { alpha = (aimed ? 0.5 : 0.94) * (1 - clamp(t / (T.release * 0.6))); scale = aimed ? hero[0].f / big[0].f : 1; trim = 1; }
      const still = phase === 'hold';                  // at rest: whole device pixels. In motion that would crawl.
      const px = 1 / dpr;

      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = `rgb(${pass ? RGB.accent : RGB.fg})`;
        ctx.globalAlpha = alpha;
        for (let i = 0; i < N; i++) {
          if (P.accent[i] !== pass) continue;
          const lead = i < NODES && loose > 0 ? 1 + loose * 0.9 : 1;
          let s = lerp(P.size[i], P.rim[i] ? Math.min(1, grain) : P.size[i] * grain, trim) * lead * Math.max(0.5, scale);
          const glint = i % 13 === 0;
          if (P.dust[i]) ctx.globalAlpha = alpha * 0.42;
          else if (glint) ctx.globalAlpha = alpha * (0.6 + 0.4 * Math.sin(now * 0.0035 + P.seed[i] * 50));
          if (still) { s = Math.max(px, snap(s)); ctx.fillRect(snap(P.x[i] - s / 2), snap(P.y[i] - s / 2), s, s); }
          else ctx.fillRect(P.x[i] - s / 2, P.y[i] - s / 2, s, s);
          if (P.dust[i] || glint) ctx.globalAlpha = alpha;
        }
      }
      ctx.globalAlpha = 1;
    }

    let last = performance.now();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const gap = now - last;
      const dt = Math.min(48, gap) / 16.67;            // for motion: capped, so a stall cannot fling anything
      last = now;
      advance();
      if (closed || !ctx || plain) return;
      step(now, dt);
      paint(now, Math.min(300, gap) / 16.67);
    }

    // ── leaving early ──
    function skip() {
      if (skipping || closed) return;
      skipping = true;
      if (handed) return;
      if (phase === 'drift' || plain) { handoff(); return; }      // nothing has formed yet: just lift
      travelMs = Math.min(T.travel, 520);
      handoff();
    }
    const skipBtn = el.querySelector('.loader__skip');
    if (skipBtn) on(skipBtn, 'click', skip);
    on(el, 'pointerdown', (e) => { if (e.target !== skipBtn) skip(); });
    on(window, 'keydown', (e) => {
      if (handed) return;
      if (e.key === 'Escape' || e.key === 'Enter') { skip(); return; }
      // tabbing past the skip button would put focus on a page that is still covered
      if (e.key === 'Tab' && (!skipBtn || document.activeElement === skipBtn)) { skip(); return; }
      // the page under the overlay must not scroll away from the headline the intro lands on
      if ([' ', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key) && e.target === document.body) e.preventDefault();
    });
    const hold = (e) => { if (!handed) e.preventDefault(); };
    on(el, 'wheel', hold, { passive: false });
    on(el, 'touchmove', hold, { passive: false });
    // Phones fire resize when the URL bar slides away, so a resize must never end the intro.
    // Keep the canvas in step; re-lay the name only if the width really changed.
    let lastW = W;
    on(window, 'resize', () => {
      size();
      if (W === lastW || handed) return;
      lastW = W;
      if (phase === 'drift') prep = 0;                 // laid out for the old width: build it again
      else if (named && (phase === 'assemble' || phase === 'hold')) { named = buildName(); if (!named) goPlain(); }
    });
    // a tab that is not being looked at should not come back to an animation mid-flight
    on(document, 'visibilitychange', () => { if (document.hidden) done(); });

    if (document.hidden) { done(); return; }
    if (plain) goPlain();
    watchdog = setTimeout(done, T.cap + 2600);          // frames can stop (background tab); timers still fire
    raf = requestAnimationFrame(frame);
  } catch (err) {
    // never leave the page covered; say why, so a broken intro is diagnosable
    console.warn('[intro] aborted:', err && err.message);
    done();
  }
})();
