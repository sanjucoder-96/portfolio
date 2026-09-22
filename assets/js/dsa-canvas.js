/* DSA — algorithm constellation on canvas */
(() => {
  const canvas = document.getElementById('dsa-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0;
  const dots = [];
  const N = 240;

  // theme-aware palette (kind: 'graph' | 'warm' | 'agent' | 'java')
  const pal = { graph: '124,217,192', warm: '229,178,93', agent: '168,151,245', java: '240,131,108', fg: '242,241,234', isLight: false };
  function readTheme() {
    const s = getComputedStyle(document.documentElement);
    pal.graph = (s.getPropertyValue('--rgb-graph') || '124,217,192').trim();
    pal.warm  = (s.getPropertyValue('--rgb-warm')  || '229,178,93').trim();
    pal.agent = (s.getPropertyValue('--rgb-agent') || '168,151,245').trim();
    pal.fg    = (s.getPropertyValue('--rgb-fg')    || '242,241,234').trim();
    pal.isLight = document.documentElement.getAttribute('data-theme') === 'light';
  }
  readTheme();
  window.addEventListener('themechange', readTheme);
  const kindOf = (colorKind) => `rgba(${pal[colorKind]},1)`;

  const TOPICS = [
    { name: 'ARR',    angle: 0,             r: 0.85, kind: 'graph' },
    { name: 'TREE',   angle: Math.PI * 0.16, r: 0.72, kind: 'warm' },
    { name: 'DP',     angle: Math.PI * 0.32, r: 0.65, kind: 'agent' },
    { name: 'GRPH',   angle: Math.PI * 0.48, r: 0.78, kind: 'graph' },
    { name: 'STR',    angle: Math.PI * 0.64, r: 0.68, kind: 'graph' },
    { name: 'MATH',   angle: Math.PI * 0.80, r: 0.55, kind: 'warm' },
    { name: 'BT',     angle: Math.PI * 0.96, r: 0.58, kind: 'agent' },
    { name: 'SW',     angle: Math.PI * 1.12, r: 0.7,  kind: 'graph' },
    { name: 'HEAP',   angle: Math.PI * 1.28, r: 0.5,  kind: 'warm' },
    { name: 'BIT',    angle: Math.PI * 1.44, r: 0.45, kind: 'graph' },
    { name: 'GREEDY', angle: Math.PI * 1.60, r: 0.6,  kind: 'agent' },
    { name: 'CONC',   angle: Math.PI * 1.76, r: 0.4,  kind: 'graph' },
  ];

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function init() {
    resize();
    dots.length = 0;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.42;

    // for each topic, plot a cluster of dots at its radius
    TOPICS.forEach((t) => {
      const clusterCount = Math.round((t.r) * (N / TOPICS.length) * 1.5);
      for (let i = 0; i < clusterCount; i++) {
        const spread = 0.14 + Math.random() * 0.08;
        const jitter = (Math.random() - 0.5) * spread;
        const rj     = t.r + (Math.random() - 0.5) * 0.18;
        dots.push({
          topic: t.name,
          kind: t.kind,
          a: t.angle + jitter,
          r: R * rj * 0.9,
          cx, cy,
          x: 0, y: 0,
          size: Math.random() < 0.15 ? 2.2 : 1.2,
          phase: Math.random() * Math.PI * 2,
        });
      }
    });
  }

  let start = 0;
  function tick(t) {
    if (!start) start = t;
    const elapsed = (t - start) / 1000;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.42;

    // orbit rings
    const gridAlpha = pal.isLight ? 0.08 : 0.05;
    ctx.strokeStyle = `rgba(${pal.fg},${gridAlpha})`;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * (i / 4) * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // radial ticks
    ctx.strokeStyle = `rgba(${pal.fg},${pal.isLight ? 0.06 : 0.04})`;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.15, cy + Math.sin(a) * R * 0.15);
      ctx.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
      ctx.stroke();
    }

    // dots
    dots.forEach((d) => {
      const a = d.a + elapsed * 0.03;
      d.x = cx + Math.cos(a) * d.r;
      d.y = cy + Math.sin(a) * d.r;
      const pulse = 0.6 + Math.sin(elapsed * 1.4 + d.phase) * 0.4;
      ctx.fillStyle = `rgb(${pal[d.kind] || pal.graph})`;
      ctx.globalAlpha = (pal.isLight ? 0.55 : 0.45) + 0.35 * pulse;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // topic labels
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    TOPICS.forEach((t) => {
      const a = t.angle + elapsed * 0.03;
      const lx = cx + Math.cos(a) * R * (t.r + 0.14);
      const ly = cy + Math.sin(a) * R * (t.r + 0.14);
      ctx.fillStyle = `rgba(${pal.fg},${pal.isLight ? 0.75 : 0.55})`;
      ctx.fillText(t.name, lx, ly);
    });

    // center
    ctx.fillStyle = `rgb(${pal.fg})`;
    ctx.font = '500 12px "JetBrains Mono", monospace';
    ctx.fillText('SU · DSA', cx, cy - 6);
    ctx.fillStyle = `rgba(${pal.graph},0.9)`;
    ctx.font = '400 10px "JetBrains Mono", monospace';
    ctx.fillText('600+', cx, cy + 10);

    if (!reduced) requestAnimationFrame(tick);
  }

  window.addEventListener('resize', init);

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        init();
        requestAnimationFrame(tick);
        io.disconnect();
      }
    });
  }, { threshold: 0.1 });
  io.observe(canvas);
})();

/* Java sliding-window mini viz */
(() => {
  const track = document.getElementById('wv-track');
  const win   = document.getElementById('wv-window');
  if (!track || !win) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EVENTS = 22;
  const dots = [];

  function build() {
    // preserve the window element (child of track)
    track.querySelectorAll('.wv__dot').forEach(n => n.remove());
    dots.length = 0;
    for (let i = 0; i < EVENTS; i++) {
      const d = document.createElement('span');
      d.className = 'wv__dot';
      const left = (i / (EVENTS - 1)) * 100;
      d.style.left = left + '%';
      track.appendChild(d);
      dots.push({ el: d, i });
    }
  }

  function place(pos) {
    const trackW = track.clientWidth;
    if (trackW === 0) return;
    const winWidthPct = 34; // 34% of track
    const leftPct = pos * (100 - winWidthPct);
    win.style.left = leftPct + '%';
    win.style.width = winWidthPct + '%';

    const winStart = leftPct;
    const winEnd = leftPct + winWidthPct;
    dots.forEach((d) => {
      const cx = (d.i / (EVENTS - 1)) * 100;
      const inWindow = cx >= winStart && cx <= winEnd;
      d.el.classList.toggle('in', inWindow);
      const isAnom = inWindow && d.i === Math.round(pos * (EVENTS - 1)) + 1 && (d.i % 5 === 0);
      d.el.classList.toggle('anom', isAnom);
    });
  }

  build();

  let running = false;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && !running) {
        running = true;
        let t0 = 0;
        function loop(t) {
          if (!t0) t0 = t;
          const elapsed = (t - t0) / 3500;
          const pos = (Math.sin(elapsed * Math.PI) + 1) / 2 * 0.9 + 0.02;
          place(pos);
          if (running && !reduced) requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
      } else {
        running = false;
      }
    });
  }, { threshold: 0.25 });
  io.observe(track);
  window.addEventListener('resize', () => place(0.4));
})();
