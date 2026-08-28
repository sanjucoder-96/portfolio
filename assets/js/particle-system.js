/* Computational Robot + Graph Cube
   ─────────────────────────────────────────────────────────────
   An abstract engineered entity supporting a floating knowledge-graph
   cube. Everything is generated at runtime — no model, no image.

   COMPOSITION
     The whole rig sits in the RIGHT ~37% of the hero so the headline
     keeps the left side entirely to itself.

   THE ROBOT  (support, not spectacle)
     Sparse geometric frame — head, torso, two limbs (one raised to
     carry the cube), base. Thin structural lines between joints,
     a handful of glowing joint nodes. Deliberately quiet.

   THE GRAPH CUBE  (the centrepiece)
     A transparent wireframe volume holding a live graph: clustered
     nodes, edges, travelling packets, a few nodes escaping the hull.
     Activation propagates node → edge → neighbour → settles, adapted
     from the 21st.dev "neurons hero" pulse/refractory model.

   PARTICLE WEIGHTING  (noise control)
     ~87% tiny structural · ~10% medium · ~3% bright focal.
     The bright ones are graph nodes, robot joints and live packets —
     never random dust.                                              */

import * as THREE from 'three';

const host = document.getElementById('core-stage');
if (host) init(host);

function init(host) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Device budget — far leaner than a dense humanoid ──
  const vw = window.innerWidth;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  let tier;
  if (vw < 640) tier = 'mobile';
  else if (vw < 1100) tier = 'tablet';
  else tier = (cores <= 4 || mem <= 4) ? 'tablet' : 'desktop';

  const BUDGET = {
    desktop: { robot: 9000, dissolve: 1400, ambient: 500, graphNodes: 30 },
    tablet:  { robot: 4800, dissolve: 700,  ambient: 260, graphNodes: 24 },
    mobile:  { robot: 2000, dissolve: 300,  ambient: 120, graphNodes: 16 },
  }[tier];

  // ── Renderer ─────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: tier !== 'mobile', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'mobile' ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 15);

  const rig = new THREE.Group();      // robot + cube together
  scene.add(rig);
  const robotGroup = new THREE.Group();
  const cubeGroup = new THREE.Group();
  rig.add(robotGroup, cubeGroup);

  // Cube floats beside the robot's raised limb
  const CUBE_POS = new THREE.Vector3(-2.80, 1.20, 0.70);   // floating above the open palm
  const CUBE_R = 0.78;                                     // small — the focal jewel, not a box
  cubeGroup.position.copy(CUBE_POS);

  // ── Theme ────────────────────────────────────
  const col = { dim: new THREE.Color(), mid: new THREE.Color(), hot: new THREE.Color() };
  function rgbVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const p = (v || fallback).split(',').map((n) => parseFloat(n) / 255);
    return new THREE.Color(p[0], p[1], p[2]);
  }
  let isLight = false;
  function readTheme() {
    isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const accent = rgbVar('--rgb-graph', '124,217,192');
    if (isLight) {
      col.dim = new THREE.Color(0.30, 0.35, 0.42);      // graphite
      col.mid = new THREE.Color(0.13, 0.20, 0.30);      // deep blue
      col.hot = accent.clone().multiplyScalar(0.65);    // muted cyan
    } else {
      col.dim = rgbVar('--rgb-fg', '242,241,234').multiplyScalar(0.75);
      col.mid = accent.clone().multiplyScalar(0.85);
      col.hot = accent.clone();
    }
    pointMats.forEach((m) => {
      m.uniforms.uDim.value.copy(col.dim);
      m.uniforms.uHot.value.copy(col.hot);
      m.uniforms.uLight.value = isLight ? 1 : 0;
    });
    if (skeletonMat) skeletonMat.color.copy(col.dim);
    if (hullMat) hullMat.color.copy(col.mid);
    if (edgeMat) edgeMat.color.copy(col.hot);
  }
  const pointMats = [];

  // ── Point shader ─────────────────────────────
  //  aTone 0..1 → dim → hot. aAct is live activation (graph nodes).
  function makePointMat(extra = {}) {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uForm: { value: 0 },
        uCursor: { value: new THREE.Vector3(999, 999, 999) },
        uStrength: { value: 0 }, uRadius: { value: 3.0 },
        uSize: { value: 1 }, uOpacity: { value: 1 },
        uDim: { value: new THREE.Color(1, 1, 1) },
        uHot: { value: new THREE.Color(0, 1, 0.8) },
        uLight: { value: 0 }, uPR: { value: renderer.getPixelRatio() },
        ...extra,
      },
      vertexShader: `
        attribute vec3 aHome; attribute vec3 aScatter;
        attribute float aSeed; attribute float aTone; attribute float aSizeM; attribute float aAct;
        uniform float uTime, uForm, uStrength, uRadius, uSize, uPR;
        uniform vec3 uCursor;
        varying float vTone; varying float vAct; varying float vFade;
        void main(){
          // staggered assembly with a small overshoot, then settle
          float d  = aSeed * 0.5;
          float ft = clamp((uForm - d) / max(0.0001, 1.0 - d), 0.0, 1.0);
          float e  = 1.0 - pow(1.0 - ft, 3.0);
          vec3 p = mix(aScatter, aHome, e);
          p += normalize(aHome + 0.001) * sin(ft * 3.14159) * 0.12 * (1.0 - uForm);

          // very slow structural breathing
          p *= 1.0 + sin(uTime * 0.38 + aSeed * 2.0) * 0.008;
          p += vec3(sin(uTime*0.5 + aSeed*17.0), sin(uTime*0.43 + aSeed*29.0), sin(uTime*0.57 + aSeed*11.0)) * 0.014;

          // restrained cursor field — eases to zero, so home is always restored
          vec3 toC = p - uCursor;
          float dc = length(toC);
          float infl = 1.0 - smoothstep(0.0, uRadius, dc);
          p += normalize(toC + 0.0001) * infl * infl * uStrength;

          vTone = aTone; vAct = aAct;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * aSizeM * uPR * (150.0 / max(1.0, -mv.z)) * (1.0 + aAct * 0.9);
          vFade = clamp(uForm * 1.5, 0.0, 1.0);
        }`,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uDim, uHot; uniform float uOpacity, uLight;
        varying float vTone; varying float vAct; varying float vFade;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.08, d);
          vec3 colr = mix(uDim, uHot, clamp(vTone + vAct * 0.7, 0.0, 1.0));
          // Glow is reserved for genuinely active elements. Applying it
          // broadly made structural dust read as bright as graph nodes.
          float glow = uLight > 0.5 ? a : a + pow(a, 3.0) * (0.12 + vAct * 0.85);
          // Steep tone curve so the 87% structural band stays quiet and
          // the few focal nodes clearly dominate.
          float weight = 0.26 + vTone * 0.52 + vAct * 0.55;
          gl_FragColor = vec4(colr, glow * uOpacity * vFade * weight);
        }`,
    });
    pointMats.push(m);
    return m;
  }

  // Build a Points cloud from a sampler that fills {pos,tone,size,seed}
  function buildPoints(count, fill, sizeScale = 1) {
    const pos = new Float32Array(count * 3);
    const tone = new Float32Array(count);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    const act = new Float32Array(count);
    fill({ pos, tone, size, seed, count });

    const scatter = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u), r = 9 + Math.random() * 10;
      scatter[i * 3] = s * Math.cos(th) * r;
      scatter[i * 3 + 1] = u * r * 0.7;
      scatter[i * 3 + 2] = s * Math.sin(th) * r;
      seed[i] = seed[i] || Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    g.setAttribute('aHome', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aTone', new THREE.BufferAttribute(tone, 1));
    g.setAttribute('aSizeM', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAct', new THREE.BufferAttribute(act, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 16);
    const mat = makePointMat();
    mat.uniforms.uSize.value = sizeScale;
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    return { pts, mat, geo: g, home: pos, act };
  }

  /* ────────────────── THE ROBOT ──────────────────
     A bust in 3/4 profile facing left (−X): cranium, face wedge, jaw,
     neck, shoulder yoke, chest, and one arm extended forward with an
     open palm carrying the graph. Particles are sampled on the SURFACE
     of each primitive, so the form reads as a shell with real negative
     space rather than a solid mass. */

  // ── surface samplers ──
  function ellipsoidPt(o, c, r, jit) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const s2 = Math.sqrt(1 - u * u);
    const j = 1 + (Math.random() - 0.5) * jit;
    o.x = c[0] + s2 * Math.cos(th) * r[0] * j;
    o.y = c[1] + u * r[1] * j;
    o.z = c[2] + s2 * Math.sin(th) * r[2] * j;
  }
  const _ax = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _tmpA = new THREE.Vector3();
  function capsulePt(o, a, b, r0, r1, jit) {
    const t = Math.random();
    _ax.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    _tmpA.set(Math.abs(_ax.x) < 0.9 ? 1 : 0, Math.abs(_ax.x) < 0.9 ? 0 : 1, 0);
    _u.crossVectors(_ax, _tmpA).normalize();
    _v.crossVectors(_ax, _u).normalize();
    const th = Math.random() * Math.PI * 2;
    const rr = (r0 + (r1 - r0) * t) * (1 + (Math.random() - 0.5) * jit);
    o.x = a[0] + (b[0] - a[0]) * t + (_u.x * Math.cos(th) + _v.x * Math.sin(th)) * rr;
    o.y = a[1] + (b[1] - a[1]) * t + (_u.y * Math.cos(th) + _v.y * Math.sin(th)) * rr;
    o.z = a[2] + (b[2] - a[2]) * t + (_u.z * Math.cos(th) + _v.z * Math.sin(th)) * rr;
  }
  // flat ring of points (the circular tech details at temple / shoulder)
  function ringPt(o, c, R, thick, axis) {
    const th = Math.random() * Math.PI * 2;
    const rr = R * (1 + (Math.random() - 0.5) * thick);
    if (axis === 'z') { o.x = c[0] + Math.cos(th) * rr; o.y = c[1] + Math.sin(th) * rr; o.z = c[2] + (Math.random() - 0.5) * 0.05; }
    else { o.x = c[0] + (Math.random() - 0.5) * 0.05; o.y = c[1] + Math.sin(th) * rr; o.z = c[2] + Math.cos(th) * rr; }
  }

  // ── anatomy (robot faces −X) ──
  const A = {
    cranium: { c: [0.62, 3.30, 0],    r: [0.82, 0.96, 0.88] },
    face:    { c: [0.20, 3.05, 0],    r: [0.56, 0.72, 0.66] },
    jaw:     { c: [0.30, 2.62, 0],    r: [0.50, 0.36, 0.52] },
    neck:    { a: [0.55, 2.45, 0],  b: [0.60, 1.80, 0],   r0: 0.34, r1: 0.44 },
    yoke:    { c: [0.60, 1.42, 0],    r: [1.85, 0.46, 0.80] },
    chest:   { c: [0.68, 0.40, 0],    r: [1.50, 1.10, 0.78] },
    upArm:   { a: [-0.75, 1.30, 0.42], b: [-1.72, 0.52, 0.80], r0: 0.32, r1: 0.24 },
    foreArm: { a: [-1.72, 0.52, 0.80], b: [-2.52, 0.10, 0.72], r0: 0.24, r1: 0.17 },
    palm:    { c: [-2.80, 0.06, 0.70], r: [0.42, 0.11, 0.34] },
  };

  const robot = buildPoints(BUDGET.robot, ({ pos, tone, size, seed, count }) => {
    const o = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      let tn, sz = 0.5 + Math.random() * 0.2;
      if (r < 0.15)        { ellipsoidPt(o, A.cranium.c, A.cranium.r, 0.06); tn = 0.16; }
      else if (r < 0.24)   { ellipsoidPt(o, A.face.c, A.face.r, 0.05);       tn = 0.22; }
      else if (r < 0.29)   { ellipsoidPt(o, A.jaw.c, A.jaw.r, 0.06);         tn = 0.18; }
      else if (r < 0.34)   { capsulePt(o, A.neck.a, A.neck.b, A.neck.r0, A.neck.r1, 0.10); tn = 0.12; }
      else if (r < 0.50)   { ellipsoidPt(o, A.yoke.c, A.yoke.r, 0.08);       tn = 0.10; }
      else if (r < 0.70)   { ellipsoidPt(o, A.chest.c, A.chest.r, 0.10);     tn = 0.08; }
      else if (r < 0.79)   { capsulePt(o, A.upArm.a, A.upArm.b, A.upArm.r0, A.upArm.r1, 0.10);   tn = 0.14; }
      else if (r < 0.87)   { capsulePt(o, A.foreArm.a, A.foreArm.b, A.foreArm.r0, A.foreArm.r1, 0.10); tn = 0.18; }
      else if (r < 0.92)   { // open palm + splayed fingers
        if (Math.random() < 0.55) { ellipsoidPt(o, A.palm.c, A.palm.r, 0.12); }
        else {
          const fi = (Math.random() * 4) | 0, ft = Math.random();
          const spread = (fi - 1.5) * 0.13;
          o.x = A.palm.c[0] - 0.10 - ft * 0.34;
          o.y = A.palm.c[1] + 0.04 + ft * 0.05;
          o.z = A.palm.c[2] + spread * (0.5 + ft) + (Math.random() - 0.5) * 0.04;
        }
        tn = 0.42; sz = 0.6 + Math.random() * 0.25;
      }
      else if (r < 0.955)  { // circular tech rings — temple + shoulder
        if (Math.random() < 0.55) ringPt(o, [0.72, 3.28, 0.42], 0.40, 0.10, 'x');
        else                      ringPt(o, [1.28, 1.16, 0.20], 0.62, 0.10, 'x');
        tn = 0.72; sz = 0.68 + Math.random() * 0.25;
      }
      else                 { // medium structural accents across the shell
        ellipsoidPt(o, A.chest.c, [A.chest.r[0] * 1.04, A.chest.r[1] * 1.04, A.chest.r[2] * 1.04], 0.14);
        tn = 0.52; sz = 0.85 + Math.random() * 0.3;
      }
      pos[i * 3] = o.x; pos[i * 3 + 1] = o.y; pos[i * 3 + 2] = o.z;
      tone[i] = tn; size[i] = sz; seed[i] = Math.random();
    }
  }, 1.0);
  robotGroup.add(robot.pts);

  // ── dissolve field — particles shedding off the lower body ──
  const dissolve = buildPoints(BUDGET.dissolve, ({ pos, tone, size, seed, count }) => {
    const o = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < count; i++) {
      ellipsoidPt(o, A.chest.c, A.chest.r, 0.1);
      const drop = Math.pow(Math.random(), 1.6);
      pos[i * 3]     = o.x + (Math.random() - 0.5) * 2.6 * drop;
      pos[i * 3 + 1] = o.y - drop * 3.2;
      pos[i * 3 + 2] = o.z + (Math.random() - 0.5) * 2.0 * drop;
      tone[i] = Math.random() * 0.14; size[i] = 0.4 + Math.random() * 0.2; seed[i] = Math.random();
    }
  }, 0.9);
  dissolve.mat.uniforms.uOpacity.value = 0.5;
  robotGroup.add(dissolve.pts);

  // ── contour lines — a few thin structural strokes over the shell ──
  const CONTOURS = [
    [[0.20, 3.62, 0], [0.05, 3.10, 0], [0.28, 2.68, 0], [0.55, 2.42, 0]],
    [[-0.75, 1.30, 0.42], [-1.72, 0.52, 0.80], [-2.52, 0.10, 0.72]],
    [[-1.32, 1.40, 0.30], [0.60, 1.62, 0], [1.95, 1.30, -0.1]],
    [[0.60, 1.80, 0], [0.68, 0.55, 0]],
  ];
  const contourVerts = [];
  CONTOURS.forEach((path) => {
    for (let i = 0; i < path.length - 1; i++) contourVerts.push(...path[i], ...path[i + 1]);
  });
  const skelGeo = new THREE.BufferGeometry();
  skelGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(contourVerts), 3));
  const skeletonMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.14, depthWrite: false });
  const skeleton = new THREE.LineSegments(skelGeo, skeletonMat);
  skeleton.frustumCulled = false;
  robotGroup.add(skeleton);

  // ── bright focal accents (the ~2% band): eye, ring cores, palm centre ──
  const ACCENTS = [
    [0.06, 3.14, 0.30], [0.72, 3.28, 0.42], [1.28, 1.16, 0.20],
    [-2.80, 0.06, 0.70], [-1.72, 0.52, 0.80], [0.60, 1.80, 0],
    [0.68, 0.40, 0], [1.95, 1.28, -0.05],
  ];
  const joints = buildPoints(ACCENTS.length, ({ pos, tone, size, seed, count }) => {
    for (let i = 0; i < count; i++) {
      pos[i * 3] = ACCENTS[i][0]; pos[i * 3 + 1] = ACCENTS[i][1]; pos[i * 3 + 2] = ACCENTS[i][2];
      tone[i] = 1.0; size[i] = 1.25; seed[i] = Math.random();
    }
  }, 1.2);
  robotGroup.add(joints.pts);

  /* ────────────────── THE GRAPH ──────────────────
     An icosahedral wireframe suspended above the open palm — the
     computational model the robot is holding. Bright, small, and the
     clear focal point of the composition. */

  const hullGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(CUBE_R, 0));
  const hullMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
  const hull = new THREE.LineSegments(hullGeo, hullMat);
  hull.frustumCulled = false;
  cubeGroup.add(hull);

  // Graph nodes — clustered, a few escaping the hull
  const NG = BUDGET.graphNodes;
  const CLUSTERS = 4;
  const nodes = [];
  // The 12 icosahedron vertices — graph nodes sit ON the wireframe
  // corners (as in the reference) rather than floating unrelated to it.
  const ICO_V = (() => {
    const g = new THREE.IcosahedronGeometry(CUBE_R, 0).getAttribute('position');
    const seen = new Set(), out = [];
    for (let i = 0; i < g.count; i++) {
      const x = +g.getX(i).toFixed(4), y = +g.getY(i).toFixed(4), z = +g.getZ(i).toFixed(4);
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k); out.push(new THREE.Vector3(x, y, z));
    }
    return out;
  })();

  function layoutGraph() {
    nodes.length = 0;
    const centers = [];
    for (let c = 0; c < CLUSTERS; c++) {
      centers.push(new THREE.Vector3(
        (Math.random() - 0.5) * CUBE_R * 1.25,
        (Math.random() - 0.5) * CUBE_R * 1.25,
        (Math.random() - 0.5) * CUBE_R * 1.25,
      ));
    }
    for (let i = 0; i < NG; i++) {
      const ci = i % CLUSTERS;
      const c = centers[ci];
      const escape = Math.random() < 0.10;            // a few nodes break the hull
      const spread = escape ? CUBE_R * 1.5 : CUBE_R * 0.52;
      // First 12 nodes anchor to the wireframe vertices; the rest cluster inside.
      const home = i < ICO_V.length
        ? ICO_V[i].clone().multiplyScalar(0.98)
        : new THREE.Vector3(
            c.x + (Math.random() - 0.5) * spread,
            c.y + (Math.random() - 0.5) * spread,
            c.z + (Math.random() - 0.5) * spread,
          );
      nodes.push({
        cluster: ci,
        home,
        pos: new THREE.Vector3(),
        act: 0,
        neighbors: [],
        seed: Math.random(),
        hub: i < ICO_V.length ? Math.random() < 0.55 : Math.random() < 0.10,
      });
    }
    nodes.forEach((n) => n.pos.copy(n.home));
    // edges: intra-cluster mostly, a few bridges
    nodes.forEach((n, i) => {
      n.neighbors.length = 0;
      nodes.forEach((m, j) => {
        if (i === j) return;
        const d = n.home.distanceTo(m.home);
        const sameCluster = n.cluster === m.cluster;
        if (d < (sameCluster ? CUBE_R * 0.62 : CUBE_R * 0.34)) n.neighbors.push(j);
      });
    });
  }
  layoutGraph();

  // Node points
  const graphPts = buildPoints(NG, ({ pos, tone, size, seed, count }) => {
    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      pos[i * 3] = n.home.x; pos[i * 3 + 1] = n.home.y; pos[i * 3 + 2] = n.home.z;
      tone[i] = n.hub ? 0.95 : 0.62;
      size[i] = n.hub ? 1.35 : 0.95;
      seed[i] = n.seed;
    }
  }, 1.35);
  cubeGroup.add(graphPts.pts);
  const graphHomeAttr = graphPts.geo.getAttribute('aHome');
  const graphActAttr = graphPts.geo.getAttribute('aAct');
  graphPts.mat.uniforms.uRadius.value = 1.9;   // tighter, restrained reaction

  // Graph edges — vertex-coloured so activation lights individual edges
  const MAXE = NG * 6;
  const edgePos = new Float32Array(MAXE * 6);
  const edgeCol = new Float32Array(MAXE * 6);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3));
  edgeGeo.setDrawRange(0, 0);
  const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false, vertexColors: true });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.frustumCulled = false;
  cubeGroup.add(edgeLines);

  // Packets travelling along edges (the bright, meaningful motion)
  const MAXP = 14;
  const packets = [];
  const packetPts = buildPoints(MAXP, ({ pos, tone, size, seed, count }) => {
    for (let i = 0; i < count; i++) {
      pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
      tone[i] = 1; size[i] = 1.25; seed[i] = Math.random();
    }
  }, 1.4);
  cubeGroup.add(packetPts.pts);
  const packetHome = packetPts.geo.getAttribute('aHome');
  const packetAct = packetPts.geo.getAttribute('aAct');

  /* Propagation — adapted from the 21st.dev "neurons hero" model:
     fire() guards on a refractory threshold so a cascade always
     terminates; a pulse bumps its target's activation on arrival. */
  function fire(idx, depth = 0) {
    const n = nodes[idx];
    if (!n || n.act > 0.5 || depth > 2) return;      // refractory guard bounds the cascade
    n.act = 1;
    // Only a couple of neighbours carry the signal onward. Firing every
    // neighbour saturated the packet pool and read as constant noise
    // rather than an occasional propagation.
    const fanout = depth === 0 ? 3 : 2;
    for (let k = 0; k < n.neighbors.length && k < fanout; k++) {
      if (packets.length >= MAXP) return;
      const j = n.neighbors[(k + ((Math.random() * n.neighbors.length) | 0)) % n.neighbors.length];
      packets.push({ from: idx, to: j, t: 0, speed: 0.5 + Math.random() * 0.4, depth });
    }
  }

  // ── Ambient field, ties the rig into the constellation ──
  const ambient = buildPoints(BUDGET.ambient, ({ pos, tone, size, seed, count }) => {
    for (let i = 0; i < count; i++) {
      // hugs the rig — a wide halo would bleed into the headline column
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u), r = 3.4 + Math.random() * 2.6;
      pos[i * 3] = s * Math.cos(th) * r * 0.85;
      pos[i * 3 + 1] = u * r * 0.85 + 0.4;
      pos[i * 3 + 2] = s * Math.sin(th) * r;
      tone[i] = Math.random() * 0.12; size[i] = 0.4 + Math.random() * 0.16; seed[i] = Math.random();
    }
  }, 0.85);
  ambient.mat.uniforms.uOpacity.value = 0.4;
  rig.add(ambient.pts);

  readTheme();
  window.addEventListener('themechange', readTheme);

  // ── Layout: keep the rig in the right ~37% ──
  let W = 1, H = 1;
  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();

    // world units visible at z=0
    const visH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI / 180) / 2);
    const visW = visH * camera.aspect;

    // The bust is deliberately large — as in the reference it owns the
    // right half — but its left edge stays clear of the headline column.
    if (W > 1000) {
      rig.position.x = visW * 0.245;
      rig.scale.setScalar(1.42);
      rig.position.y = -1.15;
    } else if (W > 700) {
      rig.position.x = visW * 0.21;
      rig.scale.setScalar(1.02);
      rig.position.y = -0.6;
    } else {
      rig.position.x = visW * 0.14;      // still right-of-centre on phones
      rig.scale.setScalar(0.62);
      rig.position.y = 0.6;
    }
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Pointer ──────────────────────────────────
  const ndc = new THREE.Vector2(-10, -10);
  const localCursor = new THREE.Vector3(999, 999, 999);   // rig space
  const cubeCursor = new THREE.Vector3(999, 999, 999);    // cube space
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ray = new THREE.Raycaster();
  const hitPoint = new THREE.Vector3();
  let pointerInside = false, lastX = -999, lastY = -999;
  let strength = 0, strengthTarget = 0;
  let recompute = 0, recomputeT = -1, recomputeDone = false, lastRebuild = -1e9;
  let cubeTilt = new THREE.Vector2(0, 0), cubeTiltTarget = new THREE.Vector2(0, 0);

  function updatePointer(cx, cy) {
    lastX = cx; lastY = cy;
    const r = host.getBoundingClientRect();
    pointerInside = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    if (!pointerInside) return;
    ndc.x = ((cx - r.left) / r.width) * 2 - 1;
    ndc.y = -((cy - r.top) / r.height) * 2 + 1;
  }
  window.addEventListener('mousemove', (e) => updatePointer(e.clientX, e.clientY), { passive: true });
  window.addEventListener('mouseleave', () => { pointerInside = false; }, { passive: true });

  // Projected cube position — hit target for hover + click
  const tmpV = new THREE.Vector3();
  function cubeScreen() {
    tmpV.set(0, 0, 0).applyMatrix4(cubeGroup.matrixWorld).project(camera);
    const r = host.getBoundingClientRect();
    return {
      x: r.left + (tmpV.x * 0.5 + 0.5) * r.width,
      y: r.top + (-tmpV.y * 0.5 + 0.5) * r.height,
      radius: Math.min(r.width, r.height) * 0.115 * rig.scale.x,
    };
  }

  function triggerRecompute() {
    const now = performance.now();
    if (now - lastRebuild < 2600) return;      // cooldown, spam-safe
    lastRebuild = now;
    recomputeT = 0;
    document.dispatchEvent(new CustomEvent('core:rebuild'));
  }
  window.addEventListener('click', (e) => {
    if (reduced) return;
    const c = cubeScreen();
    if (Math.hypot(e.clientX - c.x, e.clientY - c.y) <= c.radius) triggerRecompute();
  });

  let wasOver = false;
  function updateHover() {
    const c = cubeScreen();
    const over = pointerInside && Math.hypot(lastX - c.x, lastY - c.y) <= c.radius;
    if (over !== wasOver) {
      wasOver = over;
      document.dispatchEvent(new CustomEvent('core:hover', { detail: { over } }));
    }
    return over;
  }

  // ── Constellation hand-off: anchors are the CUBE, so background
  //    lines visibly converge on the graph rather than on dust. ──
  window.__coreAnchors = [];
  const anchorNodeIdx = [];
  for (let i = 0; i < Math.min(10, NG); i++) anchorNodeIdx.push((i * 7) % NG);

  // ── Scroll ───────────────────────────────────
  let scrollP = 0;
  function onScroll() {
    const hero = host.closest('section') || host.parentElement;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    scrollP = THREE.MathUtils.clamp(-r.top / Math.max(1, r.height), 0, 1);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Assembly ─────────────────────────────────
  let form = 0, formTarget = 0, started = false;
  function boot() {
    if (started) return;
    started = true;
    if (reduced) { form = formTarget = 1; return; }
    formTarget = 1;
  }

  let onScreen = true;
  new IntersectionObserver((es) => es.forEach((e) => { onScreen = e.isIntersecting; }), { threshold: 0.01 })
    .observe(host);

  // Sub-phase helper: assembly reads as skeleton → cube → graph
  const phase = (a, b) => THREE.MathUtils.clamp((form - a) / (b - a), 0, 1);

  function syncUniforms(t, fade, over) {
    pointMats.forEach((m) => {
      m.uniforms.uTime.value = t;
      m.uniforms.uForm.value = form;
      m.uniforms.uStrength.value = strength;
      m.uniforms.uPR.value = renderer.getPixelRatio();
    });
    robot.mat.uniforms.uCursor.value.copy(localCursor);
    dissolve.mat.uniforms.uCursor.value.copy(localCursor);
    joints.mat.uniforms.uCursor.value.copy(localCursor);
    ambient.mat.uniforms.uCursor.value.copy(localCursor);
    graphPts.mat.uniforms.uCursor.value.copy(cubeCursor);
    packetPts.mat.uniforms.uCursor.value.set(999, 999, 999);

    // Assembly order: shell → contours → arm/accents → graph hull → graph → packets
    robot.mat.uniforms.uOpacity.value    = fade * 0.92 * phase(0.05, 0.5);
    dissolve.mat.uniforms.uOpacity.value = fade * 0.42 * phase(0.15, 0.62);
    joints.mat.uniforms.uOpacity.value   = fade * phase(0.2, 0.6);
    ambient.mat.uniforms.uOpacity.value  = fade * 0.28;
    graphPts.mat.uniforms.uOpacity.value = fade * phase(0.62, 0.95);
    packetPts.mat.uniforms.uOpacity.value = fade * phase(0.78, 1) * (1 - recompute * 0.4);
    skeletonMat.opacity = (isLight ? 0.22 : 0.14) * fade * phase(0.25, 0.65);
    hullMat.opacity     = (isLight ? 0.62 : 0.55) * fade * phase(0.55, 0.88) * (1 + recompute * 0.4);
    edgeMat.opacity     = (isLight ? 0.6 : 0.52) * fade * phase(0.72, 1) * (1 - recompute * 0.6);
  }

  // ── Frame ────────────────────────────────────
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsN = 0, degraded = false, nextIdleFire = 1.5, hoverFireCd = 0;

  function frame() {
    requestAnimationFrame(frame);
    if (!onScreen || document.hidden) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    form += (formTarget - form) * (reduced ? 1 : 0.016);
    if (form > 0.999) form = 1;

    const over = updateHover();

    // cursor → rig-local and cube-local space
    if (pointerInside) {
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hitPoint)) {
        rig.worldToLocal(localCursor.copy(hitPoint));
        cubeGroup.worldToLocal(cubeCursor.copy(hitPoint));
      }
      strengthTarget = 0.55;                 // restrained — no chasing
      // cube leans toward the cursor
      const c = cubeScreen();
      cubeTiltTarget.set(
        THREE.MathUtils.clamp((lastY - c.y) / 400, -0.3, 0.3),
        THREE.MathUtils.clamp((lastX - c.x) / 400, -0.3, 0.3),
      );
    } else {
      strengthTarget = 0;
      localCursor.set(999, 999, 999);
      cubeCursor.set(999, 999, 999);
      cubeTiltTarget.set(0, 0);
    }
    strength += (strengthTarget - strength) * 0.055;
    cubeTilt.x += (cubeTiltTarget.x - cubeTilt.x) * 0.05;
    cubeTilt.y += (cubeTiltTarget.y - cubeTilt.y) * 0.05;

    // ── graph activation & propagation ──
    if (form > 0.75) {
      // hovering near the cube fires the closest node → cascade.
      // Rate-limited: without this it re-fires the moment the refractory
      // period lapses, which reads as a constant flicker.
      hoverFireCd -= dt;
      if (over && hoverFireCd <= 0 && cubeCursor.length() < CUBE_R * 2.4) {
        let best = -1, bd = 1e9;
        for (let i = 0; i < NG; i++) {
          const d = nodes[i].pos.distanceTo(cubeCursor);
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0 && bd < CUBE_R * 0.9) { fire(best); hoverFireCd = 0.5; }
      }
      // idle: occasional spontaneous activation so it stays alive
      nextIdleFire -= dt;
      if (nextIdleFire <= 0) {
        fire((Math.random() * NG) | 0);
        nextIdleFire = 2.6 + Math.random() * 4.0;
      }
    }

    // decay + write activation
    for (let i = 0; i < NG; i++) {
      const n = nodes[i];
      if (n.act > 0) n.act = Math.max(0, n.act - dt * 1.05);
      graphActAttr.array[i] = n.act;
    }
    graphActAttr.needsUpdate = true;

    // ── recompute (click) — reorganize, not explode ──
    if (recomputeT >= 0) {
      recomputeT += dt / 1.7;
      // 0→0.45 separate & fade edges, 0.45 relayout, 0.45→1 settle
      recompute = recomputeT < 0.45
        ? recomputeT / 0.45
        : Math.max(0, 1 - (recomputeT - 0.45) / 0.55);
      if (!recomputeDone && recomputeT >= 0.45) {
        recomputeDone = true;
        layoutGraph();                                  // new topology
        for (let i = 0; i < NG; i++) {
          graphHomeAttr.array[i * 3] = nodes[i].home.x;
          graphHomeAttr.array[i * 3 + 1] = nodes[i].home.y;
          graphHomeAttr.array[i * 3 + 2] = nodes[i].home.z;
        }
        graphHomeAttr.needsUpdate = true;
        for (let k = 0; k < 5; k++) fire((Math.random() * NG) | 0);   // packets traverse it
      }
      if (recomputeT >= 1) { recomputeT = -1; recompute = 0; recomputeDone = false; }
    }

    // node live positions: home + cluster separation during recompute
    for (let i = 0; i < NG; i++) {
      const n = nodes[i];
      n.pos.copy(n.home);
      if (recompute > 0) n.pos.multiplyScalar(1 + recompute * 0.42);
    }

    // ── edges ──
    let e = 0;
    for (let i = 0; i < NG && e < MAXE; i++) {
      const n = nodes[i];
      for (let k = 0; k < n.neighbors.length && e < MAXE; k++) {
        const j = n.neighbors[k];
        if (j <= i) continue;
        const m = nodes[j];
        edgePos[e * 6] = n.pos.x; edgePos[e * 6 + 1] = n.pos.y; edgePos[e * 6 + 2] = n.pos.z;
        edgePos[e * 6 + 3] = m.pos.x; edgePos[e * 6 + 4] = m.pos.y; edgePos[e * 6 + 5] = m.pos.z;
        const ea = Math.max(n.act, m.act);
        const c1 = 0.35 + ea * 0.65;
        edgeCol[e * 6] = c1; edgeCol[e * 6 + 1] = c1; edgeCol[e * 6 + 2] = c1;
        edgeCol[e * 6 + 3] = c1; edgeCol[e * 6 + 4] = c1; edgeCol[e * 6 + 5] = c1;
        e++;
      }
    }
    edgeGeo.setDrawRange(0, e * 2);
    edgeGeo.getAttribute('position').needsUpdate = true;
    edgeGeo.getAttribute('color').needsUpdate = true;

    // ── packets ──
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.t += p.speed * dt;
      if (p.t >= 1) {
        const tgt = nodes[p.to];
        if (tgt) { tgt.act = Math.min(1, tgt.act + 0.5); fire(p.to, p.depth + 1); }
        packets.splice(i, 1);
      }
    }
    for (let i = 0; i < MAXP; i++) {
      const p = packets[i];
      if (p) {
        const a = nodes[p.from].pos, b = nodes[p.to].pos;
        packetHome.array[i * 3] = a.x + (b.x - a.x) * p.t;
        packetHome.array[i * 3 + 1] = a.y + (b.y - a.y) * p.t;
        packetHome.array[i * 3 + 2] = a.z + (b.z - a.z) * p.t;
        packetAct.array[i] = 1;
      } else {
        packetAct.array[i] = 0;
        packetHome.array[i * 3 + 1] = 9999;      // park offscreen
      }
    }
    packetHome.needsUpdate = true;
    packetAct.needsUpdate = true;

    // ── idle motion — calm ──
    if (!reduced) {
      rig.rotation.y = Math.sin(t * 0.11) * 0.16 + scrollP * 0.22;
      rig.position.y += (( (W > 700 ? -0.15 : 1.0) - scrollP * 2.0) - rig.position.y) * 0.08;
      cubeGroup.rotation.y += dt * 0.19;                       // slow, steady
      cubeGroup.rotation.x = Math.sin(t * 0.23) * 0.13 + cubeTilt.x;
      cubeGroup.rotation.z = cubeTilt.y * 0.5;
      cubeGroup.position.y = CUBE_POS.y + Math.sin(t * 0.5) * 0.07;
      cubeGroup.scale.setScalar(1 + recompute * 0.14);
    }

    const fade = 1 - THREE.MathUtils.smoothstep(scrollP, 0.3, 0.95);
    syncUniforms(t, fade, over);

    // ── publish cube anchors for the constellation ──
    if (form > 0.55 && fade > 0.05) {
      const rect = host.getBoundingClientRect();
      const out = window.__coreAnchors;
      out.length = 0;
      for (let i = 0; i < anchorNodeIdx.length; i++) {
        const n = nodes[anchorNodeIdx[i]];
        if (!n) continue;
        tmpV.copy(n.pos).applyMatrix4(cubeGroup.matrixWorld).project(camera);
        if (tmpV.z > 1) continue;
        out.push({
          x: rect.left + (tmpV.x * 0.5 + 0.5) * rect.width,
          y: rect.top + (-tmpV.y * 0.5 + 0.5) * rect.height,
          act: n.act,
        });
      }
    } else if (window.__coreAnchors.length) {
      window.__coreAnchors.length = 0;
    }

    renderer.render(scene, camera);

    if (!degraded) {
      fpsAcc += dt; fpsN++;
      if (fpsN >= 90) {
        if (fpsN / fpsAcc < 42) { degraded = true; renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.72)); }
        fpsAcc = 0; fpsN = 0;
      }
    }
  }
  requestAnimationFrame(frame);

  // ── Public surface ───────────────────────────
  window.__computationalCore = {
    boot,
    rebuild: triggerRecompute,
    isOverCore: () => wasOver,
    tier, counts: BUDGET,
    renderOnce: (t = 1) => { syncUniforms(t, 1, false); renderer.render(scene, camera); return renderer.info.render; },
    diagnostics: () => ({
      form, strength, recompute,
      graphNodes: NG, activeNodes: nodes.filter((n) => n.act > 0.05).length,
      packets: packets.length,
      edges: edgeGeo.drawRange.count / 2,
      drawCalls: renderer.info.render.calls,
      points: renderer.info.render.points,
      glError: renderer.getContext().getError(),
    }),
    _setForm: (v) => { form = formTarget = v; },
    _setCursor: (x, y, z, s) => { localCursor.set(x, y, z); cubeCursor.set(x, y, z); strength = s; },
    _fire: (i) => fire(i ?? ((Math.random() * NG) | 0)),
    _cubeScreen: cubeScreen,
    _nodes: () => nodes,
  };

  if (document.readyState === 'complete') setTimeout(boot, 200);
  else window.addEventListener('load', () => setTimeout(boot, 200), { once: true });
}
