/* Project simulators — the case-study diagrams, runnable.
   ─────────────────────────────────────────────────────────
   AgentGuard  · a request walks the policy path and is allowed,
                 escalated to a human, or denied
   Hookline    · a failed delivery is triaged; obvious failures stop at
                 the rules tier, ambiguous ones reach the LLM
   Sociovia    · the webhook handler is stepped through line by line
   VeriCall    · five signals are fused into one risk score, live
   CodeBids    · a premium auction walks the server-authoritative path
   Nova        · wake word → intent → route

   Shared behaviour (makeSim): each panel autoplays its scenarios while it
   is on screen, and hands control to the visitor the moment they press a
   scenario button. Under reduced motion nothing autoplays and a chosen
   scenario resolves instantly to its end state.

   Requests, events, tenants and teams are illustrative — never production
   data. The VeriCall scores and the CodeBids bid rules are the projects'
   own logic, ported. */

(() => {
  const FX = window.FX;
  if (!FX) return;
  const { wait, reduced } = FX;

  /* One runner for all three panels.
     play(key, alive) is an async scenario; `alive()` goes false as soon as a
     newer run starts or the panel leaves the screen, so a stale run can never
     write over a fresh one. */
  function makeSim(root, { buttons, attr, play, idle = 2600, firstDelay = 500 }) {
    let run = 0, visible = false, userDriven = false, timer = 0, order = 0;
    const keys = buttons.map((b) => b.getAttribute(attr));

    const setPressed = (key) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === key)));

    async function start(key) {
      const id = ++run;
      clearTimeout(timer);
      setPressed(key);
      root.classList.add('is-running');
      await play(key, () => id === run && (visible || userDriven));
      if (id !== run) return;
      root.classList.remove('is-running');
      if (!userDriven && visible && !reduced) {
        timer = setTimeout(() => start(keys[++order % keys.length]), idle);
      }
    }

    buttons.forEach((b) => b.addEventListener('click', () => {
      userDriven = true;
      root.querySelectorAll('[aria-live]').forEach((el) => el.setAttribute('aria-live', 'polite'));
      start(b.getAttribute(attr));
    }));

    FX.inView(root, (on) => {
      visible = on;
      if (!on) { run++; clearTimeout(timer); root.classList.remove('is-running'); return; }
      if (reduced || userDriven) return;
      timer = setTimeout(() => start(keys[order % keys.length]), firstDelay);
    }, { threshold: 0.25, once: false });
  }

  // ════════════════════════════════════════════════════════════
  //  AgentGuard
  // ════════════════════════════════════════════════════════════
  (() => {
    const root = document.getElementById('agent-sim');
    if (!root) return;
    const nodes = {};
    root.querySelectorAll('[data-step]').forEach((n) => { nodes[n.dataset.step] = n; });
    const edges = [...root.querySelectorAll('[data-edge]')];   // agent→policy, policy→human, pay→chain, chain→verify
    const reqText = root.querySelector('[data-agent-req-text]');
    const verdictTag = root.querySelector('[data-agent-verdict-tag]');
    const verdictText = root.querySelector('[data-agent-verdict-text]');
    const STATES = ['is-active', 'is-pass', 'is-hold', 'is-deny', 'is-skip'];

    const CASES = {
      allow: {
        req: 'POST api.weather.dev/v1/forecast · 0.40 USDC · risk 0.12',
        policy: ['is-pass', 'cap 1.00 ✓ · route ✓ · risk ✓'],
        human: ['is-skip', 'not required'],
        verdict: ['allow', 'allowed', 'Inside every limit — settled automatically, with a receipt on-chain.'],
      },
      review: {
        req: 'POST data.vendor.io/v2/export · 7.50 USDC · risk 0.61',
        policy: ['is-hold', 'over 5.00 threshold → escalate'],
        human: ['is-hold', 'awaiting approval…', 'is-pass', 'approved by operator'],
        verdict: ['review', 'approved', 'Above the approval threshold — held until a human signed off, then settled.'],
      },
      block: {
        req: 'POST unknown-host.xyz/pay · 2.00 USDC · risk 0.88',
        policy: ['is-deny', 'route not on allow-list'],
        verdict: ['block', 'denied', 'Stopped at policy. No payment is constructed, nothing leaves the wallet.'],
      },
    };

    const setNode = (key, state, status) => {
      const n = nodes[key];
      n.classList.remove(...STATES);
      if (state) n.classList.add(state);
      const s = n.querySelector('[data-status]');
      if (s && status !== undefined) s.textContent = status;
    };
    const reset = () => {
      Object.keys(nodes).forEach((k) => setNode(k, null, ''));
      edges.forEach((e) => e.classList.remove('is-flow'));
    };
    const setVerdict = (kind, tag, text) => {
      root.dataset.verdict = kind;
      verdictTag.textContent = tag;
      verdictText.textContent = text;
    };

    async function play(key, alive) {
      const c = CASES[key];
      reset();
      reqText.textContent = c.req;
      setVerdict('run', 'evaluating', 'Request received — walking the policy path.');

      setNode('agent', 'is-active', 'signing request');
      await wait(650); if (!alive()) return;
      setNode('agent', 'is-pass', 'request signed');
      edges[0].classList.add('is-flow');
      await wait(420); if (!alive()) return;

      setNode('policy', 'is-active', 'checking caps · routes · risk');
      await wait(950); if (!alive()) return;
      setNode('policy', c.policy[0], c.policy[1]);

      if (key === 'block') {
        ['human', 'pay', 'chain', 'verify'].forEach((k) => setNode(k, 'is-skip', 'not reached'));
        setVerdict(...c.verdict);
        return;
      }

      edges[1].classList.add('is-flow');
      await wait(420); if (!alive()) return;
      if (key === 'review') {
        setNode('human', c.human[0], c.human[1]);
        await wait(1500); if (!alive()) return;
        setNode('human', c.human[2], c.human[3]);
        setNode('policy', 'is-pass', 'escalated · approved');
      } else {
        setNode('human', c.human[0], c.human[1]);
      }
      await wait(480); if (!alive()) return;

      setNode('pay', 'is-active', '402 → paying');
      await wait(800); if (!alive()) return;
      setNode('pay', 'is-pass', 'USDC transfer signed');
      edges[2].classList.add('is-flow');
      await wait(420); if (!alive()) return;

      setNode('chain', 'is-active', 'submitting to TestNet');
      await wait(900); if (!alive()) return;
      setNode('chain', 'is-pass', 'confirmed on-chain');
      edges[3].classList.add('is-flow');
      await wait(420); if (!alive()) return;

      setNode('verify', 'is-active', 'matching receipt');
      await wait(650); if (!alive()) return;
      setNode('verify', 'is-pass', 'receipt ✓ · audit entry written');
      setVerdict(...c.verdict);
    }

    makeSim(root, { buttons: [...root.querySelectorAll('[data-agent-case]')], attr: 'data-agent-case', play, idle: 3200 });
  })();

  // ════════════════════════════════════════════════════════════
  //  Hookline
  // ════════════════════════════════════════════════════════════
  (() => {
    const root = document.getElementById('hook-sim');
    if (!root) return;
    const node = {};
    root.querySelectorAll('[data-hook-node]').forEach((n) => {
      node[n.dataset.hookNode] = n;
      const d = n.querySelector('[data-hook-desc]');
      d.dataset.idle = d.textContent;
    });
    const arrows = [...root.querySelectorAll('.hook-flow__arrow')];   // fail→rules, rules→llm, llm→verdict
    const log = root.querySelector('[data-hook-log]');
    const tally = { total: root.querySelector('[data-hook-total]'), llm: root.querySelector('[data-hook-llm]'), saved: root.querySelector('[data-hook-saved]') };
    const counts = { total: 0, llm: 0 };

    const CASES = {
      timeout:  { fail: 'connect timeout · 10s',    rules: 'transient → known',     llm: null,
                  verdict: ['retry', 'retry · backoff 4s'],
                  log: 'No response at all is unambiguous: the rules tier schedules a retry on the Redis ZSET with exponential backoff. No LLM call.' },
      throttle: { fail: '503 · Retry-After: 30',    rules: 'header says wait',      llm: null,
                  verdict: ['throttle', 'throttle · 30s'],
                  log: 'The endpoint told us exactly what it wants. Rules honour Retry-After and slow the endpoint down. No LLM call.' },
      gateway:  { fail: '502 · text/html body',     rules: 'ambiguous → escalate',  llm: 'upstream gateway, transient',
                  verdict: ['retry', 'retry · backoff 8s'],
                  log: 'An HTML 502 could be a gateway blip or a broken deploy. Rules cannot tell, so Gemini reads the body and returns a closed-enum verdict; it is cached in Redis.' },
      auth:     { fail: '403 · {"error":"revoked"}', rules: 'ambiguous → escalate', llm: 'credential revoked, permanent',
                  verdict: ['dead', 'dead-letter'],
                  log: 'A 403 is throttling or a dead key. The body says the key was revoked — retrying can never succeed, so the delivery is dead-lettered.' },
      lying:    { fail: '200 · body says "error"',  rules: 'ambiguous → escalate',  llm: 'application-level failure',
                  verdict: ['break', 'circuit-break'],
                  log: 'A 200 that quietly reports failure. Status-code rules pass it; Gemini reads the body, and the per-endpoint breaker opens.' },
    };

    const reset = () => {
      Object.values(node).forEach((n) => {
        n.classList.remove('is-active', 'is-done', 'is-skip');
        const d = n.querySelector('[data-hook-desc]');
        d.textContent = d.dataset.idle;
      });
      delete node.verdict.dataset.verdict;
      arrows.forEach((a) => a.classList.remove('is-flow'));
    };
    const desc = (key, text) => { node[key].querySelector('[data-hook-desc]').textContent = text; };
    const step = (key) => {
      Object.values(node).forEach((n) => { if (n.classList.contains('is-active')) { n.classList.remove('is-active'); n.classList.add('is-done'); } });
      node[key].classList.add('is-active');
    };

    async function play(key, alive) {
      const c = CASES[key];
      reset();
      log.textContent = 'Delivery failed — triaging.';
      step('fail'); desc('fail', c.fail);
      await wait(700); if (!alive()) return;

      arrows[0].classList.add('is-flow');
      await wait(320); if (!alive()) return;
      step('rules'); desc('rules', 'evaluating…');
      await wait(750); if (!alive()) return;
      desc('rules', c.rules);

      arrows[1].classList.add('is-flow');
      if (c.llm) {
        await wait(320); if (!alive()) return;
        step('llm'); desc('llm', 'reading response body…');
        await wait(1150); if (!alive()) return;
        desc('llm', c.llm);
        counts.llm++;
      } else {
        node.llm.classList.add('is-skip'); desc('llm', 'skipped');
        await wait(260); if (!alive()) return;
      }

      arrows[2].classList.add('is-flow');
      await wait(320); if (!alive()) return;
      step('verdict');
      node.verdict.dataset.verdict = c.verdict[0];
      desc('verdict', c.verdict[1]);
      counts.total++;
      tally.total.textContent = counts.total;
      tally.llm.textContent = counts.llm;
      tally.saved.textContent = counts.total - counts.llm;
      log.textContent = c.log;
      await wait(500);
      if (alive()) node.verdict.classList.remove('is-active');
    }

    // The accuracy bars fill when the panel arrives, not at page load.
    FX.inView(root, () => {
      root.classList.add('is-in');
      root.querySelectorAll('[data-hook-count]').forEach((el, i) => {
        const target = parseFloat(el.dataset.hookCount);
        if (reduced) { el.textContent = target + '%'; return; }
        const t0 = performance.now() + 150 + i * 300, dur = 1400;
        const tick = (now) => {
          const p = FX.clamp((now - t0) / dur);
          el.textContent = Math.round(target * FX.easeOut(p)) + '%';
          if (p < 1) requestAnimationFrame(tick);
        };
        el.textContent = '0%';
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.3 });

    makeSim(root, { buttons: [...root.querySelectorAll('[data-hook-case]')], attr: 'data-hook-case', play, idle: 3400, firstDelay: 1900 });
  })();

  // ════════════════════════════════════════════════════════════
  //  Sociovia — execution trace
  // ════════════════════════════════════════════════════════════
  (() => {
    const root = document.getElementById('trace-viz');
    if (!root) return;
    const body = root.querySelector('.terminal__body');
    const lines = (key) => [...body.querySelectorAll(`[data-line="${key}"]`)];
    const out = {
      text: root.querySelector('[data-trace-text]'),
      tenant: root.querySelector('[data-trace-tenant]'),
      result: root.querySelector('[data-trace-result]'),
      queue: root.querySelector('[data-trace-queue]'),
      count: root.querySelector('[data-trace-count]'),
    };
    let queued = 0;

    const CASES = {
      match:    { text: '"price?"',           tenant: 'studio-a · enabled',  path: ['entry', 'tenant', 'enabled', 'match', 'nomatch', 'queue', 'done'],
                  ret: 'done',    result: ['queued', '204 · dm.reply queued · attempt 1/5'] },
      nomatch:  { text: '"love this 🔥"',     tenant: 'studio-a · enabled',  path: ['entry', 'tenant', 'enabled', 'match', 'nomatch'],
                  ret: 'nomatch', result: ['skip', '204 · no rule matched · nothing queued'] },
      disabled: { text: '"price?"',           tenant: 'studio-b · disabled', path: ['entry', 'tenant', 'enabled'],
                  ret: 'enabled', result: ['skip', '204 · tenant disabled · exits before rules'] },
    };

    const clear = () => body.querySelectorAll('.tline').forEach((l) => l.classList.remove('is-exec', 'is-ret', 'is-seen'));

    function enqueue() {
      const job = document.createElement('span');
      job.className = 'trace__job';
      out.queue.appendChild(job);
      out.count.textContent = ++queued;
      // the worker drains it a moment later
      setTimeout(() => {
        job.classList.add('is-out');
        setTimeout(() => { job.remove(); out.count.textContent = Math.max(0, --queued); }, reduced ? 0 : 400);
      }, reduced ? 1200 : 2600);
    }

    async function play(key, alive) {
      const c = CASES[key];
      clear();
      body.classList.add('is-tracing');
      out.text.textContent = c.text;
      out.tenant.textContent = '…';
      out.result.textContent = 'running';
      delete out.result.dataset.kind;

      for (const k of c.path) {
        body.querySelectorAll('.is-exec').forEach((l) => { l.classList.remove('is-exec'); l.classList.add('is-seen'); });
        const isReturn = k === c.ret;
        lines(k).forEach((l) => l.classList.add(isReturn ? 'is-ret' : 'is-exec'));
        if (k === 'tenant') out.tenant.textContent = c.tenant;
        if (k === 'queue') enqueue();
        await wait(k === 'queue' ? 900 : 620);
        if (!alive()) return;
      }
      out.result.dataset.kind = c.result[0];
      out.result.textContent = c.result[1];
    }

    makeSim(root, { buttons: [...root.querySelectorAll('[data-trace-case]')], attr: 'data-trace-case', play, idle: 2800 });
  })();

  // ════════════════════════════════════════════════════════════
  //  VeriCall — five signals fused into one explainable score
  //  A port of RiskFusionEngine.fuse() (backend/app/services/risk_fusion.py)
  //  running on the backend's own demo scenarios, so the numbers shown are
  //  the numbers the app shows — not animation props.
  // ════════════════════════════════════════════════════════════
  (() => {
    const root = document.getElementById('veri-sim');
    if (!root) return;

    const WEIGHTS = { reputation: 0.20, spoof: 0.30, speaker: 0.20, intent: 0.25, context: 0.05 };
    const BANDS = [[80, 'CRITICAL'], [60, 'HIGH'], [35, 'MEDIUM'], [0, 'LOW']];
    const ACTIONS = {
      CRITICAL: 'Do NOT share information. End the call and report the number.',
      HIGH: 'Be extremely cautious. Verify the caller through another channel.',
      MEDIUM: 'Proceed carefully. Do not share OTPs or transfer money.',
      LOW: 'Call looks safe. Stay alert for the usual red flags.',
    };
    const clamp100 = (v) => Math.max(0, Math.min(100, v));

    // raw 0–100 component scores from a scenario's detector outputs
    function components(c) {
      let speaker = 0;
      if (c.similarity !== null) {
        const MATCH = 0.75, POSSIBLE = 0.55;
        if (c.similarity >= MATCH) speaker = 0;
        else if (c.similarity >= POSSIBLE) speaker = 30 * (MATCH - c.similarity) / (MATCH - POSSIBLE);
        else speaker = clamp100(60 + 30 * (POSSIBLE - c.similarity) / (1 + POSSIBLE) + (c.claims ? 10 : 0));
      }
      return {
        reputation: clamp100(c.reputation),
        spoof: clamp100(c.spoof * (0.5 + 0.5 * Math.max(c.spoofConf, 0.2)) * 100),
        speaker,
        intent: clamp100(c.intent * 100),
        context: Math.min(100, (c.oddHour ? 20 : 0) + (c.firstTime ? 25 : 0) + (c.spoofedId ? 55 : 0)),
      };
    }

    // weighted sum over the active weight, double-confirmation bump, floors
    function fuse(comp, knownScammer) {
      const keys = Object.keys(WEIGHTS);
      const active = keys.reduce((sum, k) => sum + (comp[k] > 1 ? WEIGHTS[k] : 0), 0);
      let score = active < 1e-6 ? 0 : Math.min(100, keys.reduce((sum, k) => sum + comp[k] * WEIGHTS[k], 0) / Math.max(active, 0.5));
      const strong = keys.filter((k) => comp[k] >= 65).length;
      if (strong >= 2) score = Math.min(100, score + 8 * (strong - 1));
      if (keys.some((k) => comp[k] >= 80)) score = Math.max(score, 40);
      if (knownScammer && comp.reputation >= 70) score = Math.max(score, 78);
      return score;
    }
    const band = (score) => BANDS.find(([min]) => score >= min)[1];

    // detector outputs copied from backend/app/services/scenarios.py
    const CASES = {
      clone: {
        caller: 'Mom', transcript: '"Beta, it is your mother. I am in a big problem. Please transfer forty thousand rupees to this UPI ID right now. Do not tell anyone."',
        reputation: 12, known: false, spoof: 0.88, spoofConf: 0.83, similarity: 0.28, claims: true, intent: 0.94, spoofedId: true,
      },
      legit: {
        caller: 'Mom', transcript: '"Hey beta, I was just calling to check if you reached college safely. Don\'t forget to eat lunch."',
        reputation: 8, known: false, spoof: 0.05, spoofConf: 0.92, similarity: 0.86, claims: true, intent: 0.02,
      },
      bank: {
        caller: 'Unknown number', transcript: '"I am calling from the credit card department. Your card will be blocked unless you complete KYC. I have sent you an OTP, please share the six digit code."',
        reputation: 72, known: true, spoof: 0.32, spoofConf: 0.60, similarity: null, intent: 0.97, firstTime: true,
      },
      courtesy: {
        caller: 'Bank customer care', transcript: '"This is a courtesy call. Your debit card is expiring next month; a new one will be dispatched to your registered address. No action is required from you."',
        reputation: 10, known: false, spoof: 0.06, spoofConf: 0.90, similarity: null, intent: 0.05,
      },
    };
    // the order signals land in during a call: what is known first, then what must be heard
    const ARRIVAL = ['reputation', 'context', 'spoof', 'speaker', 'intent'];

    const rows = {};
    root.querySelectorAll('[data-veri-signal]').forEach((li) => {
      rows[li.dataset.veriSignal] = { li, bar: li.querySelector('.veri__sig-bar i'), pts: li.querySelector('[data-pts]') };
    });
    const ui = {
      caller: root.querySelector('[data-veri-caller]'),
      transcript: root.querySelector('[data-veri-transcript]'),
      arc: root.querySelector('[data-veri-arc]'),
      score: root.querySelector('[data-veri-score]'),
      level: root.querySelector('[data-veri-level]'),
      tag: root.querySelector('[data-veri-tag]'),
      action: root.querySelector('[data-veri-action]'),
    };

    let shown = 0, scoreRaf = 0;
    function setScore(target) {
      cancelAnimationFrame(scoreRaf);
      const level = band(target);
      root.dataset.level = level.toLowerCase();
      ui.level.textContent = level;
      ui.arc.style.strokeDashoffset = String(100 - target);
      if (reduced) { shown = target; ui.score.textContent = Math.round(target); return; }
      const from = shown, t0 = performance.now();
      const tick = (now) => {
        const p = FX.clamp((now - t0) / 600);
        shown = from + (target - from) * FX.easeOut(p);
        ui.score.textContent = Math.round(shown);
        if (p < 1) scoreRaf = requestAnimationFrame(tick);
      };
      scoreRaf = requestAnimationFrame(tick);
    }

    async function play(key, alive) {
      const c = CASES[key];
      const full = components(c);
      const seen = { reputation: 0, spoof: 0, speaker: 0, intent: 0, context: 0 };

      Object.values(rows).forEach((r) => { r.li.className = ''; r.bar.style.transform = 'scaleX(0)'; r.pts.textContent = '—'; });
      ui.caller.textContent = c.caller;
      ui.transcript.textContent = c.transcript;
      ui.tag.textContent = 'analysing';
      ui.action.textContent = 'Signals arrive as the call unfolds; the score is re-fused after each one.';
      setScore(0);
      root.dataset.level = 'run';
      ui.level.textContent = 'listening';
      await wait(700); if (!alive()) return;

      for (const k of ARRIVAL) {
        const r = rows[k];
        r.li.classList.add('is-active');
        await wait(520); if (!alive()) return;
        seen[k] = full[k];
        const neutral = k === 'speaker' && c.similarity === null;
        r.bar.style.transform = `scaleX(${(full[k] / 100).toFixed(3)})`;
        r.pts.textContent = neutral
          ? 'no enrolled voice'
          : `${full[k].toFixed(0)} × ${WEIGHTS[k].toFixed(2)} = ${(full[k] * WEIGHTS[k]).toFixed(1)}`;
        r.li.classList.remove('is-active');
        r.li.classList.add(full[k] >= 65 ? 'is-strong' : full[k] >= 30 ? 'is-mid' : 'is-calm');
        setScore(fuse(seen, c.known));
        await wait(380); if (!alive()) return;
      }

      const score = fuse(full, c.known);
      const level = band(score);
      ui.tag.textContent = `${level} · ${score.toFixed(0)}`;
      ui.action.textContent = ACTIONS[level];
    }

    makeSim(root, { buttons: [...root.querySelectorAll('[data-veri-case]')], attr: 'data-veri-case', play, idle: 3600 });
  })();

  // ════════════════════════════════════════════════════════════
  //  CodeBids — a premium auction on the server-authoritative path
  //  Rules mirror packages/shared/src/economy.ts: max bid = capital −
  //  protected reserve, bids open at ₹200 and rise by ₹100, the winning
  //  bid is the stake, and a failed attempt offers the premium to the next
  //  original bidder at their own bid. Teams are illustrative.
  // ════════════════════════════════════════════════════════════
  (() => {
    const root = document.getElementById('market-sim');
    if (!root) return;
    const RESERVE = 500, OPEN = 200, STEP = 100;
    const TEAMS = [
      { id: 'np', name: 'Null Pointers',  capital: 2100 },
      { id: 'ss', name: 'Stack Smashers', capital: 1700 },
      { id: 'sf', name: 'Segfault',       capital: 1500 },
      { id: 'ob', name: 'Off By One',     capital: 900 },
    ];
    const rupee = (n) => '₹' + n.toLocaleString('en-IN');

    const board = root.querySelector('[data-market-board]');
    const pipe = [...root.querySelectorAll('[data-pipe]')];
    const ui = {
      bid: root.querySelector('[data-market-bid]'),
      leader: root.querySelector('[data-market-leader]'),
      log: root.querySelector('[data-market-log]'),
    };
    const state = {};
    TEAMS.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'market__team';
      li.innerHTML = '<span class="market__rank mono"></span><span class="market__name"></span>'
                   + '<span class="market__cap mono"></span><span class="market__max mono"></span>';
      li.querySelector('.market__name').textContent = t.name;
      board.appendChild(li);
      state[t.id] = { ...t, li, shown: t.capital };
    });
    board.style.setProperty('--rows', TEAMS.length);

    function paint() {
      const ranked = Object.values(state).sort((a, b) => b.capital - a.capital);
      ranked.forEach((t, i) => {
        t.li.style.setProperty('--i', i);
        t.li.querySelector('.market__rank').textContent = String(i + 1).padStart(2, '0');
        t.li.querySelector('.market__cap').textContent = rupee(t.capital);
        t.li.querySelector('.market__max').textContent = 'max bid ' + rupee(Math.max(0, t.capital - RESERVE));
      });
    }
    function reset() {
      TEAMS.forEach((t) => { state[t.id].capital = t.capital; state[t.id].li.className = 'market__team'; });
      pipe.forEach((p) => { p.className = ''; });
      ui.bid.textContent = '—';
      ui.leader.textContent = 'auction opens at ' + rupee(OPEN);
      paint();
    }

    // one action down the path; `stopAt` names the stage where the server refuses it
    async function walk(alive, stopAt) {
      pipe.forEach((p) => { p.className = ''; });
      for (const p of pipe) {
        p.classList.add('is-on');
        await wait(150); if (!alive()) return false;
        if (p.dataset.pipe === stopAt) { p.classList.add('is-refused'); return false; }
      }
      return true;
    }

    // same rule set as validateBid(): on the ladder, and within capital − reserve
    function check(team, amount, current) {
      const minimum = current === null ? OPEN : current + STEP;
      if (amount > team.capital - RESERVE) return 'exceeds_max_bid';
      if (amount !== minimum) return 'not_on_increment';
      return null;
    }

    async function bid(alive, id, amount, current) {
      const t = state[id];
      const refusal = check(t, amount, current);
      ui.log.textContent = `${t.name} bids ${rupee(amount)}…`;
      const ok = await walk(alive, refusal ? 'validate' : null);
      if (!alive()) return current;
      if (refusal) {
        t.li.classList.add('is-refused');
        ui.log.textContent = `Rejected at the server (${refusal}): ${t.name} holds ${rupee(t.capital)}, so its maximum legal bid is ${rupee(t.capital)} − ${rupee(RESERVE)} = ${rupee(t.capital - RESERVE)}. Nothing is written, nothing is broadcast.`;
        await wait(2600);
        t.li.classList.remove('is-refused');
        return current;
      }
      if (!ok) return current;
      Object.values(state).forEach((x) => x.li.classList.toggle('is-leading', x === t));
      ui.bid.textContent = rupee(amount);
      ui.leader.textContent = `${t.name} leads`;
      await wait(420);
      return amount;
    }

    async function settle(alive, id, stake, correct) {
      const t = state[id];
      ui.bid.textContent = rupee(stake);
      ui.leader.textContent = `${t.name} attempting · stake ${rupee(stake)}`;
      await wait(1100); if (!alive()) return;
      await walk(alive, null); if (!alive()) return;
      t.capital += correct ? stake : -stake;
      t.li.classList.remove('is-leading');
      t.li.classList.add(correct ? 'is-up' : 'is-down');
      paint();
      ui.leader.textContent = correct ? `${t.name} solved it · +${rupee(stake)}` : `${t.name} missed · −${rupee(stake)}`;
      await wait(1300);
      t.li.classList.remove('is-up', 'is-down');
    }

    const SCRIPTS = {
      win: async (alive) => {
        let cur = null;
        for (const [id, amt] of [['sf', 200], ['ss', 300], ['np', 400], ['ss', 500], ['np', 600]]) {
          cur = await bid(alive, id, amt, cur); if (!alive()) return;
        }
        ui.log.textContent = `SOLD to Null Pointers for ${rupee(cur)}. The winning bid is the stake.`;
        await settle(alive, 'np', cur, true); if (!alive()) return;
        ui.log.textContent = 'Correct on the first attempt: the bid is added to capital and the premium closes.';
      },
      reclaim: async (alive) => {
        let cur = null;
        for (const [id, amt] of [['ob', 200], ['sf', 300], ['ss', 400], ['sf', 500], ['ss', 600], ['sf', 700]]) {
          cur = await bid(alive, id, amt, cur); if (!alive()) return;
        }
        ui.log.textContent = `SOLD to Segfault for ${rupee(cur)}.`;
        await settle(alive, 'sf', cur, false); if (!alive()) return;
        ui.log.textContent = 'Wrong answer. Reclaim is offered to the next-highest original bidder, Stack Smashers, at their own bid of ₹600 — never a second auction.';
        await wait(1900); if (!alive()) return;
        await settle(alive, 'ss', 600, true); if (!alive()) return;
        ui.log.textContent = 'Second and final attempt solved: Stack Smashers take the lead. Two attempts is the hard limit.';
      },
      reject: async (alive) => {
        let cur = null;
        for (const [id, amt] of [['sf', 200], ['ss', 300], ['np', 400]]) {
          cur = await bid(alive, id, amt, cur); if (!alive()) return;
        }
        cur = await bid(alive, 'ob', 500, cur); if (!alive()) return;
        cur = await bid(alive, 'ss', 500, cur); if (!alive()) return;
        ui.log.textContent = `The auction carries on untouched at ${rupee(cur)}. The refused bid never reached the database or any other screen.`;
      },
    };

    async function play(key, alive) {
      reset();
      await wait(500); if (!alive()) return;
      await SCRIPTS[key](alive);
    }

    reset();
    makeSim(root, { buttons: [...root.querySelectorAll('[data-market-case]')], attr: 'data-market-case', play, idle: 3400 });
  })();

  // ════════════════════════════════════════════════════════════
  //  Nova — wake word → intent → route
  // ════════════════════════════════════════════════════════════
  (() => {
    const root = document.getElementById('voice-viz');
    if (!root) return;
    const wave = root.querySelector('[data-voice-wave]');
    const heard = root.querySelector('[data-voice-heard]');
    const intent = root.querySelector('[data-voice-intent]');
    const route = root.querySelector('[data-voice-route]');

    // Bars are pure CSS (scaleY keyframes); JS only seeds their shape.
    const BARS = 44;
    for (let i = 0; i < BARS; i++) {
      const bar = document.createElement('span');
      const envelope = Math.sin((i / (BARS - 1)) * Math.PI);            // louder in the middle
      const h = 0.25 + envelope * 0.55 + ((i * 37) % 11) / 55;
      bar.style.setProperty('--h', Math.min(1, h).toFixed(2));
      bar.style.setProperty('--t', (0.42 + ((i * 53) % 17) / 40).toFixed(2) + 's');
      bar.style.setProperty('--d', (-((i * 29) % 13) / 10).toFixed(2) + 's');
      wave.appendChild(bar);
    }

    const COMMANDS = [
      ['"nova, what\'s the weather"', 'weather',        'OpenWeatherMap → pyttsx3'],
      ['"nova, today\'s headlines"',  'news',           'NewsAPI → pyttsx3'],
      ['"nova, play some lo-fi"',     'media',          'pywhatkit → YouTube'],
      ['"nova, who was Ada Lovelace"', 'lookup',        'Wikipedia summary → pyttsx3'],
      ['"nova, volume down"',         'system control', 'nircmd changesysvolume'],
    ];

    let run = 0, visible = false, idx = 0;
    async function cycle() {
      const id = ++run;
      while (id === run && visible) {
        const [h, i, r] = COMMANDS[idx++ % COMMANDS.length];
        root.classList.add('is-heard');
        heard.textContent = h; intent.textContent = '…'; route.textContent = '…';
        await wait(1300); if (id !== run) return;
        root.classList.remove('is-heard');
        intent.textContent = i;
        await wait(450); if (id !== run) return;
        route.textContent = r;
        await wait(2400);
      }
    }

    if (reduced) {
      const [h, i, r] = COMMANDS[0];
      heard.textContent = h; intent.textContent = i; route.textContent = r;
      return;
    }
    FX.inView(root, (on) => {
      visible = on;
      root.classList.toggle('is-live', on);
      if (on) cycle(); else run++;
    }, { threshold: 0.3, once: false });
  })();
})();
