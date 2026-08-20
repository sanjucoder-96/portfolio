/* Constellation system — reusable, spring-relaxed, cluster-seeded.
   ─────────────────────────────────────────────────────────────────
   Each `[data-constellation="<preset>"]` becomes an interactive
   knowledge-network canvas whose stars are arranged as multiple
   distinct constellation FORMATIONS (not uniform noise), drift very
   slowly at rest, and respond with responsive spring physics when
   the pointer enters. When the pointer leaves, each star's home
   position pulls it back — clusters visibly expand back to shape.

   Physics per star per frame:
     drift(home)  = original_home + slow sinusoidal wander
     toHome       = (drift(home) - pos) * springK
     cursor       = normalized (pos - cursor) * strength   (repel, if near)
     v           += toHome + cursor
     v           *= damping
     pos         += v

   Deterministic Mulberry32 PRNG seed → same formations every reload.
   Global mousemove routes pointer to exactly one active constellation.
   IntersectionObserver pauses each canvas when off-screen. */

(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  // Palette — read from CSS vars, refresh on theme change
  const palette = {
    edge: '180,200,195', active: '124,217,192', warm: '229,178,93',
    fg: '242,241,234', isLight: false,
  };
  function readTheme() {
    const s = getComputedStyle(document.documentElement);
    palette.edge   = (s.getPropertyValue('--canvas-edge') || '180,200,195').trim();
    palette.active = (s.getPropertyValue('--rgb-graph')   || '124,217,192').trim();
    palette.warm   = (s.getPropertyValue('--rgb-warm')    || '229,178,93').trim();
    palette.fg     = (s.getPropertyValue('--rgb-fg')      || '242,241,234').trim();
    palette.isLight = document.documentElement.getAttribute('data-theme') === 'light';
  }
  readTheme();
  window.addEventListener('themechange', readTheme);

  // Deterministic Mulberry32 PRNG
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Per-preset tuning ──────────────────────────
  const PRESETS = {
    hero: {
      clusterAreaPx: 95000,   // fewer, more breathable clusters
      clusterStars: [4, 7],   // [min, max] stars per cluster
      clusterRadius: [75, 125],
      seed: 20260820,
      linkDist: 118,
      cursorRadius: 200,
      cursorForce: 7.5,
      springK: 0.010,
      damping: 0.86,
      accentPct: 0.16,
      lineAlpha: 0.22,
      baseOpacityMin: 0.42,
      baseOpacityRange: 0.55,
      driftAmp: [3, 10],
      driftFreq: [0.00015, 0.0004],
      twinkleSpeed: [0.003, 0.007],
      canvasOpacity: null,
      comets: true,
    },
    stack: {
      clusterAreaPx: 140000,  clusterStars: [3, 6],   clusterRadius: [65, 110],
      seed: 20260821,
      linkDist: 108, cursorRadius: 155, cursorForce: 5.2,
      springK: 0.012, damping: 0.87,
      accentPct: 0.09, lineAlpha: 0.14,
      baseOpacityMin: 0.36, baseOpacityRange: 0.5,
      driftAmp: [2, 7], driftFreq: [0.0002, 0.0005],
      twinkleSpeed: [0.0025, 0.006],
      canvasOpacity: 0.6, comets: false,
    },
    dsa: {
      clusterAreaPx: 125000,  clusterStars: [3, 6],   clusterRadius: [65, 115],
      seed: 20260822,
      linkDist: 110, cursorRadius: 160, cursorForce: 5.4,
      springK: 0.011, damping: 0.86,
      accentPct: 0.11, lineAlpha: 0.16,
      baseOpacityMin: 0.38, baseOpacityRange: 0.52,
      driftAmp: [2, 8], driftFreq: [0.0002, 0.00045],
      twinkleSpeed: [0.0025, 0.006],
      canvasOpacity: 0.62, comets: false,
    },
    contact: {
      clusterAreaPx: 165000,  clusterStars: [3, 5],   clusterRadius: [55, 100],
      seed: 20260823,
      linkDist: 100, cursorRadius: 145, cursorForce: 4.5,
      springK: 0.013, damping: 0.87,
      accentPct: 0.09, lineAlpha: 0.12,
      baseOpacityMin: 0.34, baseOpacityRange: 0.48,
      driftAmp: [2, 6], driftFreq: [0.00025, 0.00055],
      twinkleSpeed: [0.0025, 0.005],
      canvasOpacity: 0.5, comets: false,
    },
  };

  // ── Constellation instance ─────────────────────
  class Constellation {
    constructor(canvas, presetName) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.p = PRESETS[presetName] || PRESETS.hero;
      this.presetName = presetName;
      this.stars = [];
      this.comets = [];
      this.mx = -9999; this.my = -9999; this.active = false;
      this.revealed = 0;
      this.revealAlpha = 0;
      this.bootStart = 0;
      this.bootDur = 0;
      this.visible = true;
      this.lastCometAt = 0;

      if (this.p.canvasOpacity !== null) canvas.style.opacity = this.p.canvasOpacity;

      this.resize = this.resize.bind(this);
      this.tick = this.tick.bind(this);
      window.addEventListener('resize', () => { this.resize(); this.scatter(); });

      this.resize();
      this.scatter();

      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { this.visible = e.isIntersecting; });
      }, { threshold: 0.02 });
      io.observe(canvas);

      requestAnimationFrame(this.tick);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.W = Math.max(1, rect.width);
      this.H = Math.max(1, rect.height);
      this.canvas.width  = this.W * DPR;
      this.canvas.height = this.H * DPR;
      this.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    scatter() {
      const P = this.p;
      const rng = mulberry32(P.seed);
      const rand = (a, b) => a + (b - a) * rng();

      this.stars.length = 0;

      // Cluster centers scattered as blue-noise-ish points (grid + jitter)
      const area = this.W * this.H;
      const K = Math.max(3, Math.min(48, Math.floor(area / P.clusterAreaPx)));

      // Grid of cells, one cluster jittered inside each
      const aspect = this.W / this.H;
      const cols = Math.max(2, Math.round(Math.sqrt(K * aspect)));
      const rows = Math.max(2, Math.ceil(K / cols));
      const cellW = this.W / cols;
      const cellH = this.H / rows;

      let clusterIdx = 0;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (clusterIdx >= K) break;
          clusterIdx++;
          const centerX = (cx + 0.15 + rng() * 0.7) * cellW;
          const centerY = (cy + 0.15 + rng() * 0.7) * cellH;
          const count = Math.floor(rand(P.clusterStars[0], P.clusterStars[1] + 1));
          const rMax  = rand(P.clusterRadius[0], P.clusterRadius[1]);

          for (let i = 0; i < count; i++) {
            const angle = rng() * Math.PI * 2;
            // slight bias toward center (r^0.7) for organic clumping
            const r = Math.pow(rng(), 0.7) * rMax;
            const homeX = centerX + Math.cos(angle) * r;
            const homeY = centerY + Math.sin(angle) * r;
            if (homeX < 8 || homeX > this.W - 8 || homeY < 8 || homeY > this.H - 8) continue;

            const mag = rng();
            const size = mag < P.accentPct       ? (1.8 + rng() * 1.3)
                       : mag < P.accentPct + 0.3 ? (1.1 + rng() * 0.6)
                                                 : (0.55 + rng() * 0.4);
            this.stars.push({
              anchorX: homeX,
              anchorY: homeY,
              x: homeX,
              y: homeY,
              vx: 0, vy: 0,
              r: size,
              base: P.baseOpacityMin + mag * P.baseOpacityRange,
              twinkle: rng() * Math.PI * 2,
              twinkleSpeed: rand(P.twinkleSpeed[0], P.twinkleSpeed[1]),
              driftAmpX: rand(P.driftAmp[0], P.driftAmp[1]),
              driftAmpY: rand(P.driftAmp[0], P.driftAmp[1]),
              driftFreqX: rand(P.driftFreq[0], P.driftFreq[1]),
              driftFreqY: rand(P.driftFreq[0], P.driftFreq[1]),
              driftPhaseX: rng() * Math.PI * 2,
              driftPhaseY: rng() * Math.PI * 2,
              accent: mag < P.accentPct,
              birth: rng(),
            });
          }
        }
      }
      this.stars.sort((a, b) => a.birth - b.birth);
      this.N = this.stars.length;

      // Non-hero presets reveal instantly; hero waits for boot()
      if (this.presetName !== 'hero' && this.bootDur === 0) {
        this.revealed = this.N;
        this.revealAlpha = 1;
      }
    }

    setPointer(localX, localY, isInside) {
      if (isInside) { this.mx = localX; this.my = localY; this.active = true; }
      else { this.active = false; }
    }

    launchComet() {
      const angle = Math.random() * 0.35 + Math.PI * 0.05;
      const speed = 4.5 + Math.random() * 2;
      this.comets.push({
        x: -30, y: Math.random() * this.H * 0.55,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, trail: [], born: performance.now(),
        tone: Math.random() < 0.35 ? 'warm' : 'active',
      });
    }

    tick(now) {
      requestAnimationFrame(this.tick);
      if (!this.visible) return;

      if (this.bootDur > 0) {
        const p = Math.min(1, (now - this.bootStart) / this.bootDur);
        const eased = 1 - Math.pow(1 - p, 3);
        this.revealed = Math.floor(eased * this.N);
        this.revealAlpha = eased;
        if (p >= 1) this.bootDur = 0;
      }

      if (this.p.comets && !reduced && this.presetName === 'hero'
          && now - this.lastCometAt > 9500 + Math.random() * 6000) {
        this.launchComet();
        this.lastCometAt = now;
      }

      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.W, this.H);

      // Physics with sinusoidal drifting home
      const { springK, damping, cursorRadius, cursorForce } = this.p;
      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];
        // slow ambient drift of the "home" target
        const targetX = s.anchorX + Math.sin(now * s.driftFreqX + s.driftPhaseX) * s.driftAmpX;
        const targetY = s.anchorY + Math.sin(now * s.driftFreqY + s.driftPhaseY) * s.driftAmpY;

        let fx = (targetX - s.x) * springK;
        let fy = (targetY - s.y) * springK;

        if (this.active && i < this.revealed) {
          const dx = s.x - this.mx;
          const dy = s.y - this.my;
          const d2 = dx * dx + dy * dy;
          const r2 = cursorRadius * cursorRadius;
          if (d2 < r2 && d2 > 1) {
            const d = Math.sqrt(d2);
            const t = 1 - d / cursorRadius;
            const strength = t * t * cursorForce;
            fx += (dx / d) * strength;
            fy += (dy / d) * strength;
          }
        }

        s.vx = (s.vx + fx) * damping;
        s.vy = (s.vy + fy) * damping;
        s.x += s.vx;
        s.y += s.vy;
        s.twinkle += s.twinkleSpeed;
      }

      // Edges — drawn from live positions (stretch/relax automatically)
      const lineBoost = palette.isLight ? 1.55 : 1;
      const linkDist2 = this.p.linkDist * this.p.linkDist;
      for (let i = 0; i < this.revealed; i++) {
        const a = this.stars[i];
        for (let j = i + 1; j < this.revealed; j++) {
          const b = this.stars[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDist2) {
            const d = Math.sqrt(d2);
            const t = 1 - d / this.p.linkDist;
            const alpha = t * this.p.lineAlpha * this.revealAlpha * lineBoost;
            ctx.strokeStyle = `rgba(${palette.edge},${alpha.toFixed(3)})`;
            ctx.lineWidth = 0.65;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Cursor-linked highlight edges
      if (this.active && this.revealed > 0) {
        for (let i = 0; i < this.revealed; i++) {
          const s = this.stars[i];
          const dx = this.mx - s.x, dy = this.my - s.y;
          const d = Math.hypot(dx, dy);
          if (d < this.p.cursorRadius) {
            const t = 1 - d / this.p.cursorRadius;
            const alpha = t * t * 0.55;
            ctx.strokeStyle = `rgba(${palette.active},${alpha.toFixed(3)})`;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(this.mx, this.my); ctx.lineTo(s.x, s.y);
            ctx.stroke();
          }
        }
      }

      // Stars
      for (let i = 0; i < this.revealed; i++) {
        const s = this.stars[i];
        const nodeAge = this.bootDur > 0
          ? Math.min(1, ((now - this.bootStart) / this.bootDur) * this.N - i) * 1.6
          : 1;
        const nodeAlpha = Math.max(0, Math.min(1, nodeAge));
        const twk = 0.75 + Math.abs(Math.sin(s.twinkle)) * 0.35;

        let boost = 0;
        if (this.active) {
          const dx = this.mx - s.x, dy = this.my - s.y;
          const d = Math.hypot(dx, dy);
          if (d < this.p.cursorRadius) boost = (1 - d / this.p.cursorRadius) * 0.9;
        }

        const rgb = (s.accent || boost > 0.4) ? palette.active : palette.edge;
        const alpha = Math.min(1, s.base * twk * nodeAlpha + boost * 0.5);
        const radius = s.r * (1 + boost * 0.7);

        if (s.accent || boost > 0.3) {
          const glowR = radius * (3 + boost * 3);
          const g = ctx.createRadialGradient(s.x, s.y, radius * 0.4, s.x, s.y, glowR);
          g.addColorStop(0, `rgba(${palette.active},${(alpha * 0.4).toFixed(3)})`);
          g.addColorStop(1, `rgba(${palette.active},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.fill();

        if (s.accent && (s.r > 1.7 || boost > 0.5)) {
          const spike = radius * 4 * (0.6 + Math.sin(s.twinkle * 0.7) * 0.4);
          ctx.strokeStyle = `rgba(${palette.active},${(alpha * 0.35).toFixed(3)})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(s.x - spike, s.y); ctx.lineTo(s.x + spike, s.y);
          ctx.moveTo(s.x, s.y - spike); ctx.lineTo(s.x, s.y + spike);
          ctx.stroke();
        }
      }

      // Comets (hero only)
      for (let i = this.comets.length - 1; i >= 0; i--) {
        const c = this.comets[i];
        c.x += c.vx; c.y += c.vy;
        c.trail.push({ x: c.x, y: c.y });
        if (c.trail.length > 26) c.trail.shift();
        c.life = 1 - Math.max(0, (now - c.born) / 3500);
        const off = c.x < -80 || c.x > this.W + 80 || c.y > this.H + 80;
        if (off || c.life <= 0) {
          if (c.trail.length <= 1) { this.comets.splice(i, 1); continue; }
          c.trail.shift();
        }
        const toneRgb = c.tone === 'warm' ? palette.warm : palette.active;
        for (let k = 0; k < c.trail.length - 1; k++) {
          const t = k / c.trail.length;
          const p1 = c.trail[k], p2 = c.trail[k + 1];
          const alpha = t * 0.8 * c.life;
          ctx.strokeStyle = `rgba(${toneRgb},${alpha.toFixed(3)})`;
          ctx.lineWidth = 0.4 + t * 1.6;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        if (c.life > 0) {
          const headR = 2.2;
          const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, headR * 4);
          g.addColorStop(0, `rgba(${toneRgb},${c.life.toFixed(3)})`);
          g.addColorStop(1, `rgba(${toneRgb},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(c.x, c.y, headR * 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(${palette.fg},${c.life.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(c.x, c.y, headR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    boot(duration = 1600) {
      if (reduced) { this.revealed = this.N; this.revealAlpha = 1; return Promise.resolve(); }
      this.bootStart = performance.now();
      this.bootDur = Math.max(400, duration);
      setTimeout(() => this.launchComet(), 250);
      setTimeout(() => this.launchComet(), Math.min(this.bootDur - 200, 900));
      return new Promise((resolve) => setTimeout(resolve, this.bootDur));
    }
    revealInstant() { this.revealed = this.N; this.revealAlpha = 1; }
    updateTheme() { readTheme(); }
  }

  // ── Init all [data-constellation] canvases ────
  const instances = [];

  function initAll() {
    document.querySelectorAll('[data-constellation]').forEach((el) => {
      if (el._constellationBound) return;
      el._constellationBound = true;

      let canvas = el;
      if (canvas.tagName !== 'CANVAS') {
        const inner = document.createElement('canvas');
        inner.className = 'constellation-bg';
        inner.setAttribute('aria-hidden', 'true');
        inner.dataset.constellation = el.dataset.constellation;
        el.appendChild(inner);
        canvas = inner;
      }
      const preset = canvas.dataset.constellation || 'hero';
      const inst = new Constellation(canvas, preset);
      instances.push(inst);
      if (preset === 'hero') window.__heroCanvas = inst;
    });
  }

  // Route pointer to the ONE constellation whose rect contains it
  document.addEventListener('mousemove', (e) => {
    for (const inst of instances) {
      const r = inst.canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right
                  && e.clientY >= r.top  && e.clientY <= r.bottom;
      inst.setPointer(e.clientX - r.left, e.clientY - r.top, inside);
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!e.touches[0]) return;
    const t = e.touches[0];
    for (const inst of instances) {
      const r = inst.canvas.getBoundingClientRect();
      const inside = t.clientX >= r.left && t.clientX <= r.right
                  && t.clientY >= r.top  && t.clientY <= r.bottom;
      inst.setPointer(t.clientX - r.left, t.clientY - r.top, inside);
    }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    for (const inst of instances) inst.setPointer(0, 0, false);
  }, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
