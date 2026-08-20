/* GraphGST — animated Neo4j-style graph with Cypher traversal */
(() => {
  const svg = document.getElementById('graph-svg');
  if (!svg) return;

  const NS = 'http://www.w3.org/2000/svg';
  const W = 800, H = 520;

  // Layout: a ring of 12 "entities" with a highlighted cycle a→b→c→d→e→a
  const nodes = [];
  const cx = W * 0.5, cy = H * 0.5;
  const R  = 190;
  const count = 12;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      id: `E${(i + 1).toString().padStart(2,'0')}`,
      x: cx + Math.cos(angle) * R + (i % 3 === 0 ? -20 : 15),
      y: cy + Math.sin(angle) * R + (i % 2 === 0 ? 8 : -12),
    });
  }
  // A few inner nodes
  nodes.push({ id: 'HUB', x: cx, y: cy });
  nodes.push({ id: 'E13', x: cx + 60, y: cy - 40 });
  nodes.push({ id: 'E14', x: cx - 70, y: cy + 30 });

  // Non-cycle edges
  const edges = [
    [0, 12], [1, 12], [2, 13], [3, 13], [4, 13], [5, 12], [6, 12],
    [7, 12], [8, 14], [9, 14], [10, 14], [11, 14],
    [12, 13], [12, 14], [13, 14],
    [0, 2], [1, 4], [3, 6], [5, 8], [7, 10], [9, 11], [11, 0],
  ];

  // Cycle to trace (circular trading)
  const cycle = [1, 4, 7, 10, 12, 1]; // hub included

  const edgesG   = svg.querySelector('#graph-edges');
  const traceG   = svg.querySelector('#graph-trace');
  const nodesG   = svg.querySelector('#graph-nodes');
  const labelsG  = svg.querySelector('#graph-labels');

  // Draw edges
  edges.forEach(([a, b]) => {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', nodes[a].x);
    line.setAttribute('y1', nodes[a].y);
    line.setAttribute('x2', nodes[b].x);
    line.setAttribute('y2', nodes[b].y);
    edgesG.appendChild(line);
  });

  // Draw nodes
  nodes.forEach((n, i) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('r', 18);
    halo.setAttribute('fill', 'url(#node-gradient)');
    halo.setAttribute('opacity', '0');
    halo.setAttribute('data-halo', i);
    g.appendChild(halo);

    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('r', i >= 12 ? 8 : 6);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'currentColor');
    ring.setAttribute('stroke-opacity', '0.4');
    ring.setAttribute('stroke-width', '1');
    g.appendChild(ring);

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', i >= 12 ? 3.2 : 2.4);
    dot.setAttribute('fill', 'currentColor');
    dot.setAttribute('fill-opacity', '0.7');
    dot.setAttribute('data-dot', i);
    g.appendChild(dot);

    nodesG.appendChild(g);

    if (i < 12 || i === 12) {
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', n.x + 12);
      label.setAttribute('y', n.y - 8);
      label.textContent = n.id;
      labelsG.appendChild(label);
    }
  });

  // Cypher lines to rotate through
  const cypherLines = [
    'MATCH (a:Entity)-[:INVOICE*1..5]->(a)',
    'MATCH (a)-[r:GSTIN]->(b) WHERE r.pattern="circular"',
    'CALL apoc.periodic.iterate("MATCH cycle...")',
    'RETURN a, collect(nodes) AS path, sum(amount) AS flow',
  ];
  const cypherEl = document.getElementById('cypher-line');
  const nodeCountEl = document.getElementById('node-count');
  const detectEl = document.getElementById('detect-line');

  let cypherIdx = 0;
  let running = false;

  function typeText(el, text, speed = 20) {
    return new Promise((resolve) => {
      el.textContent = '';
      let i = 0;
      const step = () => {
        el.textContent = text.slice(0, i);
        i++;
        if (i <= text.length) setTimeout(step, speed);
        else resolve();
      };
      step();
    });
  }

  function highlightCycle() {
    // Build path
    let pathD = '';
    cycle.forEach((idx, i) => {
      const n = nodes[idx];
      pathD += (i === 0 ? 'M' : 'L') + n.x + ',' + n.y + ' ';
    });
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('stroke', 'var(--accent-graph)');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-dasharray', '4 4');
    traceG.innerHTML = '';
    traceG.appendChild(path);

    const len = path.getTotalLength();
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    path.style.transition = 'stroke-dashoffset 2s cubic-bezier(.7,0,.2,1)';
    requestAnimationFrame(() => { path.style.strokeDashoffset = 0; });

    // Highlight cycle nodes
    cycle.forEach((idx, i) => {
      const halo = svg.querySelector(`[data-halo="${idx}"]`);
      const dot = svg.querySelector(`[data-dot="${idx}"]`);
      setTimeout(() => {
        if (halo) { halo.style.transition = 'opacity .4s'; halo.style.opacity = '0.9'; }
        if (dot) { dot.setAttribute('fill', 'var(--accent-graph)'); dot.setAttribute('fill-opacity', '1'); }
      }, i * 350);
    });
  }

  function fadeCycle() {
    traceG.innerHTML = '';
    cycle.forEach((idx) => {
      const halo = svg.querySelector(`[data-halo="${idx}"]`);
      const dot = svg.querySelector(`[data-dot="${idx}"]`);
      if (halo) halo.style.opacity = '0';
      if (dot) { dot.setAttribute('fill', 'currentColor'); dot.setAttribute('fill-opacity', '0.7'); }
    });
  }

  async function loop() {
    if (running) return;
    running = true;
    while (running) {
      const line = cypherLines[cypherIdx % cypherLines.length];
      cypherIdx++;
      await typeText(cypherEl, line, 22);
      await typeText(nodeCountEl, `${(Math.random() * 400 + 800).toFixed(0)} entities · ${(Math.random() * 6000 + 3000).toFixed(0)} edges`, 12);
      await new Promise(r => setTimeout(r, 300));
      highlightCycle();
      await typeText(detectEl, '1 circular trade cycle · 5 entities · flagged', 15);
      await new Promise(r => setTimeout(r, 3200));
      fadeCycle();
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Start when in view
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) loop();
      else running = false;
    });
  }, { threshold: 0.25 });
  io.observe(svg);
})();
