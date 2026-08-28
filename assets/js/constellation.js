/* Constellation — reusable, spring-relaxed 2D graph fields
   ─────────────────────────────────────────────────────────
   Every `[data-constellation="<preset>"]` element becomes an
   independent, interactive constellation field. Fields are LOCAL:
   the pointer only drives the one field whose rect contains it, so
   the whole page never reacts at once.

   Structure — clusters are assigned a TIER so the page reads as
   layered graphs in space rather than uniform noise:

     back  → many small, very faint nodes, short links   (depth)
     mid   → medium nodes, medium links                  (body)
     fore  → fewer, larger, brighter nodes, long links   (focus)

   Physics (per star, per frame):
     home   = anchor + slow sinusoidal drift
     spring = (home - pos) * springK
     cursor = normalize(pos - cursor) * falloff          (repel)
     v      = (v + spring + cursor) * damping
     pos   += v

   Because `anchor` is never mutated, a displaced field ALWAYS
   relaxes back to its original shape — no permanent deformation,
   and no teleporting.

   Public API (window.Constellation):
     create(el, preset)   → instance
     destroy(elOrInst)    → tears down RAF + observers
     setInteraction(bool) → globally enable/disable pointer response
     all()                → live instance list                       */

(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  // ── Theme ────────────────────────────────────
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

  // Deterministic PRNG so formations are identical across reloads
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

  // ── Tier definitions — the layering that gives the field depth ──
  //  sizeMul / alphaMul / linkMul scale the preset's base values.
  const TIERS = [
    { key: 'back', weight: 0.42, stars: [7, 13], radius: [45, 85],  sizeMul: 0.62, alphaMul: 0.34, linkMul: 0.68 },
    { key: 'mid',  weight: 0.36, stars: [5, 9],  radius: [70, 120], sizeMul: 1.00, alphaMul: 0.78, linkMul: 1.00 },
    { key: 'fore', weight: 0.22, stars: [3, 6],  radius: [95, 155], sizeMul: 1.45, alphaMul: 1.15, linkMul: 1.35 },
  ];

  // ── Per-section presets ──────────────────────
  const PRESETS = {
    hero: {
      clusterAreaPx: 46000, seed: 20260820,
      linkDist: 120, cursorRadius: 200, cursorForce: 7.5,
      springK: 0.010, damping: 0.86,
      accentPct: 0.15, lineAlpha: 0.22,
      baseOpacityMin: 0.40, baseOpacityRange: 0.55,
      driftAmp: [3, 10], driftFreq: [0.00015, 0.0004],
      twinkleSpeed: [0.003, 0.007],
      canvasOpacity: null, comets: true, coreLink: true,
    },
    stack: {
      clusterAreaPx: 62000, seed: 20260821,
      linkDist: 108, cursorRadius: 165, cursorForce: 5.6,
      springK: 0.012, damping: 0.87,
      accentPct: 0.10, lineAlpha: 0.16,
      baseOpacityMin: 0.34, baseOpacityRange: 0.5,
      driftAmp: [2, 7], driftFreq: [0.0002, 0.0005],
      twinkleSpeed: [0.0025, 0.006],
      canvasOpacity: 0.62, comets: false,
    },
    dsa: {
      clusterAreaPx: 58000, seed: 20260822,
      linkDist: 110, cursorRadius: 170, cursorForce: 5.8,
      springK: 0.011, damping: 0.86,
      accentPct: 0.12, lineAlpha: 0.18,
      baseOpacityMin: 0.36, baseOpacityRange: 0.52,
      driftAmp: [2, 8], driftFreq: [0.0002, 0.00045],
      twinkleSpeed: [0.0025, 0.006],
      canvasOpacity: 0.64, comets: false,
    },
    work: {
      clusterAreaPx: 78000, seed: 20260824,
      linkDist: 104, cursorRadius: 160, cursorForce: 5.0,
      springK: 0.012, damping: 0.87,
      accentPct: 0.09, lineAlpha: 0.13,
      baseOpacityMin: 0.30, baseOpacityRange: 0.46,
      driftAmp: [2, 7], driftFreq: [0.0002, 0.0005],
      twinkleSpeed: [0.0025, 0.006],
      canvasOpacity: 0.5, comets: false,
    },
    contact: {
      clusterAreaPx: 74000, seed: 20260823,
      linkDist: 100, cursorRadius: 150, cursorForce: 4.8,
      springK: 0.013, damping: 0.87,
      accentPct: 0.10, lineAlpha: 0.13,
      baseOpacityMin: 0.32, baseOpacityRange: 0.48,
      driftAmp: [2, 6], driftFreq: [0.00025, 0.00055],
      twinkleSpeed: [0.0025, 0.005],
      canvasOpacity: 0.52, comets: false,
    },
  };

  // Device budget — mobile fields stay light
  function densityScale() {
    const w = window.innerWidth;
    if (w < 640) return 1.55;    // larger divisor ⇒ fewer clusters
    if (w < 1024) return 1.25;
    return 1;
  }

  let interactionEnabled = true;
  const instances = [];

  // ── Instance ─────────────────────────────────
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
      this.booted = false;
      this.bootStart = 0;
      this.bootDur = 0;
      this.visible = true;
      this.lastCometAt = 0;
      this.destroyed = false;
      this.raf = 0;

      if (this.p.canvasOpacity !== null) canvas.style.opacity = this.p.canvasOpacity;

      this.resize = this.resize.bind(this);
      this.tick = this.tick.bind(this);
      this._onResize = () => { this.resize(); this.scatter(); };
      window.addEventListener('resize', this._onResize);

      this.resize();
      this.scatter();

      this.io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { this.visible = e.isIntersecting; });
      }, { threshold: 0.02 });
      this.io.observe(canvas);

      this.raf = requestAnimationFrame(this.tick);
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

      const area = this.W * this.H;
      const K = Math.max(3, Math.min(54, Math.floor(area / (P.clusterAreaPx * densityScale()))));

      const aspect = this.W / this.H;
      const cols = Math.max(2, Math.round(Math.sqrt(K * aspect)));
      const rows = Math.max(2, Math.ceil(K / cols));
      const cellW = this.W / cols;
      const cellH = this.H / rows;

      // Pick a tier by weighted choice — deterministic via the seeded rng
      const pickTier = () => {
        const r = rng();
        let acc = 0;
        for (const t of TIERS) { acc += t.weight; if (r <= acc) return t; }
        return TIERS[TIERS.length - 1];
      };

      let clusterIdx = 0;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (clusterIdx >= K) break;
          clusterIdx++;

          const tier = pickTier();
          const centerX = (cx + 0.15 + rng() * 0.7) * cellW;
          const centerY = (cy + 0.15 + rng() * 0.7) * cellH;
          const count = Math.floor(rand(tier.stars[0], tier.stars[1] + 1));
          const rMax  = rand(tier.radius[0], tier.radius[1]);

          for (let i = 0; i < count; i++) {
            const angle = rng() * Math.PI * 2;
            const r = Math.pow(rng(), 0.7) * rMax;   // centre-biased for organic clumping
            const homeX = centerX + Math.cos(angle) * r;
            const homeY = centerY + Math.sin(angle) * r;
            if (homeX < 8 || homeX > this.W - 8 || homeY < 8 || homeY > this.H - 8) continue;

            const mag = rng();
            const sizeBase = mag < P.accentPct       ? (1.8 + rng() * 1.3)
                           : mag < P.accentPct + 0.3 ? (1.1 + rng() * 0.6)
                                                     : (0.55 + rng() * 0.4);
            this.stars.push({
              anchorX: homeX, anchorY: homeY,
              x: homeX, y: homeY,
              vx: 0, vy: 0,
              r: sizeBase * tier.sizeMul,
              base: (P.baseOpacityMin + mag * P.baseOpacityRange) * tier.alphaMul,
              link: P.linkDist * tier.linkMul,
              tier: tier.key,
              twinkle: rng() * Math.PI * 2,
              twinkleSpeed: rand(P.twinkleSpeed[0], P.twinkleSpeed[1]),
              driftAmpX: rand(P.driftAmp[0], P.driftAmp[1]),
              driftAmpY: rand(P.driftAmp[0], P.driftAmp[1]),
              driftFreqX: rand(P.driftFreq[0], P.driftFreq[1]),
              driftFreqY: rand(P.driftFreq[0], P.driftFreq[1]),
              driftPhaseX: rng() * Math.PI * 2,
              driftPhaseY: rng() * Math.PI * 2,
              accent: mag < P.accentPct && tier.key !== 'back',
              birth: rng(),
            });
          }
        }
      }
      this.stars.sort((a, b) => a.birth - b.birth);
      this.N = this.stars.length;
      this.maxLink = this.stars.reduce((m, s) => Math.max(m, s.link), P.linkDist);

      // Reveal state after a (re)scatter. A resize rebuilds `stars`, so always
      // clamp: a shrink must not leave `revealed` past the (now shorter) array.
      if (this.bootDur === 0 && (this.presetName !== 'hero' || this.booted)) {
        this.revealed = this.N;
        this.revealAlpha = 1;
      }
      if (this.revealed > this.N) this.revealed = this.N;
    }

    setPointer(localX, localY, isInside) {
      if (isInside && interactionEnabled) { this.mx = localX; this.my = localY; this.active = true; }
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

    /* Uniform spatial grid over the revealed stars — turns the edge pass from
       O(N²) into ~O(N·k). Matters now that fields are much denser. */
    buildGrid() {
      const cell = Math.max(24, this.maxLink);
      const cols = Math.max(1, Math.ceil(this.W / cell));
      const rows = Math.max(1, Math.ceil(this.H / cell));
      const buckets = new Array(cols * rows);
      for (let i = 0; i < this.revealed; i++) {
        const s = this.stars[i];
        const cx = Math.min(cols - 1, Math.max(0, (s.x / cell) | 0));
        const cy = Math.min(rows - 1, Math.max(0, (s.y / cell) | 0));
        const k = cy * cols + cx;
        (buckets[k] || (buckets[k] = [])).push(i);
      }
      return { cell, cols, rows, buckets };
    }

    tick(now) {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(this.tick);
      if (!this.visible || document.hidden) return;

      if (this.bootDur > 0) {
        const p = Math.min(1, (now - this.bootStart) / this.bootDur);
        const eased = 1 - Math.pow(1 - p, 3);
        this.revealed = Math.floor(eased * this.N);
        this.revealAlpha = eased;
        if (p >= 1) { this.bootDur = 0; this.booted = true; }
      }

      if (this.p.comets && !reduced && this.presetName === 'hero'
          && now - this.lastCometAt > 9500 + Math.random() * 6000) {
        this.launchComet();
        this.lastCometAt = now;
      }

      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.W, this.H);

      /* Light mode runs the field but draws nothing. On a light ground the
         scattered nodes and connecting lines read as clutter behind the
         typography; the hero's own particle figure and palm graph carry the
         visual. Dark mode is unaffected — the atmosphere stays there. */
      if (palette.isLight) return;

      // ── Physics ──
      const { springK, damping, cursorRadius, cursorForce } = this.p;
      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];
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

      // ── Edges (neighbour search via grid) ──
      const lineBoost = palette.isLight ? 1.55 : 1;
      const grid = this.buildGrid();
      for (let i = 0; i < this.revealed; i++) {
        const a = this.stars[i];
        const cx = Math.min(grid.cols - 1, Math.max(0, (a.x / grid.cell) | 0));
        const cy = Math.min(grid.rows - 1, Math.max(0, (a.y / grid.cell) | 0));
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          if (gy < 0 || gy >= grid.rows) continue;
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            if (gx < 0 || gx >= grid.cols) continue;
            const bucket = grid.buckets[gy * grid.cols + gx];
            if (!bucket) continue;
            for (let bi = 0; bi < bucket.length; bi++) {
              const j = bucket[bi];
              if (j <= i) continue;                    // each pair once
              const b = this.stars[j];
              const link = Math.min(a.link, b.link);   // tier-aware connection length
              const dx = a.x - b.x, dy = a.y - b.y;
              const d2 = dx * dx + dy * dy;
              if (d2 >= link * link) continue;
              const d = Math.sqrt(d2);
              const t = 1 - d / link;
              const tierFade = (a.tier === 'back' || b.tier === 'back') ? 0.45
                             : (a.tier === 'fore' && b.tier === 'fore') ? 1.25 : 1;
              const alpha = t * this.p.lineAlpha * this.revealAlpha * lineBoost * tierFade;
              if (alpha < 0.004) continue;
              ctx.strokeStyle = `rgba(${palette.edge},${alpha.toFixed(3)})`;
              ctx.lineWidth = 0.65;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }

      /* ── Convergence on the graph cube ──
         The anchors published by the 3D rig are the CUBE's graph nodes,
         so these lines read as the background network feeding into the
         computational model. An anchor's `act` (its live activation)
         brightens its links, which is how a graph pulse inside the cube
         visibly spills out into the surrounding constellation. */
      if (this.p.coreLink && window.__coreAnchors && window.__coreAnchors.length) {
        const rect = this.canvas.getBoundingClientRect();
        const anchors = window.__coreAnchors;
        const REACH = 260;                     // longer, so convergence reads
        ctx.lineWidth = 0.6;
        for (let ai = 0; ai < anchors.length; ai++) {
          const a = anchors[ai];
          const ax = a.x - rect.left;
          const ay = a.y - rect.top;
          if (ax < -80 || ax > this.W + 80 || ay < -80 || ay > this.H + 80) continue;
          const pulse = a.act || 0;
          for (let i = 0; i < this.revealed; i++) {
            const s = this.stars[i];
            if (s.tier === 'back') continue;
            const dx = s.x - ax, dy = s.y - ay;
            const d2 = dx * dx + dy * dy;
            if (d2 >= REACH * REACH) continue;
            const d = Math.sqrt(d2);
            const t = 1 - d / REACH;
            const alpha = t * t * (0.16 + pulse * 0.5) * this.revealAlpha * lineBoost;
            if (alpha < 0.006) continue;
            ctx.strokeStyle = `rgba(${palette.active},${alpha.toFixed(3)})`;
            ctx.lineWidth = 0.6 + pulse * 0.7;
            ctx.beginPath();
            ctx.moveTo(ax, ay); ctx.lineTo(s.x, s.y);
            ctx.stroke();
            // a firing cube node briefly lights the star it reaches
            if (pulse > 0.35 && t > 0.55) {
              ctx.fillStyle = `rgba(${palette.active},${(pulse * t * 0.6).toFixed(3)})`;
              ctx.beginPath();
              ctx.arc(s.x, s.y, s.r * (1 + pulse), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // ── Cursor-linked highlight edges ──
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

      // ── Stars ──
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

      // ── Comets (hero only) ──
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
      if (reduced) { this.revealed = this.N; this.revealAlpha = 1; this.booted = true; return Promise.resolve(); }
      this.bootStart = performance.now();
      this.bootDur = Math.max(400, duration);
      setTimeout(() => this.launchComet(), 250);
      setTimeout(() => this.launchComet(), Math.min(this.bootDur - 200, 900));
      return new Promise((resolve) => setTimeout(resolve, this.bootDur));
    }
    revealInstant() { this.revealed = this.N; this.revealAlpha = 1; this.booted = true; }
    updateTheme() { readTheme(); }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.raf);
      window.removeEventListener('resize', this._onResize);
      this.io?.disconnect();
      try { this.ctx.clearRect(0, 0, this.W, this.H); } catch (e) {}
      const idx = instances.indexOf(this);
      if (idx >= 0) instances.splice(idx, 1);
      if (this.canvas) this.canvas._constellationBound = false;
    }
  }

  // ── Factory / registry ───────────────────────
  function create(el, presetName) {
    if (!el || el._constellationBound) return null;
    el._constellationBound = true;

    let canvas = el;
    if (canvas.tagName !== 'CANVAS') {
      const inner = document.createElement('canvas');
      inner.className = 'constellation-bg';
      inner.setAttribute('aria-hidden', 'true');
      inner.dataset.constellation = el.dataset.constellation || presetName || 'hero';
      el.appendChild(inner);
      canvas = inner;
    }
    const preset = presetName || canvas.dataset.constellation || 'hero';
    const inst = new Constellation(canvas, preset);
    instances.push(inst);
    if (preset === 'hero') window.__heroCanvas = inst;
    return inst;
  }

  function destroy(target) {
    const inst = target instanceof Constellation
      ? target
      : instances.find((i) => i.canvas === target || i.canvas.parentElement === target);
    inst?.destroy();
  }

  function initAll() {
    document.querySelectorAll('[data-constellation]').forEach((el) => create(el));
  }

  // ── Pointer routing — only the field under the cursor reacts ──
  function route(clientX, clientY) {
    for (const inst of instances) {
      const r = inst.canvas.getBoundingClientRect();
      const inside = clientX >= r.left && clientX <= r.right
                  && clientY >= r.top  && clientY <= r.bottom;
      inst.setPointer(clientX - r.left, clientY - r.top, inside);
    }
  }

  document.addEventListener('mousemove', (e) => route(e.clientX, e.clientY), { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (e.touches[0]) route(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    for (const inst of instances) inst.setPointer(0, 0, false);
  }, { passive: true });

  window.Constellation = {
    create, destroy, initAll,
    all: () => instances.slice(),
    setInteraction: (on) => {
      interactionEnabled = !!on;
      if (!interactionEnabled) instances.forEach((i) => { i.active = false; });
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
