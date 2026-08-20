/* Motion — master choreography.
   Owns: intro sequence, count-ups, per-case entrance, cursor labels,
         scroll-velocity response, section title mask reveals. */
// Suppress a specific benign GSAP ScrollTrigger refresh-cascade error that
// surfaces during initial layout on certain DOM configurations. All triggers
// still register and animate correctly — this only silences the console noise.
window.addEventListener('error', (e) => {
  const isGsapNoise =
    (e.message && e.message.includes("reading 'end'")) ||
    (e.filename && e.filename.includes('ScrollTrigger'));
  if (isGsapNoise) { e.preventDefault(); e.stopImmediatePropagation(); return true; }
}, true);
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message?.includes("reading 'end'")) e.preventDefault();
});
// Also wrap ScrollTrigger.refresh globally once it exists
(function guardRefresh() {
  if (!window.ScrollTrigger) return setTimeout(guardRefresh, 20);
  const orig = ScrollTrigger.refresh;
  ScrollTrigger.refresh = function(...a) { try { return orig.apply(this, a); } catch (e) { return null; } };
  const origUpdate = ScrollTrigger.update;
  ScrollTrigger.update = function(...a) { try { return origUpdate.apply(this, a); } catch (e) { return null; } };
})();

(() => {
  if (!window.gsap) return;
  try {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hoverable = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const seenIntro = sessionStorage.getItem('su_intro') === '1';
  const introScale = reduced ? 0 : (seenIntro ? 0.55 : 1);

  gsap.registerPlugin(ScrollTrigger);
  gsap.config({ nullTargetWarn: false });

  // Guard against a rare GSAP internal refresh cascade
  // (specific DOM configurations trigger "reading 'end' of undefined" inside ScrollTrigger).
  const _rawSTCreate = ScrollTrigger.create.bind(ScrollTrigger);
  function safeST(cfg) {
    // If the trigger is already at/above the start point when the page loads
    // (e.g. mid-page refresh), fire onEnter/onEnterBack immediately — ScrollTrigger's
    // own onEnter only fires when scrolling INTO the trigger, so elements already
    // past their start would otherwise stay in their initial hidden state.
    try {
      const trigEl = typeof cfg.trigger === 'string' ? document.querySelector(cfg.trigger) : cfg.trigger;
      if (trigEl && cfg.onEnter && (cfg.start === undefined || /^top\s+\d+%$/.test(cfg.start || 'top 100%'))) {
        const m = /^top\s+(\d+)%$/.exec(cfg.start || '');
        const threshold = m ? parseFloat(m[1]) / 100 : 1;
        const r = trigEl.getBoundingClientRect();
        if (r.top < window.innerHeight * threshold) {
          try { cfg.onEnter(); } catch (e) {}
          if (cfg.once) return null;
        }
      }
    } catch (e) {}
    try { return _rawSTCreate(cfg); } catch (e) { return null; }
  }
  function safeTL(cfg) { try { return gsap.timeline(cfg); } catch (e) { return gsap.timeline({}); /* fallback without ST */ } }

  // ──────────────────────────────────────────────
  //  0. Initial hidden states (before intro plays)
  // ──────────────────────────────────────────────
  gsap.set('.hero__eyebrow, .hero__body, .hero__cta, .hero__rail, .hero__scroll', {
    opacity: 0, y: 24,
  });
  gsap.set('.hero__line-inner', { yPercent: 118 });
  gsap.set('.hero__metrics', { opacity: 0 });
  gsap.set('.hero .metric', { opacity: 0, y: 18 });
  gsap.set('[data-reveal]', { opacity: 0, y: 24 });

  // Split section titles into word-mask spans (so we can reveal them line/word by line/word)
  document.querySelectorAll('.section__title, .case__title, .contact__title').forEach((el) => {
    const raw = el.innerHTML;
    // wrap child nodes so italics/spans survive
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = raw;
    const wrapWords = (node, out) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          const words = child.textContent.split(/(\s+)/);
          words.forEach((w) => {
            if (/^\s+$/.test(w)) { out.appendChild(document.createTextNode(w)); return; }
            if (!w) return;
            const outer = document.createElement('span'); outer.className = 'wmask';
            const inner = document.createElement('span'); inner.className = 'wtext';
            inner.textContent = w;
            outer.appendChild(inner);
            out.appendChild(outer);
          });
        } else if (child.nodeType === 1) {
          const clone = child.cloneNode(false);
          wrapWords(child, clone);
          out.appendChild(clone);
        }
      });
    };
    const rebuilt = document.createElement('span');
    wrapWords(tempDiv, rebuilt);
    el.innerHTML = rebuilt.innerHTML;
  });

  // Set title word initial states
  gsap.set('.section__title .wtext, .case__title .wtext, .contact__title .wtext', { yPercent: 118 });

  // ──────────────────────────────────────────────
  //  1. Number counter — technical, monospaced feel
  // ──────────────────────────────────────────────
  function countUp(el, opts = {}) {
    if (el.dataset.counted === '1') return;
    el.dataset.counted = '1';
    const target = parseFloat(el.dataset.count);
    if (Number.isNaN(target)) return;
    const isFloat = String(el.dataset.count).includes('.');
    const dur = opts.duration ?? (reduced ? 0.3 : 1.6);

    // Add a subtle blur while counting
    el.style.willChange = 'filter, transform';

    const state = { v: 0 };
    const tl = gsap.to(state, {
      v: target,
      duration: dur,
      ease: 'expo.out',
      onUpdate: () => {
        el.textContent = isFloat ? state.v.toFixed(2) : Math.floor(state.v).toString();
      },
      onComplete: () => {
        el.textContent = isFloat ? target.toFixed(2) : String(target);
        gsap.to(el, { filter: 'blur(0px)', duration: 0.2 });
        el.style.willChange = '';
      },
    });
    // Blur → sharp
    gsap.fromTo(el, { filter: 'blur(3px)' }, { filter: 'blur(0px)', duration: dur * 0.8, ease: 'expo.out' });
    return tl;
  }
  window.__countUp = countUp;

  // ──────────────────────────────────────────────
  //  Hero metric loader bars
  // ──────────────────────────────────────────────
  let heroVizPlayed = false;
  function fireMetricLoaders(instant = false) {
    document.querySelectorAll('.hero .metric[data-loader]').forEach((el, i) => {
      const pct = parseFloat(el.dataset.loader) || 0;
      el.style.setProperty('--loader-pct', pct + '%');
      const trigger = () => el.classList.add('is-loaded');
      if (instant) trigger();
      else gsap.delayedCall(0.15 + i * 0.11, trigger);
    });
    // Ring / sparkline / podium viz
    if (heroVizPlayed) return;
    heroVizPlayed = true;
    const D = instant ? 0 : 1;

    const ring = document.querySelector('.metric__ring-fill[data-ring]');
    if (ring) {
      const pct = parseFloat(ring.dataset.ring) || 0;
      const target = Math.max(0, 100 - pct);
      if (instant) ring.style.strokeDashoffset = String(target);
      else gsap.fromTo(ring, { attr: { 'stroke-dashoffset': 100 } },
                             { attr: { 'stroke-dashoffset': target }, duration: 1.6 * D, ease: 'expo.out' });
    }

    const spark = document.querySelector('.metric__spark');
    if (spark) {
      const line = spark.querySelector('.metric__spark-line');
      const area = spark.querySelector('.metric__spark-area');
      const dot  = spark.querySelector('.metric__spark-dot');
      const W = 96, H = 40, N = 14;
      const seed = (i) => Math.sin(i * 12.9898) * 43758.5453 % 1;
      const pts = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const trend = 1 - Math.pow(1 - t, 2);
        const noise = (Math.abs(seed(i + 3)) - 0.5) * 0.14;
        const yNorm = Math.max(0.05, Math.min(0.95, 1 - (trend + noise)));
        pts.push([t * W, yNorm * H]);
      }
      const linePts = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      const areaPts = `0,${H} ${linePts} ${W},${H}`;
      const lastX = pts[pts.length - 1][0];
      const lastY = pts[pts.length - 1][1];
      line.setAttribute('points', linePts);
      area.setAttribute('points', areaPts);
      if (instant) {
        dot.setAttribute('cx', lastX); dot.setAttribute('cy', lastY);
      } else {
        gsap.fromTo([line, area], { clipPath: 'inset(0 100% 0 0)' },
          { clipPath: 'inset(0 0% 0 0)', duration: 1.4 * D, ease: 'expo.out' });
        gsap.fromTo(dot, { attr: { cx: 0, cy: H }, opacity: 0 },
          { attr: { cx: lastX, cy: lastY }, opacity: 1, duration: 1.4 * D, ease: 'expo.out' });
      }
    }

    const bars = document.querySelectorAll('.metric__podium-bar');
    if (bars.length === 3) {
      const heights = { '--3': 14, '--2': 26, '--1': 20 };
      bars.forEach((b) => {
        const cls = [...b.classList].find(c => c.startsWith('metric__podium-bar--'));
        const key = '--' + (cls?.split('--')[1] || '1');
        const h = heights[key] || 12;
        const y = 40 - h;
        if (instant) { b.setAttribute('height', h); b.setAttribute('y', y); }
        else gsap.fromTo(b, { attr: { height: 0, y: 40 } },
                             { attr: { height: h, y }, duration: 0.9 * D, ease: 'back.out(1.4)',
                               delay: (key === '--3' ? 0 : key === '--1' ? 0.08 : 0.18) });
      });
    }
  }
  window.__fireMetricLoaders = fireMetricLoaders;

  // ──────────────────────────────────────────────
  //  2. Intro master timeline
  // ──────────────────────────────────────────────
  function runIntro() {
    const S = introScale; // 0 = reduced motion / already seen full intro
    const canvas = window.__heroCanvas;

    // If reduced motion, just show everything instantly
    if (S === 0 && reduced) {
      gsap.set('.hero__eyebrow, .hero__body, .hero__cta, .hero__rail, .hero__metrics, .hero__scroll', { opacity: 1, y: 0 });
      gsap.set('.hero__line-inner', { yPercent: 0 });
      gsap.set('.hero .metric', { opacity: 1, y: 0 });
      gsap.set('.section__title .wtext, .case__title .wtext, .contact__title .wtext', { yPercent: 0 });
      canvas?.revealInstant?.();
      document.querySelectorAll('.hero .metric__num[data-count]').forEach((el) => {
        const target = parseFloat(el.dataset.count);
        if (!Number.isNaN(target)) el.textContent = String(el.dataset.count).includes('.') ? target.toFixed(2) : String(target);
      });
      fireMetricLoaders(true);
      sessionStorage.setItem('su_intro', '1');
      return;
    }

    // Base durations, scaled for return visits
    const d = (v) => Math.max(0.15, v * (S > 0 ? S : 0.4));

    // 1. Boot the canvas
    if (canvas?.boot) canvas.boot(1600 * (S > 0 ? S : 0.5));

    const tl = gsap.timeline({
      defaults: { ease: 'expo.out' },
      onComplete: () => sessionStorage.setItem('su_intro', '1'),
    });

    tl.to('.hero__eyebrow', { opacity: 1, y: 0, duration: d(0.7) }, d(0.15))
      .to('.hero__line-inner', { yPercent: 0, duration: d(1.1), stagger: d(0.12) }, d(0.55))
      .to('.hero__body', { opacity: 1, y: 0, duration: d(0.85) }, d(1.35))
      .to('.hero__cta', { opacity: 1, y: 0, duration: d(0.8) }, d(1.55))
      .to('.hero__rail', { opacity: 1, y: 0, duration: d(0.8) }, d(1.7))
      .set('.hero__metrics', { opacity: 1 }, d(1.85))
      .to('.hero .metric', {
        opacity: 1, y: 0, duration: d(0.7), stagger: d(0.09),
        onStart: () => {
          document.querySelectorAll('.hero .metric__num[data-count]').forEach((el, i) => {
            gsap.delayedCall(i * d(0.12), () => countUp(el, { duration: d(1.4) }));
          });
          fireMetricLoaders();
        },
      }, d(1.85))
      .to('.hero__scroll', { opacity: 1, y: 0, duration: d(0.6) }, d(2.15));
  }

  // ──────────────────────────────────────────────
  //  3. Section title mask reveal + head fade
  // ──────────────────────────────────────────────
  document.querySelectorAll('.section__head').forEach((head) => { try {
    const kicker = head.querySelector('.section__kicker');
    const index = head.querySelector('.section__index');
    const words = head.querySelectorAll('.section__title .wtext');

    const play = () => {
      gsap.to([index, kicker].filter(Boolean), { opacity: 1, y: 0, duration: 0.7, stagger: 0.06, ease: 'expo.out' });
      if (words.length) gsap.to(words, { yPercent: 0, duration: 1.05, stagger: 0.05, ease: 'expo.out', delay: 0.15 });
    };
    const r = head.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.80) { play(); return; }
    safeST({ trigger: head, start: 'top 80%', once: true, onEnter: play });
  } catch (e) {} });

  // ──────────────────────────────────────────────
  //  4. Manifesto reveal
  // ──────────────────────────────────────────────
  gsap.set('.manifesto__text', { opacity: 0, y: 20 });
  gsap.set('.manifesto__ledger li', { opacity: 0, y: 12 });
  const manifestoEl = document.querySelector('.manifesto');
  if (manifestoEl) {
    let played = false;
    const play = () => {
      if (played) return; played = true;
      gsap.to('.manifesto__text', { opacity: 1, y: 0, duration: 1.0, ease: 'expo.out' });
      gsap.to('.manifesto__ledger li', { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out', stagger: 0.08, delay: 0.3 });
      document.querySelectorAll('.manifesto__ledger li span').forEach((el, i) => {
        const raw = el.textContent.trim();
        const val = parseInt(raw, 10);
        if (!isNaN(val)) {
          el.dataset.count = String(val);
          gsap.delayedCall(0.4 + i * 0.1, () => {
            const pad = raw.length;
            const state = { v: 0 };
            gsap.to(state, {
              v: val, duration: 1.0, ease: 'expo.out',
              onUpdate: () => { el.textContent = String(Math.floor(state.v)).padStart(pad, '0'); },
              onComplete: () => { el.textContent = String(val).padStart(pad, '0'); },
            });
          });
        }
      });
    };
    const r = manifestoEl.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.85) {
      play();
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { io.disconnect(); play(); } });
      }, { threshold: 0.15, rootMargin: '0px 0px -20% 0px' });
      io.observe(manifestoEl);
    }
  }

  // ──────────────────────────────────────────────
  //  5. Per-case entrance choreography
  // ──────────────────────────────────────────────
  document.querySelectorAll('.case').forEach((c) => { try {
    const tag = c.querySelector('.case__tag');
    const title = c.querySelector('.case__title');
    const words = c.querySelectorAll('.case__title .wtext');
    const sub = c.querySelector('.case__sub');
    const badges = c.querySelectorAll('.case__badges .badge');
    const stage = c.querySelector('.case__stage');

    // set stage inner children hidden individually so we can stagger
    const stageBits = stage ? stage.children : [];
    gsap.set(stage, { opacity: 0, y: 30 });
    gsap.set([tag, sub].filter(Boolean), { opacity: 0, y: 20 });
    gsap.set(badges, { opacity: 0, y: 10 });

    // Build the timeline paused so case-specific extensions below can chain onto it.
    // Play it when the case enters view (or immediately if already above viewport on refresh).
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } });
    tl.to(tag, { opacity: 1, y: 0, duration: 0.6 }, 0)
      .to(words, { yPercent: 0, duration: 1.05, stagger: 0.05 }, 0.1)
      .to(sub, { opacity: 1, y: 0, duration: 0.8 }, 0.35)
      .to(badges, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08 }, 0.5)
      .to(stage, { opacity: 1, y: 0, duration: 0.9 }, 0.6);
    const play = () => tl.play();
    const r = c.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.72) { play(); }
    else safeST({ trigger: c, start: 'top 72%', once: true, onEnter: play });

    // case-specific micro-choreography
    if (c.classList.contains('case--agent')) {
      const nodes = c.querySelectorAll('.flow__node');
      const edges = c.querySelectorAll('.flow__edge');
      gsap.set([...nodes, ...edges], { opacity: 0, y: 12 });
      tl.to(nodes, { opacity: 1, y: 0, duration: 0.55, stagger: 0.12, ease: 'expo.out' }, 0.9)
        .to(edges, { opacity: 1, y: 0, duration: 0.4, stagger: 0.12, ease: 'expo.out' }, 1.0);
    }
    if (c.classList.contains('case--sociovia')) {
      const lines = c.querySelectorAll('.terminal__body');
      const cards = c.querySelectorAll('.soc-card');
      gsap.set(cards, { opacity: 0, y: 20 });
      tl.to(cards, { opacity: 1, y: 0, duration: 0.6, stagger: 0.09, ease: 'expo.out' }, 1.0);
    }
    if (c.classList.contains('case--graphgst')) {
      const blocks = c.querySelectorAll('.narrative__block');
      gsap.set(blocks, { opacity: 0, y: 16 });
      tl.to(blocks, { opacity: 1, y: 0, duration: 0.55, stagger: 0.1, ease: 'expo.out' }, 1.0);
    }
    if (c.classList.contains('case--java')) {
      const blocks = c.querySelectorAll('.narrative__block');
      gsap.set(blocks, { opacity: 0, y: 16 });
      tl.to(blocks, { opacity: 1, y: 0, duration: 0.55, stagger: 0.1, ease: 'expo.out' }, 1.0);
    }
    if (c.classList.contains('case--hook')) {
      const blocks = c.querySelectorAll('.narrative__block');
      const flowNodes = c.querySelectorAll('.hook-flow__node');
      const flowArrows = c.querySelectorAll('.hook-flow__arrow');
      gsap.set(blocks, { opacity: 0, y: 16 });
      gsap.set([...flowNodes, ...flowArrows], { opacity: 0, y: 8 });
      tl.to(blocks, { opacity: 1, y: 0, duration: 0.55, stagger: 0.1, ease: 'expo.out' }, 1.0)
        .to(flowNodes, { opacity: 1, y: 0, duration: 0.5, stagger: 0.15, ease: 'expo.out' }, 1.4)
        .to(flowArrows, { opacity: 1, y: 0, duration: 0.4, stagger: 0.15, ease: 'expo.out' }, 1.55);
    }
    if (c.classList.contains('case--pixel')) {
      const blocks = c.querySelectorAll('.narrative__block');
      const grid = c.querySelectorAll('.pixel-viz__cell');
      gsap.set(blocks, { opacity: 0, y: 16 });
      tl.to(blocks, { opacity: 1, y: 0, duration: 0.55, stagger: 0.1, ease: 'expo.out' }, 1.0);
      if (grid.length) {
        gsap.set(grid, { opacity: 0, scale: 0.8 });
        tl.to(grid, { opacity: 1, scale: 1, duration: 0.5, stagger: 0.012, ease: 'expo.out' }, 1.1);
      }
    }
  } catch (e) { console.warn('case ST failed', c?.dataset?.case, e.message); } });

  // ──────────────────────────────────────────────
  //  6. Contact title reveal
  // ──────────────────────────────────────────────
  const contactWords = document.querySelectorAll('.contact__title .wtext');
  if (contactWords.length) {
    safeST({
      trigger: '.contact', start: 'top 75%', once: true,
      onEnter: () => gsap.to(contactWords, { yPercent: 0, duration: 1.1, stagger: 0.06, ease: 'expo.out' }),
    });
  }

  // Contact rows + mail
  gsap.set('.contact__eyebrow, .mail, .contact__row', { opacity: 0, y: 16 });
  safeST({
    trigger: '.contact', start: 'top 70%', once: true,
    onEnter: () => {
      gsap.to('.contact__eyebrow', { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' });
      gsap.to('.mail', { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', delay: 0.25 });
      gsap.to('.contact__row', { opacity: 1, y: 0, duration: 0.6, stagger: 0.07, ease: 'expo.out', delay: 0.4 });
    },
  });

  // ──────────────────────────────────────────────
  //  7. Stack, timeline, journey, DSA
  // ──────────────────────────────────────────────
  gsap.set('.stack__group', { opacity: 0, y: 18 });
  safeST({
    trigger: '.stack__grid', start: 'top 80%', once: true,
    onEnter: () => gsap.to('.stack__group', { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out', stagger: 0.06 }),
  });

  gsap.set('.tl__item', { opacity: 0, y: 26 });
  safeST({
    trigger: '.tl', start: 'top 80%', once: true,
    onEnter: () => gsap.to('.tl__item', { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.12 }),
  });

  gsap.set('.journey__card', { opacity: 0, y: 20 });
  safeST({
    trigger: '.journey__grid', start: 'top 80%', once: true,
    onEnter: () => gsap.to('.journey__card', { opacity: 1, y: 0, duration: 0.75, ease: 'expo.out', stagger: 0.1 }),
  });

  // DSA — coordinated: number, viz, bars
  gsap.set('.dsa__lead, .dsa__viz, .dsa__topics li', { opacity: 0, y: 20 });
  safeST({
    trigger: '.dsa', start: 'top 75%', once: true,
    onEnter: () => {
      gsap.to('.dsa__lead', { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' });
      gsap.to('.dsa__viz',  { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', delay: 0.2 });
      gsap.to('.dsa__topics li', { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out', stagger: 0.07, delay: 0.35 });
      const big = document.querySelector('.dsa__big');
      if (big) {
        // intermediate technical count-up: 0 → jitter → 600
        big.style.filter = 'blur(4px)';
        const state = { v: 0 };
        gsap.to(state, {
          v: 600, duration: 1.8, ease: 'expo.out',
          onUpdate: () => { big.textContent = Math.floor(state.v); },
          onComplete: () => { big.textContent = '600'; gsap.to(big, { filter: 'blur(0px)', duration: 0.3 }); },
        });
      }
      // bars fill from 0
      document.querySelectorAll('.dsa__topics .bar').forEach((el, i) => {
        const target = getComputedStyle(el).getPropertyValue('--w') || '80%';
        el.style.setProperty('--w', '0%');
        gsap.delayedCall(0.4 + i * 0.08, () => {
          const obj = { v: 0 };
          const tgt = parseFloat(target);
          gsap.to(obj, {
            v: tgt, duration: 1.1, ease: 'expo.out',
            onUpdate: () => el.style.setProperty('--w', obj.v.toFixed(1) + '%'),
          });
        });
      });
    },
  });

  // ──────────────────────────────────────────────
  //  8. Generic data-reveal fallback
  // ──────────────────────────────────────────────
  document.querySelectorAll('[data-reveal]').forEach((el) => {
    if (el.closest('.hero')) return; // hero handled by intro
    const reveal = () => gsap.to(el, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' });
    // If element is already at or above the viewport on refresh, reveal immediately —
    // ScrollTrigger `onEnter` only fires when scrolling INTO the trigger, so anything
    // already past its start point on load would otherwise stay hidden.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.88) { reveal(); return; }
    safeST({
      trigger: el, start: 'top 88%', once: true,
      onEnter: reveal,
    });
  });

  // ──────────────────────────────────────────────
  //  9. Hero parallax on scroll (subtle)
  // ──────────────────────────────────────────────
  if (!reduced) {
    gsap.to('#hero-canvas', {
      yPercent: 15, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
    });
    gsap.to('.hero__inner', {
      yPercent: -8, opacity: 0.4, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
    });
  }

  // ──────────────────────────────────────────────
  //  10. Scroll velocity → subtle response on section indices/rails
  // ──────────────────────────────────────────────
  if (!reduced && window.__lenis) {
    let currentSkew = 0, targetSkew = 0;
    const els = document.querySelectorAll('.section__index, .hero__rail, .terminal__title');
    window.__lenis.on('scroll', ({ velocity }) => {
      // clamp velocity → tiny translate on decorative mono elements
      targetSkew = Math.max(-8, Math.min(8, velocity * 0.4));
    });
    gsap.ticker.add(() => {
      currentSkew += (targetSkew - currentSkew) * 0.12;
      targetSkew *= 0.92; // decay so it settles after scroll stops
      els.forEach((el) => { el.style.transform = `translateY(${currentSkew}px)`; });
    });
  }

  // ──────────────────────────────────────────────
  //  11. Custom cursor — tracking + label variants
  // ──────────────────────────────────────────────
  if (hoverable) {
    const cursor = document.querySelector('.cursor');
    const dot   = cursor?.querySelector('.cursor__dot');
    const ring  = cursor?.querySelector('.cursor__ring');
    if (cursor && dot && ring) {
      const label = document.createElement('div');
      label.className = 'cursor__label';
      cursor.appendChild(label);

      let mx = -100, my = -100, rx = -100, ry = -100;
      window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
      function loop() {
        rx += (mx - rx) * 0.18;
        ry += (my - ry) * 0.18;
        dot.style.left   = mx + 'px'; dot.style.top   = my + 'px';
        ring.style.left  = rx + 'px'; ring.style.top  = ry + 'px';
        label.style.left = rx + 'px'; label.style.top = ry + 'px';
        requestAnimationFrame(loop);
      }
      loop();

      const cursorLabels = {
        explore: 'explore',
        external: '↗',
        mail: 'write',
      };
      const hoverSelector = 'a, button, .magnetic, .flow__node, .soc-card, .journey__card, .metric, .stack__list li, .tech, .social';

      // Event delegation so attributes set post-init still work
      document.addEventListener('mouseover', (e) => {
        const withLabel = e.target.closest('[data-cursor]');
        if (withLabel) {
          const kind = withLabel.getAttribute('data-cursor');
          const text = cursorLabels[kind];
          if (text) { label.textContent = text; cursor.classList.add('is-label'); }
        }
        const withHover = e.target.closest(hoverSelector);
        if (withHover) cursor.classList.add('is-hover');
      });
      document.addEventListener('mouseout', (e) => {
        const withLabel = e.target.closest('[data-cursor]');
        if (withLabel) cursor.classList.remove('is-label');
        const withHover = e.target.closest(hoverSelector);
        if (withHover) cursor.classList.remove('is-hover');
      });
    } else if (cursor) {
      cursor.style.display = 'none';
    }
  } else {
    document.querySelector('.cursor').style.display = 'none';
  }

  // ──────────────────────────────────────────────
  //  Tech tile — pointer-following gradient (cursor-tracking aura)
  // ──────────────────────────────────────────────
  document.querySelectorAll('.tech').forEach((el) => {
    if (!el.querySelector('.tech__shine')) {
      const shine = document.createElement('span');
      shine.className = 'tech__shine';
      shine.setAttribute('aria-hidden', 'true');
      el.prepend(shine);
    }
  });
  if (!reduced && hoverable) {
    document.querySelectorAll('.tech').forEach((el) => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;
        el.style.setProperty('--px', x + '%');
        el.style.setProperty('--py', y + '%');
      });
    });
  }

  // ──────────────────────────────────────────────
  //  Tech → project linking
  //  Hovering a .tech with data-project="graph,agent" highlights those cases.
  // ──────────────────────────────────────────────
  const cases = new Map();
  document.querySelectorAll('.case[data-case], .mini-case[data-case]').forEach((c) => {
    cases.set(c.dataset.case, c);
  });
  document.querySelectorAll('.tech').forEach((tech) => {
    const targets = (tech.dataset.project || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!targets.length) return;
    const linked = targets.map(k => cases.get(k)).filter(Boolean);
    const activate = () => linked.forEach(c => c.classList.add('is-linked'));
    const deactivate = () => linked.forEach(c => c.classList.remove('is-linked'));
    tech.addEventListener('mouseenter', activate);
    tech.addEventListener('mouseleave', deactivate);
    tech.addEventListener('focus', activate);
    tech.addEventListener('blur', deactivate);
    tech.addEventListener('touchstart', () => {
      activate();
      setTimeout(deactivate, 1600);
    }, { passive: true });
  });

  // Cursor label variant for tech tiles + socials
  document.querySelectorAll('.tech').forEach(el => el.setAttribute('data-cursor', 'explore'));
  document.querySelectorAll('.social').forEach(el => {
    if (!el.hasAttribute('data-cursor')) el.setAttribute('data-cursor', 'external');
  });

  // ──────────────────────────────────────────────
  //  X. Theme toggle
  // ──────────────────────────────────────────────
  const root = document.documentElement;
  function currentTheme() { return root.getAttribute('data-theme') || 'dark'; }
  function applyTheme(theme, animate = true) {
    if (animate) {
      root.classList.add('is-theme-shifting');
      setTimeout(() => root.classList.remove('is-theme-shifting'), 500);
    }
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    localStorage.setItem('su_theme', theme);
    // notify visualizations
    window.__heroCanvas?.updateTheme?.();
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }
  // read persisted preference (no animation on initial apply)
  const saved = localStorage.getItem('su_theme');
  if (saved === 'light' || saved === 'dark') applyTheme(saved, false);

  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
  });

  // keyboard: ⌘/Ctrl + K toggles theme
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    }
  });

  // ──────────────────────────────────────────────
  //  12. Run intro on first paint
  //  Kinetic Grid canvas handles its own boot phase inline in hero-canvas.js
  // ──────────────────────────────────────────────
  const kick = () => {
    try { runIntro(); } catch (e) { console.warn('runIntro failed:', e.message); }
    setTimeout(() => { try { ScrollTrigger.refresh(); } catch (e) {} }, 100);
  };
  if (document.readyState === 'complete') kick();
  else window.addEventListener('load', kick, { once: true });
  } catch (err) {
    console.warn('motion.js setup error (non-fatal):', err.message);
  }
})();
