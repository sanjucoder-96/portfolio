/* PixelCrypt — a working LSB encoder
   ─────────────────────────────────
   Eight rows of eight channel bytes. Each row carries one character:
   its eight bits are written, MSB first, into the least-significant bit
   of the row's eight bytes. Typing re-encodes; the "extracted" readout
   is decoded back out of the grid's LSBs, so the round trip is real.

   Cell states mirror the legend:
     payload  → this byte's LSB carries a message bit
     flip     → …and writing it actually changed the byte (by exactly 1) */

(() => {
  const grid = document.getElementById('pv-grid');
  const input = document.getElementById('pv-input');
  if (!grid || !input) return;
  const bitsEl = document.getElementById('pv-bits');
  const outEl = document.getElementById('pv-out');
  const probe = document.getElementById('pv-probe');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ROWS = 8, COLS = 8;
  const PROBE_IDLE = probe ? probe.textContent : '';

  // Carrier image: fixed pseudo-random channel bytes, so the same text
  // always flips the same bits.
  let seed = 0x5EED1E;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const carrier = Array.from({ length: ROWS * COLS }, () => Math.floor(rand() * 256));
  const stego = carrier.slice();

  const cells = [], chars = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'pixel-viz__cell';
      cell.innerHTML = '<span class="pv-bit pv-bit--high"></span><span class="pv-bit pv-bit--lsb"></span>';
      cell.dataset.i = r * COLS + c;
      grid.appendChild(cell);
      cells.push(cell);
    }
    const ch = document.createElement('div');
    ch.className = 'pixel-viz__char';
    grid.appendChild(ch);
    chars.push(ch);
  }

  const printable = (s) => s.replace(/[^\x20-\x7E]/g, '').slice(0, ROWS);

  function encode(text, animate) {
    const bitGroups = [];
    for (let r = 0; r < ROWS; r++) {
      const code = r < text.length ? text.charCodeAt(r) : null;
      if (code !== null) bitGroups.push(code.toString(2).padStart(8, '0'));
      chars[r].textContent = code === null ? '·' : (text[r] === ' ' ? '␣' : text[r]);
      chars[r].classList.toggle('is-on', code !== null);

      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const before = stego[i];
        // (byte & ~1) | bit — the whole technique in one line
        stego[i] = code === null ? carrier[i] : ((carrier[i] & 0xFE) | ((code >> (7 - c)) & 1));

        const cell = cells[i];
        const bin = stego[i].toString(2).padStart(8, '0');
        cell.firstChild.textContent = bin.slice(0, 7);
        cell.lastChild.textContent = bin.slice(7);
        cell.classList.toggle('is-payload', code !== null);
        cell.classList.toggle('is-flip', code !== null && stego[i] !== carrier[i]);

        if (animate && !reduced && before !== stego[i]) {
          cell.classList.remove('is-write');
          cell.style.animationDelay = (c * 28) + 'ms';
          void cell.offsetWidth;                    // restart the keyframes
          cell.classList.add('is-write');
        }
      }
    }
    bitsEl.textContent = bitGroups.length ? bitGroups.join(' ') : '—';
    outEl.textContent = decode() || '—';
  }

  // Read the message back out of the low bits — nothing is copied from the input.
  function decode() {
    let text = '';
    for (let r = 0; r < ROWS; r++) {
      if (!cells[r * COLS].classList.contains('is-payload')) break;
      let code = 0;
      for (let c = 0; c < COLS; c++) code = (code << 1) | (stego[r * COLS + c] & 1);
      text += String.fromCharCode(code);
    }
    return text;
  }

  input.addEventListener('input', () => {
    const clean = printable(input.value);
    if (clean !== input.value) input.value = clean;
    encode(clean, true);
  });

  // Probe: how much did this byte actually move?
  grid.addEventListener('pointerover', (e) => {
    const cell = e.target.closest('.pixel-viz__cell');
    if (!cell || !probe) return;
    const i = +cell.dataset.i;
    const delta = Math.abs(stego[i] - carrier[i]);
    probe.textContent = cell.classList.contains('is-payload')
      ? `byte ${carrier[i]} → ${stego[i]} · Δ ${delta}${delta ? '' : ' (already matched)'}`
      : `byte ${carrier[i]} · untouched`;
  });
  grid.addEventListener('pointerleave', () => { if (probe) probe.textContent = PROBE_IDLE; });

  encode(printable(input.value), false);
})();
