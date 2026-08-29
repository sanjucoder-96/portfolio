/* Computational Robot — particle figure + floating graph
   ─────────────────────────────────────────────────────────────
   The humanoid silhouette is NOT invented procedurally. A real rigged
   humanoid mesh (CesiumMan, CC-BY-4.0, Khronos glTF-Sample-Assets) is
   loaded, posed via its skeleton, then its SURFACE is sampled into GPU
   particles. The mesh itself is never added to the scene — only the
   particle representation is ever drawn.

     GLB  →  pose bones  →  linear-blend-skin every vertex
          →  area-weighted triangle sampling
          →  BufferGeometry  →  shader Points

   The graph is a separate object floating above the posed hand.

   The figure is reconstructed DIRECTLY FROM THE REFERENCE IMAGE, not
   posed from a rigged model. Bright pixels inside the figure region are
   importance-sampled into particles; colour comes from the reference's
   own pixels; depth is inferred from how far each pixel sits from the
   silhouette edge, which gives real parallax without inventing a mesh.

   Because the geometry IS the reference, pose, head direction, hand
   position and proportions are inherited exactly rather than approximated.

   Reference: assets/references/hero-ref.png (user-supplied)            */

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

/* boot() does a few hundred ms of unavoidable setup — decode, mask, density,
   per-particle buffers, shader link. Run as one task that is a visible freeze:
   scrolling stops and every other animation on the page stalls until it ends.
   Yielding between phases keeps each task short. MessageChannel rather than
   setTimeout (throttled to 1s in a background tab) or rAF (never fires in one
   at all, which would hang boot outright). */
const yieldToBrowser = (() => {
  if (typeof MessageChannel !== 'function') return () => new Promise((r) => setTimeout(r, 0));
  const ch = new MessageChannel();
  const q = [];
  ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); };
  return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
})();

const host = document.getElementById('core-stage');
if (host) boot(host).catch((e) => console.warn('[robot] disabled:', e.message));

async function boot(host) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* A viewport narrower than any real device means the window has not been
     laid out yet — a background tab, a restoring session. The particle
     budget is a texture size fixed when the simulation is allocated, so
     trusting that measurement locks the lowest density in for the whole
     session even after the window opens to full width. */
  const vwRaw = window.innerWidth || 0;
  const vw = vwRaw >= 320 ? vwRaw : (window.screen && window.screen.width) || 1280;
  const cores = navigator.hardwareConcurrency || 4;
  let tier = vw < 640 ? 'mobile' : vw < 1100 ? 'tablet' : (cores <= 4 ? 'tablet' : 'desktop');
  /* Simulation is texture-backed, so particle count is a texture size.
     256² = 65,536 particles all carrying real position + velocity state. */
  /* Counts are matched to the area each tier actually renders into, not to
     raw device capability. The phone figure occupies roughly a twentieth of
     the desktop figure's area, so carrying the desktop-ish count put ~0.5
     particles per CSS pixel against desktop's 0.10 and the figure read as a
     dense blob instead of a particle field. */
  const BUDGET = {
    desktop: { tex: 180, graphNodes: 10 },   // 32,400 visible
    tablet:  { tex: 148, graphNodes: 9 },    // 21,904
    mobile:  { tex: 80,  graphNodes: 8 },    // 6,400 — see below
  }[tier];
  BUDGET.body = BUDGET.tex * BUDGET.tex;

  // ── renderer ──
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: tier !== 'mobile', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'mobile' ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(0, 0, 16);

  const rig = new THREE.Group();
  const bodyGroup = new THREE.Group();
  const graphGroup = new THREE.Group();
  rig.add(bodyGroup, graphGroup);
  scene.add(rig);

  // ── theme: mostly white/silver, cyan strictly an accent ──
  const col = { body: new THREE.Color(), body2: new THREE.Color(), hi: new THREE.Color(),
                accent: new THREE.Color(), node: new THREE.Color(), edge: new THREE.Color() };
  let isLight = false;
  function rgbVar(n, f) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const p = (v || f).split(',').map((x) => parseFloat(x) / 255);
    return new THREE.Color(p[0], p[1], p[2]);
  }
  const mats = [];
  function readTheme() {
    isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const cy = rgbVar('--rgb-graph', '124,217,192');
    /* Light mode runs its own four-stop ramp: deep petrol body, steel-teal
       mid-tone, a pale-aqua highlight on the brightest particles, and a teal-cyan
       accent. Deliberately low-chroma: a saturated teal read as a heavy
       coloured mass on the light canvas. Muting it keeps the figure reading
       as a graphite-teal sculpture that still belongs to the site's family.
       Dark mode never sees these: there uUseRGB=1, so the body uses the
       sampled reference colour. */
    /* Light blue family. The deepest stop stays dark enough to carry the
       silhouette on the #F5F7FA canvas — lifting every stop would wash the
       figure out now that density is lower — while the mid and highlight
       stops open up into sky blue. */
    col.body   = isLight ? new THREE.Color(0.180, 0.337, 0.467) : new THREE.Color(0.92, 0.93, 0.93);  // #2E5677 deep blue-slate
    col.body2  = isLight ? new THREE.Color(0.380, 0.569, 0.722) : new THREE.Color(0.92, 0.93, 0.93);  // #6191B8 steel blue
    col.hi     = isLight ? new THREE.Color(0.749, 0.851, 0.925) : new THREE.Color(1.00, 1.00, 1.00);  // #BFD9EC pale sky
    col.accent = isLight ? new THREE.Color(0.243, 0.588, 0.800) : cy;                                  // #3E96CC clear blue
    /* Dark mode reads because the body is neutral silver and the graph is
       chromatic teal. In light mode the graph shared the body's slate-teal
       hue, so the two merged. Shifting it to indigo restores the same
       figure/object separation without reaching for orange or pink. */
    /* Body is now blue, so the graph is pushed further round to indigo-violet
       to keep the figure/object separation that dark mode gets for free. */
    col.node   = isLight ? new THREE.Color(0.396, 0.333, 0.769) : cy;                                  // #6555C4 indigo-violet
    col.edge   = isLight ? new THREE.Color(0.729, 0.702, 0.914) : cy;                                  // #BAB3E9
    mats.forEach((m) => {
      m.uniforms.uBody.value.copy(col.body);
      m.uniforms.uAccent.value.copy(col.accent);
      m.uniforms.uLight.value = isLight ? 1 : 0;
    });
    if (edgeMat) edgeMat.color.copy(col.edge);
    if (hullMat) hullMat.color.copy(col.edge);
    // graph nodes sit between the body violet and the pink accent
    if (graphPts) graphPts.mat.uniforms.uAccent.value.copy(col.node);
  }

  /* ── particle shader ──
     aTone: 0 = white/silver body dust, 1 = cyan accent.
     Depth drives size AND opacity, giving atmospheric falloff. */
  function makeMat(extra = {}) {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uForm: { value: 0 },
        uCursor: { value: new THREE.Vector3(999, 999, 999) },
        uStrength: { value: 0 }, uRadius: { value: 1.75 },   // ≈150px at this camera
        uSize: { value: 1 }, uOpacity: { value: 1 },
        uBody: { value: new THREE.Color(1, 1, 1) },
        uAccent: { value: new THREE.Color(0, 1, 0.8) },
        uLight: { value: 0 }, uPR: { value: renderer.getPixelRatio() },
        uNear: { value: 12.0 }, uFar: { value: 22.0 },
        uFadeLo: { value: -99.0 }, uFadeHi: { value: -99.0 },   // soft lower-body crop
        uPalm: { value: new THREE.Vector3(999, 999, 999) },
        uPalmPulse: { value: 0 },
        uRimDrive: { value: 0 },     // 1 = rim-lit surface (the body); 0 = flat-lit (graph)
        uUseRGB: { value: 0 },       // 1 = use the reference's sampled colour (body only)
        ...extra,
      },
      vertexShader: `
        attribute vec3 aHome; attribute vec3 aScatter; attribute vec3 aNormal;
        attribute float aSeed; attribute float aTone; attribute float aSizeM; attribute float aAct; attribute float aLum;
        attribute vec3 aRGB;
        uniform float uTime, uForm, uStrength, uRadius, uSize, uPR, uNear, uFar;
        uniform float uFadeLo, uFadeHi, uPalmPulse;
        uniform vec3 uCursor, uPalm;
        varying float vTone; varying float vAct; varying float vFade; varying float vDepth;
        varying float vRim; varying float vBody; varying float vLum; varying vec3 vRGB;
        void main(){
          vLum = aLum; vRGB = aRGB;
          // staggered assembly, head/torso first (aSeed is region-ordered)
          float d  = aSeed * 0.55;
          float ft = clamp((uForm - d) / max(0.0001, 1.0 - d), 0.0, 1.0);
          float e  = 1.0 - pow(1.0 - ft, 3.0);
          vec3 p = mix(aScatter, aHome, e);

          // barely-there breathing + drift; the figure must feel calm
          p += vec3(sin(uTime*0.33 + aSeed*23.0), sin(uTime*0.29 + aSeed*41.0), sin(uTime*0.37 + aSeed*17.0)) * 0.008;
          p.y += sin(uTime * 0.5) * 0.012;

          // restrained cursor field; eases to zero so home is always restored
          vec3 toC = p - uCursor;
          float dc = length(toC);
          float infl = 1.0 - smoothstep(0.0, uRadius, dc);
          p += normalize(toC + 0.0001) * infl * infl * uStrength;

          vTone = aTone; vAct = aAct;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vDepth = 1.0 - clamp((dist - uNear) / (uFar - uNear), 0.0, 1.0);  // 1 near, 0 far

          /* Rim term. Surface normals perpendicular to the view direction sit
             on the silhouette; normals facing the camera are interior. Driving
             brightness and size from this is what reads as a volumetric scan
             rather than a uniformly-lit mannequin. */
          vec3 nrm = normalize(normalMatrix * aNormal);
          vec3 vdir = normalize(-mv.xyz);
          vRim = pow(1.0 - abs(dot(nrm, vdir)), 1.6);

          // soft crop: the lower body dissolves instead of hard-clipping
          vBody = smoothstep(uFadeLo, uFadeHi, aHome.y);

          // palm answers the graph's pulse, very faintly
          float pd = 1.0 - smoothstep(0.0, 2.4, length(aHome - uPalm));
          vAct = max(vAct, pd * uPalmPulse * 0.55);

          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * aSizeM * uPR * (135.0 / max(1.0, dist))
                       * (0.5 + vDepth * 0.55) * (0.82 + vRim * 0.55) * (1.0 + vAct * 0.8);
          vFade = clamp(uForm * 1.4, 0.0, 1.0);
        }`,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uBody, uAccent; uniform float uOpacity, uLight, uRimDrive, uUseRGB;
        varying float vTone; varying float vAct; varying float vFade; varying float vDepth;
        varying float vRim; varying float vBody; varying float vLum; varying vec3 vRGB;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.16, d);      // tighter core = crisper points
          /* Hue is a placement decision (aTone) plus activity — deliberately
             NOT the rim. Letting rim tint the colour turned the whole body
             cyan, because most of a curved surface reads as near-silhouette. */
          /* Dark mode uses the reference's own pixel colour, so the palette
             matches the source exactly instead of approximating it with a
             theme accent. Light mode falls back to the theme ramp. */
          float cy = clamp(vTone + vAct, 0.0, 1.0);
          vec3 themed = mix(uBody, uAccent, cy);
          // only the body carries sampled colour; the graph stays on-theme
          vec3 colr = mix(themed, vRGB, uUseRGB * (1.0 - uLight));
          colr = mix(colr, uAccent, vAct * 0.6);
          float glow = uLight > 0.5 ? a : a + pow(a, 6.0) * (0.02 + vAct * 0.8);
          float atmo = 0.34 + vDepth * 0.66;
          // Rim drives LUMINANCE only: interior recedes, silhouette catches light.
          // uRimDrive is 0 for the graph/packets so they stay fully lit.
          float rimLum = 0.26 + vRim * 0.92;
          // vLum carries the reference image's own shading
          float lum = (mix(1.0, rimLum, uRimDrive) * (0.28 + vLum * 1.0)) + vAct * 0.5;
          gl_FragColor = vec4(colr, glow * uOpacity * vFade * atmo * lum * vBody);
        }`,
    });
    mats.push(m);
    return m;
  }

  function makePoints(count, fill, sizeScale = 1) {
    const pos = new Float32Array(count * 3), tone = new Float32Array(count);
    const size = new Float32Array(count), seed = new Float32Array(count), act = new Float32Array(count);
    const norm = new Float32Array(count * 3);
    const lum = new Float32Array(count).fill(1);
    const rgb = new Float32Array(count * 3).fill(1);
    for (let i = 0; i < count; i++) norm[i * 3 + 2] = 1;      // default faces camera
    fill({ pos, tone, size, seed, norm, lum, rgb, count });
    const scatter = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const r = 6 + Math.random() * 9;
      scatter[i * 3] = pos[i * 3] + s * Math.cos(th) * r * 0.5;
      scatter[i * 3 + 1] = pos[i * 3 + 1] + u * r * 0.4;
      scatter[i * 3 + 2] = pos[i * 3 + 2] + s * Math.sin(th) * r * 0.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    g.setAttribute('aHome', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aTone', new THREE.BufferAttribute(tone, 1));
    g.setAttribute('aSizeM', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAct', new THREE.BufferAttribute(act, 1));
    g.setAttribute('aNormal', new THREE.BufferAttribute(norm, 3));
    g.setAttribute('aLum', new THREE.BufferAttribute(lum, 1));
    g.setAttribute('aRGB', new THREE.BufferAttribute(rgb, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    const mat = makeMat();
    mat.uniforms.uSize.value = sizeScale;
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    return { pts, mat, geo: g, home: pos };
  }

  /* ────────── load + pose the humanoid scaffold ────────── */
  /* ────────── reference-image reconstruction ────────── */
  /* The reconstruction cannot start until this decodes, so its weight is
     the hero's time-to-first-pixel. The PNG stays as the fallback for
     engines without WebP. */
  const REF = await new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    let fellBack = false;
    im.onload = () => res(im);
    im.onerror = () => {
      if (fellBack) { rej(new Error('reference image failed to load')); return; }
      fellBack = true;
      im.src = 'assets/references/hero-ref.png';
    };
    im.src = 'assets/references/hero-ref.webp';
  });

  await yieldToBrowser();

  const rc = document.createElement('canvas');
  rc.width = REF.naturalWidth; rc.height = REF.naturalHeight;
  const rx = rc.getContext('2d', { willReadFrequently: true });
  rx.drawImage(REF, 0, 0);
  const IW = rc.width, IH = rc.height;
  const IMG = rx.getImageData(0, 0, IW, IH).data;
  await yieldToBrowser();

  /* Regions measured off the reference itself:
       figure   x 0.355–0.930   y 0.077–0.979
       palm     centroid (0.463, 0.564)
       graph    replaced by the live 3D object, so it is masked out here  */
  const FIG = { x0: 0.352, x1: 0.945, y0: 0.055, y1: 0.995 };
  const PALM_N = { x: 0.463, y: 0.564 };
  const GRAPH_N = { x: 0.489, y: 0.447, r: 0.062 };      // normalised to width
  const PANEL = { x0: 0.755, x1: 0.995, y0: 0.72, y1: 0.93 };   // "SYSTEM ONLINE" card
  /* The reference is a full mockup, so its own UI sits inside the figure
     region and would otherwise be sampled as particles — the hackathon card
     and SCROLL cue were rendering as floating text. */
  const EXCLUDE = [
    { x0: 0.300, x1: 0.500, y0: 0.632, y1: 0.910 },   // metric card
    { x0: 0.450, x1: 0.560, y0: 0.875, y1: 0.995 },   // SCROLL cue
    { x0: 0.930, x1: 1.000, y0: 0.000, y1: 1.000 },   // vertical tech text
    /* The reference's own headline and body copy overrun x0.352 — this is
       the source of the stray "is." fragment. The hand only begins at
       y 0.535, so cutting to 0.525 is safe. */
    { x0: 0.280, x1: 0.406, y0: 0.185, y1: 0.525 },   // reference copy overrun
  ];

  const LUM_MIN = 46;
  function lumAt(i) { return Math.max(IMG[i], IMG[i + 1], IMG[i + 2]); }

  // Build the figure mask once
  const mask = new Uint8Array(IW * IH);
  /* Preallocated to the figure box: growing plain arrays to ~70k entries
     reallocated repeatedly during boot, and the brightness CDF built here
     was thrown away unused a few lines below. */
  const CAP = ((((FIG.x1 - FIG.x0) * IW) | 0) + 2) * ((((FIG.y1 - FIG.y0) * IH) | 0) + 2);
  const cand = new Int32Array(CAP);
  let NC = 0;
  const Y0 = (FIG.y0 * IH) | 0, Y1 = (FIG.y1 * IH) | 0;
  for (let y = Y0; y < Y1; y++) {
    if (y > Y0 && (y - Y0) % 256 === 0) await yieldToBrowser();
    const yn = y / IH;
    for (let x = (FIG.x0 * IW) | 0; x < (FIG.x1 * IW) | 0; x++) {
      const xn = x / IW;
      if (xn > PANEL.x0 && xn < PANEL.x1 && yn > PANEL.y0 && yn < PANEL.y1) continue;
      let skip = false;
      for (let e = 0; e < EXCLUDE.length; e++) {
        const E = EXCLUDE[e];
        if (xn > E.x0 && xn < E.x1 && yn > E.y0 && yn < E.y1) { skip = true; break; }
      }
      if (skip) continue;
      const dgx = (xn - GRAPH_N.x), dgy = (yn - GRAPH_N.y) * (IH / IW);
      if (Math.hypot(dgx, dgy) < GRAPH_N.r) continue;    // live graph goes here
      const i = (y * IW + x) * 4;
      const L = lumAt(i);
      if (L < LUM_MIN) continue;
      mask[y * IW + x] = 1;
      cand[NC++] = y * IW + x;
    }
  }

  /* Horizontal run-lengths to the silhouette edge, precomputed in two linear
     passes. Both the sampling weight and the depth estimate ask "how far is
     this pixel from the edge of its mask run"; answering that per lookup
     meant a scan of up to 46px, twice, for every one of ~69k candidates and
     again for every particle. Measured against the scanning form these
     tables produce a bit-identical candidate list and total weight. */
  await yieldToBrowser();

  const SCAN = 46;
  const runL = new Uint8Array(IW * IH);
  const runR = new Uint8Array(IW * IH);
  for (let y = 0; y < IH; y++) {
    const row = y * IW;
    for (let x = 1; x < IW; x++) {
      runL[row + x] = mask[row + x - 1] ? Math.min(SCAN, runL[row + x - 1] + 1) : 0;
    }
    for (let x = IW - 2; x >= 0; x--) {
      runR[row + x] = mask[row + x + 1] ? Math.min(SCAN, runR[row + x + 1] + 1) : 0;
    }
  }
  /* Brightness alone treats an isolated speck the same as a point on the
     body surface, which is what made the figure look exploded. Weighting by
     LOCAL DENSITY (via an integral image of the mask) keeps the silhouette
     dense and lets stray particles thin out into a halo. */
  const DS = 4;                                   // density map downscale
  const DW = Math.ceil(IW / DS), DH = Math.ceil(IH / DS);
  await yieldToBrowser();
  const dens = new Float32Array(DW * DH);
  for (let y = 0; y < IH; y++) {
    const dy = (y / DS) | 0;
    for (let x = 0; x < IW; x++) {
      if (mask[y * IW + x]) dens[dy * DW + ((x / DS) | 0)] += 1;
    }
  }
  const CELL = DS * DS;
  // box-blur the density map so the measure is neighbourhood, not cell
  const dblur = new Float32Array(DW * DH);
  const RAD = 3;
  /* Separable. The 7x7 box is the product of a horizontal and a vertical
     run, and the in-bounds cell count factorises the same way, so this is
     the same number the nested form produced. */
  await yieldToBrowser();
  const dtmp = new Float32Array(DW * DH);
  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      const i0 = x - RAD < 0 ? 0 : x - RAD, i1 = x + RAD >= DW ? DW - 1 : x + RAD;
      let sum = 0;
      for (let i2 = i0; i2 <= i1; i2++) sum += dens[y * DW + i2];
      dtmp[y * DW + x] = sum / (i1 - i0 + 1);
    }
  }
  for (let y = 0; y < DH; y++) {
    const j0 = y - RAD < 0 ? 0 : y - RAD, j1 = y + RAD >= DH ? DH - 1 : y + RAD;
    for (let x = 0; x < DW; x++) {
      let sum = 0;
      for (let j = j0; j <= j1; j++) sum += dtmp[j * DW + x];
      dblur[y * DW + x] = (sum / (j1 - j0 + 1)) / CELL;   // 0..1 occupancy
    }
  }
  function densityAt(px, py) {
    return dblur[((py / DS) | 0) * DW + ((px / DS) | 0)] || 0;
  }
  // rebuild the sampling CDF with density folded in
  /* Both arrays are sized to the candidate count up front. The old form
     ended with Array.prototype.push.apply(weight, kept), which spreads ~70k
     entries as call arguments -- close enough to the engine's argument
     limit that it can throw RangeError outright on a device with less
     stack, and boot() swallows that into a silent "hero never appears". */
  await yieldToBrowser();
  const weight = new Int32Array(NC);
  const cum = new Float64Array(NC);
  let KN = 0, acc = 0;
  for (let k = 0; k < NC; k++) {
    const idx = cand[k];
    const py = (idx / IW) | 0, px = idx - py * IW;
    const L = lumAt(idx * 4);
    const d = densityAt(px, py);
    /* A soft gate, not a multiplier. Multiplying by density starved the
       dim silver surface and over-sampled the bright cyan highlight bands,
       which thinned the silhouette and pushed the whole figure blue. */
    /* Redistribute rather than thin globally. Two multipliers:
       CONTOUR — distance to the silhouette edge. Edge pixels carry the read
       of the figure; deep interior pixels are what made it a solid cloud.
       REGION  — the parts that must stay legible at a glance: head and
       temple/eye, shoulder line, and the presenting hand. */
    const gate = THREE.MathUtils.smoothstep(d, 0.045, 0.20);
    const el = runL[idx], er = runR[idx];
    const ed = (el < er ? el : er) / SCAN;          // 0 = edge, 1 = deep interior
    // Stronger contour/interior differential: the face, temple, neck and
    // torso interiors were filling in solid. Contours keep their weight.
    const contour = 2.10 - ed * 1.75;              // 2.10 at contour → 0.35 in core

    const xn2 = px / IW, yn2 = py / IH;
    let region = 1;
    // Moderated from 1.55/1.22/1.5 — those boosts made the head and shoulder
    // read as filled mass. The contour term now carries the legibility.
    if (xn2 > 0.55 && xn2 < 0.79 && yn2 > 0.05 && yn2 < 0.30) region = 1.22;      // head + temple
    else if (xn2 > 0.58 && xn2 < 0.89 && yn2 > 0.28 && yn2 < 0.48) region = 1.08; // shoulder line
    if (Math.hypot(xn2 - 0.463, (yn2 - 0.564) * (IH / IW)) < 0.09) region = 1.30; // palm + fingers

    const w = gate * Math.pow(L - LUM_MIN + 4, 0.55) * contour * region;
    if (w <= 0.0001) continue;
    acc += w; weight[KN] = idx; cum[KN] = acc; KN++;
  }
  const TOTW = acc;
  function pickPixel() {
    const r = Math.random() * TOTW;
    let lo = 0, hi = KN - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    return weight[lo];
  }

  /* Depth from silhouette distance: a pixel deep inside the body can sit
     anywhere through its thickness, while an edge pixel is pinned near the
     surface. Scanning outward to the mask boundary approximates that. */
  const MAXSCAN = SCAN;
  function edgeDist(px, py) {
    const i = py * IW + px;
    return runL[i] < runR[i] ? runL[i] : runR[i];
  }

  // world mapping — uniform scale so the figure is never distorted
  const visH0 = 2 * camera.position.z * Math.tan((camera.fov * Math.PI / 180) / 2);
  const REF_ASPECT = IW / IH;
  const WORLD_H = visH0;
  const WORLD_W = WORLD_H * REF_ASPECT;
  const toWorldX = (xn) => (xn - 0.5) * WORLD_W;
  const toWorldY = (yn) => (0.5 - yn) * WORLD_H;

  const wrist = new THREE.Vector3(toWorldX(PALM_N.x), toWorldY(PALM_N.y), 0);
  const FIG_H = WORLD_H;

  /* ────────── GPU particle field ──────────
     Every particle carries its own position and velocity in float textures
     that persist across frames. A stateless shader displacement (what this
     used to be) can only ever look like a local zoom: with no memory there
     is no wake, no overshoot, and no independent return. */

  const TEX = BUDGET.tex;
  const N = TEX * TEX;

  // static per-particle data sampled from the reference
  const homeArr = new Float32Array(N * 4);      // xyz home + seed
  const initArr = new Float32Array(N * 4);      // scattered start
  const aTone = new Float32Array(N);
  const aSizeM = new Float32Array(N);
  const aLum = new Float32Array(N);
  const aRGB = new Float32Array(N * 3);
  const aRef = new Float32Array(N * 2);

  await yieldToBrowser();
  for (let i = 0; i < N; i++) {
    if (i > 0 && i % 8192 === 0) await yieldToBrowser();
    const idx = pickPixel();
    const py = (idx / IW) | 0, px = idx - py * IW;
    const xn = (px + Math.random()) / IW, yn = (py + Math.random()) / IH;
    const j = idx * 4;
    const R = IMG[j], G = IMG[j + 1], Bl = IMG[j + 2];
    const L = Math.max(R, G, Bl);

    const depth = edgeDist(px, py) / MAXSCAN;
    const z = (Math.random() * 2 - 1) * depth * WORLD_H * 0.042;

    const hx = toWorldX(xn), hy = toWorldY(yn);
    homeArr[i * 4] = hx; homeArr[i * 4 + 1] = hy; homeArr[i * 4 + 2] = z;
    homeArr[i * 4 + 3] = Math.random();                       // per-particle seed

    /* Intro start positions. Offsetting each particle slightly from its own
       home read as "wiggle into place"; these are seeded into directional
       bands so the field converges from left, right, above, below and depth.
       homeArr is untouched — this only seeds the initial texture. */
    const dseed = Math.random();
    const dist = 5.5 + Math.random() * 6.0;        // world units out
    let ox, oy, oz;
    if (dseed < 0.25)      { ox = -dist;                    oy = (Math.random() - 0.5) * 7; oz = (Math.random() - 0.5) * 3; }
    else if (dseed < 0.50) { ox =  dist;                    oy = (Math.random() - 0.5) * 7; oz = (Math.random() - 0.5) * 3; }
    else if (dseed < 0.70) { ox = (Math.random() - 0.5) * 9; oy =  dist;                    oz = (Math.random() - 0.5) * 3; }
    else if (dseed < 0.90) { ox = (Math.random() - 0.5) * 9; oy = -dist;                    oz = (Math.random() - 0.5) * 3; }
    else {                   const a2 = Math.random() * Math.PI * 2;
                             ox = Math.cos(a2) * dist * 0.8; oy = Math.sin(a2) * dist * 0.8; oz = -3 - Math.random() * 4; }
    initArr[i * 4] = hx + ox;
    initArr[i * 4 + 1] = hy + oy;
    initArr[i * 4 + 2] = z + oz;
    initArr[i * 4 + 3] = 1;

    const cyanness = THREE.MathUtils.clamp((G / Math.max(1, R) - 1.44) * 0.80, 0, 1);
    aTone[i] = cyanness;
    const mx = Math.max(1, L), k = cyanness;
    aRGB[i * 3]     = (R / mx) * k + 0.94 * (1 - k);
    aRGB[i * 3 + 1] = (G / mx) * k + 0.95 * (1 - k);
    aRGB[i * 3 + 2] = (Bl / mx) * k + 0.97 * (1 - k);
    const ln = L / 255;
    aLum[i] = ln;
    /* Tiered rather than a single ramp: a continuous size curve made every
       particle read as the same weight. Larger accents are steered to bright
       edge pixels — contours, temple, shoulder, palm — not scattered. */
    const edgey = 1 - depth;                       // 1 at the silhouette edge
    const accent = Math.random();
    let sz;
    if (accent > 0.95)       sz = (0.58 + ln * 0.34) * (0.55 + edgey * 0.75);   // ~5% accent
    else if (accent > 0.75)  sz = (0.34 + ln * 0.24) * (0.75 + edgey * 0.40);   // ~20% medium
    else                     sz = (0.19 + ln * 0.19) * (0.85 + edgey * 0.25);   // ~75% tiny
    aSizeM[i] = sz;
    aRef[i * 2] = (i % TEX) / TEX + 0.5 / TEX;
    aRef[i * 2 + 1] = ((i / TEX) | 0) / TEX + 0.5 / TEX;
  }

  /* Vertical extent of the reconstructed figure, needed to place it against
     real page elements rather than against the reference's proportions. */
  let HOME_X0 = Infinity, HOME_X1 = -Infinity, HOME_Y0 = Infinity, HOME_Y1 = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = homeArr[i * 4], y = homeArr[i * 4 + 1];
    if (x < HOME_X0) HOME_X0 = x;
    if (x > HOME_X1) HOME_X1 = x;
    if (y < HOME_Y0) HOME_Y0 = y;
    if (y > HOME_Y1) HOME_Y1 = y;
  }

  await yieldToBrowser();
  const gpu = new GPUComputationRenderer(TEX, TEX, renderer);
  const dtPos = gpu.createTexture(), dtVel = gpu.createTexture();
  dtPos.image.data.set(initArr);
  /* Seed a gentle inward velocity. Starting from rest made the intro read as
     "positions interpolating"; giving each particle real momentum toward its
     home makes it read as convergence. Magnitude varies per particle so the
     field does not arrive as one rigid front. */
  const velInit = dtVel.image.data;
  for (let i = 0; i < N; i++) {
    const dx = homeArr[i*4]     - initArr[i*4];
    const dy = homeArr[i*4 + 1] - initArr[i*4 + 1];
    const dz = homeArr[i*4 + 2] - initArr[i*4 + 2];
    const L2 = Math.hypot(dx, dy, dz) || 1;
    const sp = 0.0;   // eased path drives the intro; a seeded velocity fought it
    velInit[i*4]     = (dx / L2) * sp;
    velInit[i*4 + 1] = (dy / L2) * sp;
    velInit[i*4 + 2] = (dz / L2) * sp;
    velInit[i*4 + 3] = 0;
  }

  const homeTex = new THREE.DataTexture(homeArr, TEX, TEX, THREE.RGBAFormat, THREE.FloatType);
  homeTex.needsUpdate = true;
  // spawn positions kept addressable so the intro can be an eased path
  const startArr = new Float32Array(initArr);
  for (let i = 0; i < N; i++) startArr[i * 4 + 3] = homeArr[i * 4 + 3];   // carry the seed
  const startTex = new THREE.DataTexture(startArr, TEX, TEX, THREE.RGBAFormat, THREE.FloatType);
  startTex.needsUpdate = true;

  const velVar = gpu.addVariable('textureVelocity', `
    uniform sampler2D tHome;
    uniform vec3 uCursor; uniform float uForce, uRadius, uSwirl, uSpring, uDamping, uDt, uActive, uIntro;
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec4 posS = texture2D(texturePosition, uv);
      vec4 velS = texture2D(textureVelocity, uv);
      vec4 homeS = texture2D(tHome, uv);
      vec3 pos = posS.xyz, vel = velS.xyz, home = homeS.xyz;
      float seed = homeS.w;

      // spring back to the reference position — home is never written to.
      // uIntro temporarily stiffens the spring so the assembly completes in
      // well under a second despite starting several units away.
      /* No intro spring boost. Using a stiff spring to decelerate particles
         into place always leaves residual velocity at hand-off, and the
         resting spring is underdamped by design (it carries the cursor wake)
         — so the figure rang on arrival. The intro is an eased path in the
         position shader instead; here the base spring just idles. */
      vel += (home - pos) * uSpring * (0.75 + seed * 0.5);

      // cursor field: radial repulsion plus a tangential component so the
      // field swirls around the pointer instead of only pushing outward
      vec3 d = pos - uCursor;
      float dist = length(d);
      float infl = 1.0 - smoothstep(0.0, uRadius, dist);
      if (infl > 0.001 && uActive > 0.5) {
        vec3 rad = normalize(d + 1e-5);
        vec3 tang = normalize(cross(rad, vec3(0.0, 0.0, 1.0)) + 1e-5);
        float k = infl * infl * uForce * (0.6 + seed * 0.8);   // per-particle strength
        vel += rad * k + tang * k * uSwirl;
      }
      /* Damping must follow the spring. Stiffening the intro spring alone
         left the system badly underdamped — critical damping for k≈0.34 is
         near 0.45, not 0.885 — so particles rang wildly instead of arriving.
         Blending toward heavy damping during the intro gives a fast,
         non-oscillatory arrival, then hands back the resting physics. */
      float damp = mix(uDamping, 0.26, uIntro);   // velocity ≈ 0 by hand-off
      vel *= damp;
      gl_FragColor = vec4(vel, 1.0);
    }`, dtVel);

  const posVar = gpu.addVariable('texturePosition', `
    uniform float uDt, uIntro;
    uniform sampler2D tStart, tHomeP;
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec4 posS = texture2D(texturePosition, uv);
      vec3 vel = texture2D(textureVelocity, uv).xyz;
      vec3 simPos = posS.xyz + vel * uDt;

      if (uIntro > 0.0001) {
        vec4 st = texture2D(tStart, uv);
        vec3 home = texture2D(tHomeP, uv).xyz;
        float seed = st.w;
        /* Eased, staggered convergence. easeOutCubic arrives with zero
           velocity, so there is nothing left to oscillate — the cause of the
           "vibrate then settle" on the previous spring-driven intro. */
        // finishes at uIntro ≈ 0.1 rather than exactly 0, so the hand-off to
        // physics happens after every particle is already at rest at home
        float prog = clamp((1.0 - uIntro - seed * 0.18) / 0.72, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - prog, 3.0);
        vec3 introPos = mix(st.xyz, home, e);
        simPos = mix(simPos, introPos, uIntro);
      }
      gl_FragColor = vec4(simPos, posS.w);
    }`, dtPos);

  gpu.setVariableDependencies(velVar, [velVar, posVar]);
  gpu.setVariableDependencies(posVar, [velVar, posVar]);
  const vu = velVar.material.uniforms;
  vu.tHome = { value: homeTex };
  vu.uCursor = { value: new THREE.Vector3(9999, 9999, 9999) };
  /* Equilibrium displacement is force/spring. At 0.42 that was ~7.6 world
     units on an 11-unit figure — an explosion. 0.021 gives ~0.38 units
     (≈30px): a visible local reaction that keeps the silhouette readable. */
  /* Equilibrium displacement is force/spring, so these two set the feel:
     0.016/0.065 ≈ 0.25 world units ≈ 20px typical, with the nearest
     particles reaching ~45px. Damping 0.885 decays a disturbance to 1%
     in ~38 frames (~0.63s) — the wake lifetime — and settles the return
     inside ~0.5s without wobble. */
  vu.uForce = { value: 0.016 };
  vu.uRadius = { value: 1.30 };    // ≈107px at this camera
  vu.uSwirl = { value: 0.62 };
  vu.uSpring = { value: 0.065 };
  vu.uDamping = { value: 0.885 };
  vu.uActive = { value: 0 };
  vu.uIntro = { value: 1 };     // decays over the intro, then 0 forever
  vu.uDt = { value: 1 };
  posVar.material.uniforms.uDt = { value: 1 };
  posVar.material.uniforms.uIntro = { value: 1 };
  posVar.material.uniforms.tStart = { value: startTex };
  posVar.material.uniforms.tHomeP = { value: homeTex };
  const gpuErr = gpu.init();
  if (gpuErr) throw new Error('GPGPU init: ' + gpuErr);

  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  bgeo.setAttribute('aRef', new THREE.BufferAttribute(aRef, 2));
  bgeo.setAttribute('aTone', new THREE.BufferAttribute(aTone, 1));
  bgeo.setAttribute('aSizeM', new THREE.BufferAttribute(aSizeM, 1));
  bgeo.setAttribute('aLum', new THREE.BufferAttribute(aLum, 1));
  bgeo.setAttribute('aRGB', new THREE.BufferAttribute(aRGB, 3));
  bgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);

  const bodyMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      tPos: { value: null }, tVel: { value: null },
      uOpacity: { value: 1 }, uPtScale: { value: 1 }, uDesat: { value: 0 }, uPR: { value: renderer.getPixelRatio() },
      uBody: { value: new THREE.Color(1, 1, 1) },
      uBody2: { value: new THREE.Color(1, 1, 1) },
      uHi: { value: new THREE.Color(1, 1, 1) },
      uAccent: { value: new THREE.Color(0, 1, 0.8) },
      uLight: { value: 0 }, uForm: { value: 0 },
      uNear: { value: 12.0 }, uFar: { value: 22.0 },
    },
    vertexShader: `
      attribute vec2 aRef; attribute float aTone, aSizeM, aLum; attribute vec3 aRGB;
      uniform sampler2D tPos, tVel;
      uniform float uPR, uNear, uFar, uForm, uPtScale;
      varying float vTone, vLum, vDepth, vSpeed; varying vec3 vRGB;
      void main(){
        vec3 p = texture2D(tPos, aRef).xyz;
        vec3 v = texture2D(tVel, aRef).xyz;
        vSpeed = clamp(length(v) * 5.0, 0.0, 1.0);   // motion lights particles up
        vTone = aTone; vLum = aLum; vRGB = aRGB;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        vDepth = 1.0 - clamp((dist - uNear) / (uFar - uNear), 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSizeM * uPtScale * uPR * (135.0 / max(1.0, dist)) * (0.55 + vDepth * 0.5) * (1.0 + vSpeed * 0.7);
      }`,
    fragmentShader: `
      precision mediump float;
      uniform vec3 uBody, uBody2, uHi, uAccent; uniform float uOpacity, uLight, uForm, uDesat;
      varying float vTone, vLum, vDepth, vSpeed; varying vec3 vRGB;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.16, d);
        float cy = clamp(vTone + vSpeed * 0.45, 0.0, 1.0);       // cyan rises where it moves
        // luminance lifts primary → secondary, then tone carries it to accent,
        // so the light-mode figure has real internal variation
        /* Bulk stays deep petrol → steel teal; the pale highlight and cyan
           accent are reserved for the brightest particles and the accent
           band, so the figure keeps depth instead of flattening to one tone. */
        vec3 base = mix(uBody, uBody2, smoothstep(0.05, 0.66, vLum));
        base = mix(base, uHi, smoothstep(0.78, 1.0, vLum) * 0.62);
        vec3 themed = mix(base, uAccent, cy * 0.52);   // less of the figure reaches full accent
        vec3 colr = mix(vRGB, themed, uLight);
        colr = mix(colr, uAccent, vSpeed * 0.5);
        // pull chroma out toward the particle's own luminance
        // (identifiers beginning with gl_ are reserved in GLSL — naming this
        //  gl_ silently failed shader compilation and blanked the field)
        float lumaOut = dot(colr, vec3(0.2126, 0.7152, 0.0722));
        colr = mix(colr, vec3(lumaOut), uDesat);
        float glow = uLight > 0.5 ? a : a + pow(a, 6.0) * (0.02 + vSpeed * 0.5);
        float atmo = 0.34 + vDepth * 0.66;
        float lum = (0.30 + vLum * 1.0) + vSpeed * 0.4;
        gl_FragColor = vec4(colr, glow * uOpacity * atmo * lum * clamp(uForm * 1.4, 0.0, 1.0));
      }`,
  });
  const body = { pts: new THREE.Points(bgeo, bodyMat), mat: bodyMat, gpu, velU: vu };
  body.pts.frustumCulled = false;
  bodyGroup.add(body.pts);

  /* ────────── the floating graph ────────── */
  const GR = FIG_H * 0.058;                             // ~9% of figure height
  const GRAPH_PHONE = 1.9;      // cube enlargement on phones, tuned by measurement
  /* resize() owns the resting size; the frame loop multiplies its recompute
     pulse on top. Setting the scale outright in either place loses the other. */
  let graphBase = 1;
  // Sit the graph just above the open palm — GR*3.4 put it ~260px clear of
  // the hand, which broke the 'presenting a model' read entirely.
  const GRAPH_HOME = new THREE.Vector3(wrist.x - GR * 0.20, wrist.y + GR * 1.30, wrist.z + 0.20);
  graphGroup.position.copy(GRAPH_HOME);

  const NG = BUDGET.graphNodes;
  const nodes = [];
  const ICO = (() => {
    const g = new THREE.IcosahedronGeometry(GR, 0).getAttribute('position');
    const seen = new Set(), out = [];
    for (let i = 0; i < g.count; i++) {
      const k = `${g.getX(i).toFixed(4)},${g.getY(i).toFixed(4)},${g.getZ(i).toFixed(4)}`;
      if (seen.has(k)) continue; seen.add(k);
      out.push(new THREE.Vector3(g.getX(i), g.getY(i), g.getZ(i)));
    }
    return out;
  })();
  function layoutGraph() {
    nodes.length = 0;
    for (let i = 0; i < NG; i++) {
      const home = i < ICO.length
        ? ICO[i].clone()
        : new THREE.Vector3((Math.random() - 0.5) * GR * 1.1, (Math.random() - 0.5) * GR * 1.1, (Math.random() - 0.5) * GR * 1.1);
      nodes.push({ home, pos: home.clone(), act: 0, neighbors: [], hub: i < ICO.length,
                   phase: Math.random() * Math.PI * 2, rate: 0.5 + Math.random() * 0.9 });
    }
    nodes.forEach((n, i) => {
      n.neighbors.length = 0;
      // varied edge lengths — a uniform radius made it read as a solid shell
      nodes.forEach((m, j) => { if (i !== j && n.home.distanceTo(m.home) < GR * (0.95 + (i % 3) * 0.28)) n.neighbors.push(j); });
    });
  }
  layoutGraph();

  const graphPts = makePoints(NG, ({ pos, tone, size, seed, count }) => {
    for (let i = 0; i < count; i++) {
      pos[i * 3] = nodes[i].home.x; pos[i * 3 + 1] = nodes[i].home.y; pos[i * 3 + 2] = nodes[i].home.z;
      tone[i] = 1; size[i] = nodes[i].hub ? 1.5 : 1.0; seed[i] = 0.8 + Math.random() * 0.2;
    }
  }, 1.25);
  graphGroup.add(graphPts.pts);
  const gAct = graphPts.geo.getAttribute('aAct');
  const gHome = graphPts.geo.getAttribute('aHome');
  graphPts.mat.uniforms.uRadius.value = GR * 2.2;

  const hullGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(GR, 0));
  const hullMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.34, depthWrite: false });
  const hull = new THREE.LineSegments(hullGeo, hullMat);
  hull.frustumCulled = false;
  graphGroup.add(hull);

  const MAXE = NG * 5;
  const ePos = new Float32Array(MAXE * 6), eCol = new Float32Array(MAXE * 6);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
  edgeGeo.setDrawRange(0, 0);
  const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, vertexColors: true });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.frustumCulled = false;
  graphGroup.add(edges);

  // packets — adapted from the 21st.dev "neurons hero" refractory model
  const MAXP = 10, packets = [];
  const packetPts = makePoints(MAXP, ({ pos, tone, size, seed }) => {
    for (let i = 0; i < MAXP; i++) { pos[i * 3 + 1] = 9999; tone[i] = 1; size[i] = 1.3; seed[i] = 1; }
  }, 1.4);
  graphGroup.add(packetPts.pts);
  const pHome = packetPts.geo.getAttribute('aHome'), pAct = packetPts.geo.getAttribute('aAct');

  function fire(i, depth = 0) {
    const n = nodes[i];
    if (!n || n.act > 0.5 || depth > 2) return;
    n.act = 1;
    const fan = depth === 0 ? 2 : 1;
    for (let k = 0; k < n.neighbors.length && k < fan; k++) {
      if (packets.length >= MAXP) return;
      packets.push({ from: i, to: n.neighbors[(k + ((Math.random() * n.neighbors.length) | 0)) % n.neighbors.length], t: 0, speed: 0.6 + Math.random() * 0.4, depth });
    }
  }

  readTheme();
  window.addEventListener('themechange', readTheme);

  /* ────────── layout ────────── */
  const BASE_YAW = 0;   // reconstruction is a projection: any yaw would skew it
  let W = 1, H = 1;
  // fx/fy are fractions of the visible world extent; s is the rig scale
  /* The reconstruction is authored in world units sized to the reference's
     own aspect, so framing is a fit — not a set of tuned offsets. On screens
     wider than the reference the right edges are aligned, which is what puts
     the figure hard right exactly as in the source. */
  /* Rows of the hero occupied by text, then the largest size and the
     vertical position that keep the figure off them. Ties break downward,
     which keeps the presenting hand low in the frame the way the reference
     has it. Full size rarely clears the CTA row on a phone, so a slightly
     smaller fit that sits completely clear beats a bigger one with a button
     sitting on the shoulder. */
  function mobileFit(sc0, visH, visW, fallbackY) {
    const heroEl = host.closest('section') || host.parentElement;
    if (!heroEl) return null;
    const hero = heroEl.getBoundingClientRect();
    const hw = Math.round(hero.width), hh = Math.round(hero.height);
    if (hw < 2 || hh < 2) return null;

    const rows = new Int32Array(hh + 1);
    /* Collected once at full width — the column narrows with scale, so the
       widest candidate is the safe bound and the cost is a slight
       overestimate for the smaller ones. */
    const colX0 = Math.round(hw * (0.5 + HOME_X0 * sc0 / visW));
    const colX1 = Math.round(hw * (0.5 + HOME_X1 * sc0 / visW));
    const walker = document.createTreeWalker(heroEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.trim()) continue;
      const p = node.parentElement;
      if (!p || p.closest('#core-stage')) continue;
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const rg = document.createRange();
      rg.selectNodeContents(node);
      const boxes = rg.getClientRects();
      for (let i = 0; i < boxes.length; i++) {
        const r = boxes[i];
        if (r.width < 3 || r.height < 3) continue;
        const bx0 = Math.max(colX0, Math.round(r.left - hero.left));
        const bx1 = Math.min(colX1, Math.round(r.right - hero.left));
        if (bx1 <= bx0) continue;                   // outside the figure's column
        const by0 = Math.max(0, Math.round(r.top - hero.top));
        const by1 = Math.min(hh, Math.round(r.bottom - hero.top));
        for (let y = by0; y < by1; y++) rows[y] += bx1 - bx0;
      }
    }
    const pre = new Int32Array(hh + 1);
    for (let y = 0; y < hh; y++) pre[y + 1] = pre[y] + rows[y];

    /* Grow as well as shrink. The width fit is driven by the reference's
       1.5:1 frame, but the figure only occupies the middle of that frame, so
       on a portrait phone it lands far smaller than the column can carry.
       Nothing above the current size clears the copy outright, and holding
       out for zero overlap kept shrinking it, so allow a small budget: the
       largest size whose bounding box covers no more than TOL of itself in
       text. The figure's own ink fills under a third of that box, so the
       overlap actually seen is a fraction of the budget. */
    /* TOL is measured against the home-extent box, which is wider than the
       ink the figure actually paints, so the true overlap runs well under
       this number. Calibrated against rendered pixels, not derived. */
    const TOL = 0.02;
    let fit = null;
    for (const k of [1.3, 1.2, 1.1, 1, 0.9, 0.8]) {
      const sc = sc0 * k;
      const figH = Math.round((HOME_Y1 - HOME_Y0) * sc / visH * hh);
      const figW = Math.round((HOME_X1 - HOME_X0) * sc / visW * hw);
      if (figH < 8 || figH >= hh) continue;
      if (figW > hw * 0.92) continue;              // keep it inside the column
      let bestTop = -1, bestCost = Infinity;
      for (let top = 0; top + figH <= hh; top++) {
        const cost = pre[top + figH] - pre[top];
        if (cost <= bestCost) { bestCost = cost; bestTop = top; }  // ties go lower
      }
      if (bestTop < 0) continue;
      // screenY(wy) = hh * (0.5 - (wy * sc + py) / visH); solve for the figure top
      const py = visH * (0.5 - bestTop / hh) - HOME_Y1 * sc;
      const frac = bestCost / (figW * figH);
      if (!fit || frac < fit.frac) fit = { scale: sc, py, frac };
      if (frac <= TOL) break;                       // biggest acceptable fit wins
    }
    return fit || { scale: sc0, py: fallbackY, frac: 1 };
  }

  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const visH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI / 180) / 2);
    const visW = visH * camera.aspect;
    const sc = Math.min(1, visW / WORLD_W);
    rig.scale.setScalar(sc);
    rig.rotation.y = BASE_YAW;

    /* Drop the rig clear of the fixed nav. The reference's figure starts at
       y 0.055, which lands its crown at ~67px — exactly where the nav bar
       ends — so the head was being cut by the ribbon. Derived from the nav's
       measured height so it still holds if that bar changes. */
    const navEl = document.querySelector('.nav') || document.querySelector('header');
    const navH = navEl ? navEl.getBoundingClientRect().height : 64;
    const currentTopPx = 0.075 * H;              // measured crown position
    const targetTopPx = navH + 42;               // clearance below the ribbon
    const shiftPx = Math.max(0, targetTopPx - currentTopPx);
    let py = -(shiftPx / H) * visH;

    /* Phones stack the copy across the full width, so the horizontal mask
       that keeps particles off the text on wider screens has nothing to bite
       on — the fit centres the figure and it sat on top of the body
       paragraph. Slide it vertically to the emptiest row instead. Only the
       offset changes: same fit, same scale, same geometry, and the column it
       occupies is left alone so the composition still reads right-of-centre.
       Measured from the live layout rather than a tuned constant, so it
       still holds when the copy rewraps. */
    /* The cube rides inside the rig, so shrinking the figure shrinks it too
       — on a phone its 8 nodes collapsed into a single clump a few pixels
       across. Give it back roughly the share of the figure it holds on the
       desktop composition. */
    if (W < 700) {
      const fit = mobileFit(sc, visH, visW, py);
      if (fit) { rig.scale.setScalar(fit.scale); py = fit.py; }
      graphBase = GRAPH_PHONE;
      /* Scaling happens about the cube's own centre, so a bigger cube grows
         down into the palm it is supposed to float above. Lift it by what it
         gained on the way down. */
      graphGroup.position.set(GRAPH_HOME.x,
                              GRAPH_HOME.y + GR * (GRAPH_PHONE - 1) * 0.95,
                              GRAPH_HOME.z);
    } else {
      graphBase = 1;
      graphGroup.position.copy(GRAPH_HOME);
    }
    graphGroup.scale.setScalar(graphBase);
    rig.position.set(visW > WORLD_W ? (visW - WORLD_W) * 0.5 : 0, py, 0);
  }
  resize();
  window.addEventListener('resize', resize);
  /* One boot-time measurement is not enough. If the hero is laid out after
     this module runs -- a page opened in a background tab, a restored
     session, a late web font -- the canvas keeps a stale, sometimes
     near-zero backing store and the figure never appears, with no window
     resize event to correct it. */
  if (typeof ResizeObserver === 'function') {
    let lastW = 0, lastH = 0;
    new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w < 2 || h < 2) return;                  // collapsed layout: wait
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      resize();
    }).observe(host);
  }

  /* ────────── interaction ────────── */
  const ndc = new THREE.Vector2(-10, -10);
  const bodyCursor = new THREE.Vector3(999, 999, 999), graphCursor = new THREE.Vector3(999, 999, 999);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ray = new THREE.Raycaster(), hit = new THREE.Vector3();
  let inside = false, lastX = -999, lastY = -999;
  let strength = 0, strengthTarget = 0, tilt = new THREE.Vector2(), tiltTarget = new THREE.Vector2();
  let recompute = 0, recomputeT = -1, recomputeDone = false, lastRebuild = -1e9;
  let hoverCd = 0, nextIdle = 2.0, wasOver = false, palmPulse = 0, palmCd = 0;
  // soft crop band: everything below the hip dissolves rather than clipping
  /* No synthetic body fade: the reference already dissolves the figure at
     the bottom, and that dissolve is now part of the sampled data. The old
     waist band culled everything below the image midline — including the
     entire presenting arm. */
  const FADE_LO = -1e6, FADE_HI = -1e6 + 1;

  window.addEventListener('mousemove', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    const r = host.getBoundingClientRect();
    inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) return;
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }, { passive: true });
  window.addEventListener('mouseleave', () => { inside = false; }, { passive: true });

  const _p = new THREE.Vector3();
  function graphScreen() {
    _p.set(0, 0, 0).applyMatrix4(graphGroup.matrixWorld).project(camera);
    const r = host.getBoundingClientRect();
    return {
      x: r.left + (_p.x * 0.5 + 0.5) * r.width,
      y: r.top + (-_p.y * 0.5 + 0.5) * r.height,
      radius: Math.min(r.width, r.height) * 0.10 * rig.scale.x,
    };
  }
  function triggerRecompute() {
    const now = performance.now();
    if (now - lastRebuild < 2600) return;
    lastRebuild = now; recomputeT = 0;
    document.dispatchEvent(new CustomEvent('core:rebuild'));
  }
  window.addEventListener('click', (e) => {
    if (reduced) return;
    const g = graphScreen();
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= g.radius) triggerRecompute();
  });

  let scrollP = 0;
  window.addEventListener('scroll', () => {
    const hero = host.closest('section') || host.parentElement;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    scrollP = THREE.MathUtils.clamp(-r.top / Math.max(1, r.height), 0, 1);
  }, { passive: true });

  let form = 0, formTarget = 0, started = false;
  /* The stage is opacity:0 until .is-live, so this class is what actually
     makes the hero visible. It used to be added only by motion.js, which
     polls for this module and gives up after a fixed number of tries — on a
     slow connection boot finished after that deadline and the figure stayed
     invisible for the whole session. The module owns its own reveal now. */
  function start() {
    if (started) return;
    started = true;
    host.classList.add('is-live');
    formTarget = 1;
    if (reduced) form = 1;
  }

  let onScreen = true;
  new IntersectionObserver((es) => es.forEach((e) => { onScreen = e.isIntersecting; }), { threshold: 0.01 }).observe(host);

  function sync(t, fade, over) {
    mats.forEach((m) => {
      m.uniforms.uTime.value = t; m.uniforms.uForm.value = form;
      m.uniforms.uStrength.value = strength; m.uniforms.uPR.value = renderer.getPixelRatio();
    });
    // the body is simulated on the GPU; it only needs presentation uniforms
    const bu = body.mat.uniforms;
    bu.uForm.value = form;
    bu.uPR.value = renderer.getPixelRatio();
    bu.uBody.value.copy(col.body);
    bu.uBody2.value.copy(col.body2);
    bu.uHi.value.copy(col.hi);
    bu.uAccent.value.copy(col.accent);
    bu.uLight.value = isLight ? 1 : 0;
    graphPts.mat.uniforms.uCursor.value.copy(graphCursor);
    packetPts.mat.uniforms.uCursor.value.set(999, 999, 999);
    const ph = (a, b) => THREE.MathUtils.clamp((form - a) / (b - a), 0, 1);
    /* Dark marks on a light ground read heavier than light marks on dark at
       equal alpha, which is what made light mode look dense. Light mode gets
       lower opacity and slightly smaller points to match the perceived
       density of dark mode. */
    body.mat.uniforms.uOpacity.value = fade * (isLight ? 1.12 : 1.45);
    body.mat.uniforms.uPtScale.value = isLight ? 0.86 : 0.90;
    // dark body colour comes from the sampled reference, so it needs its own
    // desaturation control — the muted palette above only governs light mode
    body.mat.uniforms.uDesat.value = isLight ? 0.0 : 0.30;
    graphPts.mat.uniforms.uOpacity.value = fade * (isLight ? 1.05 : 1.1) * ph(0.62, 0.92) * (1 + (over ? 0.25 : 0));
    graphPts.mat.uniforms.uSize.value = isLight ? 0.95 : 1.25;   // smaller nodes ⇒ more whitespace
    packetPts.mat.uniforms.uOpacity.value = fade * ph(0.8, 1);
    hullMat.opacity = (isLight ? 0.40 : 0.36) * fade * ph(0.6, 0.9);
    edgeMat.opacity = (isLight ? 0.52 : 0.52) * fade * ph(0.72, 1) * (1 - recompute * 0.6);
  }

  // hand the freshly computed textures to the render material
  function bindSim() {
    body.mat.uniforms.tPos.value = body.gpu.getCurrentRenderTarget(body.gpu.variables[1]).texture;
    body.mat.uniforms.tVel.value = body.gpu.getCurrentRenderTarget(body.gpu.variables[0]).texture;
  }
  bindSim();

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    if (!onScreen || document.hidden) return;
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;

    form += (formTarget - form) * (reduced ? 1 : 0.075);   // ~0.7s reveal
    if (form > 0.999) form = 1;

    const g = graphScreen();
    const over = inside && Math.hypot(lastX - g.x, lastY - g.y) <= g.radius;
    if (over !== wasOver) { wasOver = over; document.dispatchEvent(new CustomEvent('core:hover', { detail: { over } })); }

    if (inside) {
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        rig.worldToLocal(bodyCursor.copy(hit));
        graphGroup.worldToLocal(graphCursor.copy(hit));
      }
      strengthTarget = 0.32;                               // gentle
      tiltTarget.set(THREE.MathUtils.clamp((lastY - g.y) / 500, -0.25, 0.25),
                     THREE.MathUtils.clamp((lastX - g.x) / 500, -0.25, 0.25));
    } else {
      strengthTarget = 0; bodyCursor.set(999, 999, 999); graphCursor.set(999, 999, 999); tiltTarget.set(0, 0);
    }
    strength += (strengthTarget - strength) * 0.05;
    tilt.x += (tiltTarget.x - tilt.x) * 0.05;
    tilt.y += (tiltTarget.y - tilt.y) * 0.05;

    if (form > 0.8) {
      hoverCd -= dt;
      if (over && hoverCd <= 0) {
        let best = -1, bd = 1e9;
        for (let i = 0; i < NG; i++) { const d = nodes[i].pos.distanceTo(graphCursor); if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && bd < GR * 1.4) { fire(best); hoverCd = 0.55; }
      }
      /* Reaching into the palm wakes the graph — that is the presenting
         relationship the composition is about. */
      palmCd -= dt;
      if (inside && palmCd <= 0 && bodyCursor.distanceTo(wrist) < 1.5) {
        fire((Math.random() * NG) | 0);
        palmCd = 0.7;
      }
      nextIdle -= dt;
      if (nextIdle <= 0) { fire((Math.random() * NG) | 0); nextIdle = 3.0 + Math.random() * 4.0; }
    }
    for (let i = 0; i < NG; i++) {
      const n = nodes[i];
      if (n.act > 0) n.act = Math.max(0, n.act - dt * 1.1);
      // each node breathes on its own clock so the graph never pulses in unison
      const idle = 0.16 + Math.sin(t * n.rate + n.phase) * 0.14;
      gAct.array[i] = Math.max(n.act, idle);
    }
    gAct.needsUpdate = true;

    if (recomputeT >= 0) {
      recomputeT += dt / 1.7;
      recompute = recomputeT < 0.45 ? recomputeT / 0.45 : Math.max(0, 1 - (recomputeT - 0.45) / 0.55);
      if (!recomputeDone && recomputeT >= 0.45) {
        recomputeDone = true; layoutGraph();
        for (let i = 0; i < NG; i++) {
          gHome.array[i * 3] = nodes[i].home.x; gHome.array[i * 3 + 1] = nodes[i].home.y; gHome.array[i * 3 + 2] = nodes[i].home.z;
        }
        gHome.needsUpdate = true;
        for (let k = 0; k < 3; k++) fire((Math.random() * NG) | 0);
      }
      if (recomputeT >= 1) { recomputeT = -1; recompute = 0; recomputeDone = false; }
    }
    for (let i = 0; i < NG; i++) { nodes[i].pos.copy(nodes[i].home); if (recompute > 0) nodes[i].pos.multiplyScalar(1 + recompute * 0.35); }

    let e = 0;
    for (let i = 0; i < NG && e < MAXE; i++) {
      const n = nodes[i];
      for (let k = 0; k < n.neighbors.length && e < MAXE; k++) {
        const j = n.neighbors[k]; if (j <= i) continue;
        const m = nodes[j];
        ePos[e * 6] = n.pos.x; ePos[e * 6 + 1] = n.pos.y; ePos[e * 6 + 2] = n.pos.z;
        ePos[e * 6 + 3] = m.pos.x; ePos[e * 6 + 4] = m.pos.y; ePos[e * 6 + 5] = m.pos.z;
        const ea = 0.4 + Math.max(n.act, m.act) * 0.6;
        for (let q = 0; q < 6; q++) eCol[e * 6 + q] = ea;
        e++;
      }
    }
    edgeGeo.setDrawRange(0, e * 2);
    edgeGeo.getAttribute('position').needsUpdate = true;
    edgeGeo.getAttribute('color').needsUpdate = true;

    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]; p.t += p.speed * dt;
      if (p.t >= 1) { const tg = nodes[p.to]; if (tg) { tg.act = Math.min(1, tg.act + 0.5); fire(p.to, p.depth + 1); } packets.splice(i, 1); }
    }
    for (let i = 0; i < MAXP; i++) {
      const p = packets[i];
      if (p) {
        const a = nodes[p.from].pos, b = nodes[p.to].pos;
        pHome.array[i * 3] = a.x + (b.x - a.x) * p.t;
        pHome.array[i * 3 + 1] = a.y + (b.y - a.y) * p.t;
        pHome.array[i * 3 + 2] = a.z + (b.z - a.z) * p.t;
        pAct.array[i] = 1;
      } else { pAct.array[i] = 0; pHome.array[i * 3 + 1] = 9999; }
    }
    pHome.needsUpdate = true; pAct.needsUpdate = true;

    if (!reduced) {
      // BASE_YAW opens the torso toward the viewer so the near shoulder and
      // the presenting arm both read, as in the reference 3/4 view.
      rig.rotation.y = BASE_YAW + Math.sin(t * 0.05) * 0.018 + scrollP * 0.12;   // near-stationary
      graphGroup.rotation.y += dt * 0.20;
      graphGroup.rotation.x = Math.sin(t * 0.21) * 0.1 + tilt.x;
      graphGroup.rotation.z = tilt.y * 0.4;
      graphGroup.scale.setScalar(graphBase * (1 + recompute * 0.12));
    }
    // the palm answers whatever the graph is doing, at a fraction of its strength
    let peak = 0;
    for (let i = 0; i < NG; i++) if (nodes[i].act > peak) peak = nodes[i].act;
    palmPulse += (peak - palmPulse) * 0.08;

    /* Advance the particle simulation. Home positions are read-only, so the
       field can always reconstruct the exact reference geometry. */
    const gv = body.velU;
    // ~850ms of stiffened spring, then the normal resting physics
    gv.uIntro.value = Math.max(0, gv.uIntro.value - dt / 0.95);   // ~0.95s assembly
    body.gpu.variables[1].material.uniforms.uIntro.value = gv.uIntro.value;
    gv.uCursor.value.copy(bodyCursor);
    gv.uActive.value = inside ? 1 : 0;
    gv.uDt.value = Math.min(1.5, dt * 60);   // cap keeps the integrator stable after a stall
    body.gpu.variables[1].material.uniforms.uDt.value = gv.uDt.value;
    body.gpu.compute();
    bindSim();

    const fade = 1 - THREE.MathUtils.smoothstep(scrollP, 0.3, 0.95);
    sync(t, fade, over);

    if (form > 0.5 && fade > 0.05) {
      const r = host.getBoundingClientRect(), out = window.__coreAnchors;
      out.length = 0;
      for (let i = 0; i < Math.min(8, NG); i++) {
        _p.copy(nodes[i].pos).applyMatrix4(graphGroup.matrixWorld).project(camera);
        if (_p.z > 1) continue;
        out.push({ x: r.left + (_p.x * 0.5 + 0.5) * r.width, y: r.top + (-_p.y * 0.5 + 0.5) * r.height, act: nodes[i].act });
      }
    } else if (window.__coreAnchors.length) window.__coreAnchors.length = 0;

    renderer.render(scene, camera);
  }
  window.__coreAnchors = [];
  requestAnimationFrame(frame);

  window.__computationalCore = {
    boot: start, rebuild: triggerRecompute, isOverCore: () => wasOver, tier, counts: BUDGET,
    renderOnce: (t = 1, steps = 1) => {
      for (let i = 0; i < steps; i++) body.gpu.compute();
      // bind unconditionally: with steps = 0 these stayed null and the field
      // sampled an unbound texture, rendering nothing at all
      bindSim();
      sync(t, 1, false); renderer.render(scene, camera); return renderer.info.render;
    },
    _sim: (cx, cy, cz, active) => {
      const gv = body.velU;
      gv.uCursor.value.set(cx, cy, cz); gv.uActive.value = active ? 1 : 0; gv.uDt.value = 1;
      body.gpu.variables[1].material.uniforms.uDt.value = 1;
    },
    _settle: (n) => { for (let i = 0; i < n; i++) body.gpu.compute(); bindSim(); },
    _intro: (v) => { body.velU.uIntro.value = v; body.gpu.variables[1].material.uniforms.uIntro.value = v; },
    _residual: () => {
      const rt = body.gpu.getCurrentRenderTarget(body.gpu.variables[1]);
      const buf = new Float32Array(TEX * TEX * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, TEX, TEX, buf);
      let max = 0, sum = 0;
      for (let i = 0; i < TEX * TEX; i++) {
        const dx = buf[i*4] - homeArr[i*4], dy = buf[i*4+1] - homeArr[i*4+1], dz = buf[i*4+2] - homeArr[i*4+2];
        const d = Math.hypot(dx, dy, dz);
        if (d > max) max = d; sum += d;
      }
      return { maxOffset: +max.toFixed(5), meanOffset: +(sum / (TEX*TEX)).toFixed(5), worldH: +WORLD_H.toFixed(2) };
    },
    diagnostics: () => ({ form, strength, recompute, graphNodes: NG, activeNodes: nodes.filter((n) => n.act > 0.05).length, packets: packets.length, drawCalls: renderer.info.render.calls, points: renderer.info.render.points, glError: renderer.getContext().getError() }),
    _setForm: (v) => { form = formTarget = v; },
    _setCursor: (x, y, z, s) => { bodyCursor.set(x, y, z); graphCursor.set(x, y, z); strength = s; },
    _fire: (i) => fire(i ?? ((Math.random() * NG) | 0)),
    _graphScreen: graphScreen,
    _yaw: (v) => { rig.rotation.y = v; },
    _yawGet: () => rig.rotation.y,
    _frame: (o) => { Object.assign(FRAME.desktop, o); resize(); },
    _getFrame: () => JSON.parse(JSON.stringify(FRAME)),
    _bounds: () => {
      const h = body.home; let a={x:[1e9,-1e9],y:[1e9,-1e9],z:[1e9,-1e9]};
      for (let i=0;i<h.length;i+=3){
        a.x[0]=Math.min(a.x[0],h[i]); a.x[1]=Math.max(a.x[1],h[i]);
        a.y[0]=Math.min(a.y[0],h[i+1]); a.y[1]=Math.max(a.y[1],h[i+1]);
        a.z[0]=Math.min(a.z[0],h[i+2]); a.z[1]=Math.max(a.z[1],h[i+2]);
      }
      return { bounds:a, wrist:{x:wrist.x,y:wrist.y,z:wrist.z}, FIG_H,
               rig:{x:rig.position.x,y:rig.position.y,s:rig.scale.x},
               graphLocal:{x:graphGroup.position.x,y:graphGroup.position.y,z:graphGroup.position.z} };
    },
    _nodes: () => nodes,
    // Debug: coarse occupancy map of the rendered silhouette, so the shape
    // can actually be inspected rather than inferred from pixel counts.
    _silhouette: (cols = 56, rows = 30) => {
      sync(1, 1, false); renderer.render(scene, camera);
      const gl = renderer.getContext();
      const w = renderer.domElement.width, h = renderer.domElement.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const grid = [];
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) {
          let sum = 0, n = 0;
          const x0 = Math.floor(c * w / cols), x1 = Math.floor((c + 1) * w / cols);
          const y0 = Math.floor((rows - 1 - r) * h / rows), y1 = Math.floor((rows - r) * h / rows);
          for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { sum += px[(y * w + x) * 4 + 3]; n++; }
          const a = n ? sum / n : 0;
          line += a > 46 ? '#' : a > 22 ? '+' : a > 9 ? '.' : ' ';
        }
        grid.push(line);
      }
      return grid;
    },
  };

  if (document.readyState === 'complete') setTimeout(start, 150);
  else window.addEventListener('load', () => setTimeout(start, 150), { once: true });
}
