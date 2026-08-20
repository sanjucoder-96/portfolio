/* PixelCrypt LSB visualization — 8-bit byte grid with highlighted LSBs */
(() => {
  const grid = document.getElementById('pv-grid');
  if (!grid) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLS = 12, ROWS = 5;
  const cells = [];

  function build() {
    grid.innerHTML = '';
    cells.length = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const cell = document.createElement('div');
        cell.className = 'pixel-viz__cell';
        // pretend the cell encodes 1 payload bit — random start
        const byte = Math.floor(Math.random() * 256);
        const bits = byte.toString(2).padStart(8, '0');
        cell.innerHTML = `
          <span class="pv-bit pv-bit--high">${bits.slice(0,7)}</span><span class="pv-bit pv-bit--lsb">${bits.slice(7)}</span>
        `;
        // mark ~30% of cells as carrying payload
        if (Math.random() < 0.32) cell.classList.add('is-payload');
        grid.appendChild(cell);
        cells.push(cell);
      }
    }
  }
  build();

  if (reduced) return;

  // Live flicker: LSB of payload cells toggles subtly to hint "payload writing"
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) { running = false; return; }
      if (!running) { running = true; loop(); }
    });
  }, { threshold: 0.2 });

  let running = false;
  let last = 0;
  function loop(now) {
    if (!running) return;
    if (!last) last = now || performance.now();
    if ((now - last) > 480) {
      last = now;
      // toggle a couple of payload cells' LSB bit visually
      const payloadCells = cells.filter(c => c.classList.contains('is-payload'));
      const target = payloadCells[Math.floor(Math.random() * payloadCells.length)];
      if (target) {
        const lsb = target.querySelector('.pv-bit--lsb');
        if (lsb) lsb.textContent = lsb.textContent === '0' ? '1' : '0';
      }
    }
    requestAnimationFrame(loop);
  }
  io.observe(grid);
})();
