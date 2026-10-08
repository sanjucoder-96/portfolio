/* Scenes — section-level choreography below the hero.
   ─────────────────────────────────────────────────
   Small, declarative wiring on top of fx.js. The heavy pieces live in
   their own files (sims.js, pixel-viz.js, ecosystem.js);
   this file is the connective tissue:

     section heads · manifesto read-along · case index rail
     experience line · DSA row ↔ radar · journey milestones
     contact (copy, local time, composer, network anchor) · footer name

   Runs after motion.js. Nothing here needs GSAP. */

(() => {
  const FX = window.FX;
  if (!FX) return;
  const { reduced } = FX;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function init() {
    // ── Section heads: rule draws in, kicker decodes ──
    $$('.section__head').forEach((head) => {
      FX.inView(head, () => {
        head.classList.add('is-in');
        FX.scramble($('.section__kicker', head));
      }, { threshold: 0.4 });
    });
    $$('.case').forEach((c) => FX.inView(c, () => c.classList.add('is-in'), { threshold: 0.12 }));

    // ── Manifesto: words light up as the paragraph crosses the viewport ──
    const manifesto = $('.manifesto__text');
    if (manifesto && !reduced) {
      const words = FX.splitWords(manifesto);
      let lit = 0;
      FX.progress(manifesto, (p) => {
        const n = Math.round(p * words.length);
        if (n === lit) return;
        const from = Math.min(n, lit), to = Math.max(n, lit);
        for (let i = from; i < to; i++) words[i].classList.toggle('is-lit', i < n);
        lit = n;
      }, { start: 0.82, end: 0.42, span: true });
    }

    // ── Case index rail ──
    const rail = $('.work-rail');
    const work = $('#work');
    if (rail && work) {
      new IntersectionObserver((entries) => {
        entries.forEach((e) => rail.classList.toggle('is-on', e.isIntersecting));
      }, { rootMargin: '-35% 0px -35% 0px' }).observe(work);
      const links = new Map($$('a[data-rail]', rail).map((a) => [a.dataset.rail, a]));
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          links.forEach((a, key) => {
            const active = key === e.target.dataset.case;
            a.classList.toggle('is-active', active);
            if (active) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
          });
        });
      }, { rootMargin: '-45% 0px -45% 0px' });
      $$('.case[data-case]', work).forEach((c) => io.observe(c));
    }

    // ── Experience: the line fills, each role lands as it is reached ──
    const tl = $('#timeline');
    if (tl) {
      const fill = $('.tl__fill', tl);
      FX.progress(tl, (p) => fill.style.setProperty('--p', p.toFixed(4)), { start: 0.7, end: 0.5, span: true });
      $$('.tl__item', tl).forEach((item) => FX.inView(item, () => item.classList.add('is-reached'), { threshold: 0.2, margin: '0px 0px -12% 0px' }));

      // "current · 5 mo" — computed, so it never goes stale. A finished role
      // carries data-until and counts both its first and last month.
      const now = new Date();
      $$('[data-since]', tl).forEach((el) => {
        const [y, m] = el.dataset.since.split('-').map(Number);
        const until = el.dataset.until ? el.dataset.until.split('-').map(Number) : null;
        const months = until
          ? (until[0] - y) * 12 + (until[1] - m) + 1
          : (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
        if (months < 1) return;
        el.textContent = months >= 12
          ? `${Math.floor(months / 12)} yr${months % 12 ? ` ${months % 12} mo` : ''}`
          : `${months} mo`;
      });
    }

    // ── DSA: topic rows and the radar highlight each other ──
    //  Hover previews a topic (and plays its algorithm in the radar); a click,
    //  tap or Enter pins it, which is the only way to reach it on touch.
    const topics = $('.dsa__topics');
    if (topics) {
      const rows = $$('li[data-topics]', topics);
      let pinned = null;
      const show = (names) => {
        topics.classList.toggle('is-tracing', !!names);
        rows.forEach((r) => r.classList.toggle('is-hot', !!names && r.dataset.topics.split(',').some((k) => names.includes(k))));
      };
      const apply = (row) => {
        const target = row || pinned;
        const names = target ? target.dataset.topics.split(',') : null;
        show(names);
        if (window.__dsaHighlight) window.__dsaHighlight(names);
      };
      rows.forEach((row) => {
        row.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') apply(row); });
        row.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') apply(null); });
        row.addEventListener('focus', () => apply(row));
        row.addEventListener('blur', () => apply(null));
        const toggle = () => {
          pinned = pinned === row ? null : row;
          rows.forEach((r) => r.setAttribute('aria-pressed', String(r === pinned)));
          apply(pinned);
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          toggle();
        });
      });
      // radar → rows
      window.__dsaOnHover = (name) => show(name ? [name] : (pinned ? pinned.dataset.topics.split(',') : null));
    }

    // ── Journey ──
    const journey = $('#journey');
    if (journey) {
      const cards = $$('.journey__card', journey);
      // Third segment is still being written: fill it only as far as the degree has run.
      const start = Date.UTC(2024, 7, 1), end = Date.UTC(2028, 5, 1);
      const degree = FX.clamp((Date.now() - start) / (end - start));
      const fillMax = (2 + degree * 0.85) / 3;
      const fill = $('.journey__fill', journey);
      FX.progress(journey, (p) => fill.style.setProperty('--p', (p * fillMax).toFixed(4)), { start: 0.9, end: 0.45 });
      cards.forEach((card) => {
        FX.inView(card, () => {
          card.classList.add('is-in');
          const b = $('[data-grade]', card);
          if (!b || reduced) return;
          const target = parseFloat(b.dataset.grade);
          const digits = (b.dataset.grade.split('.')[1] || '').length;
          const t0 = performance.now() + 250;
          const tick = (now) => {
            const p = FX.clamp((now - t0) / 1300);
            b.textContent = (target * FX.easeOut(p)).toFixed(digits);
            if (p < 1) requestAnimationFrame(tick); else b.textContent = b.dataset.grade;
          };
          requestAnimationFrame(tick);
        }, { threshold: 0.3 });
      });
    }

    initContact();
    initFooter();
  }

  // ════════════════════════════════════════════════════════════
  //  Contact
  // ════════════════════════════════════════════════════════════
  function initContact() {
    const contact = $('#contact');
    if (!contact) return;

    const bento = $('.bento', contact);
    if (bento) FX.inView(bento, () => bento.classList.add('is-in'), { threshold: 0.1 });

    // copy address
    $$('[data-copy]', contact).forEach((btn) => {
      const label = $('[data-copy-label]', btn);
      const idle = label.textContent;
      let timer = 0;
      btn.addEventListener('click', async () => {
        const text = btn.dataset.copy;
        let ok = true;
        try { await navigator.clipboard.writeText(text); }
        catch (e) {
          // insecure context or denied permission — fall back to a selection copy
          const ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
          document.body.appendChild(ta); ta.select();
          try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
          ta.remove();
        }
        label.textContent = ok ? 'copied to clipboard' : 'copy blocked — address is above';
        btn.classList.toggle('is-copied', ok);
        clearTimeout(timer);
        timer = setTimeout(() => { label.textContent = idle; btn.classList.remove('is-copied'); }, 2000);
      });
    });

    // local time in Hyderabad
    const clock = $('[data-local-time]', contact);
    if (clock) {
      let fmt = null;
      try { fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { /* no tz data */ }
      if (fmt) {
        const tick = () => { clock.textContent = fmt.format(new Date()) + ' IST'; };
        tick();
        setInterval(tick, 20000);
      } else clock.textContent = 'IST · UTC+5:30';
    }

    // composer → hands a pre-filled draft to the visitor's own mail client
    const form = $('#composer');
    if (form) {
      const hint = $('#c-hint', form);
      const idleHint = hint.textContent;
      const msg = form.elements.message;
      const say = (text, cls) => {
        hint.textContent = text;
        hint.classList.remove('is-warn', 'is-ok');
        if (cls) hint.classList.add(cls);
      };
      msg.addEventListener('input', () => { if (hint.classList.contains('is-warn')) say(idleHint); });
      form.addEventListener('animationend', () => form.classList.remove('is-shake'));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const body = msg.value.trim();
        if (!body) {
          say('write a line first — then it opens in your mail client', 'is-warn');
          if (!reduced) form.classList.add('is-shake');
          msg.focus();
          return;
        }
        const name = form.elements.name.value.trim();
        const topic = form.elements.topic.value;
        const to = $('#mail-link').getAttribute('href').replace(/^mailto:/, '');
        const href = `mailto:${to}?subject=${encodeURIComponent(name ? `${topic} — ${name}` : topic)}`
                   + `&body=${encodeURIComponent(name ? `${body}\n\n— ${name}` : body)}`;
        // Cancelable so the draft can be intercepted (tests, or a future in-page sender).
        const open = new CustomEvent('compose:open', { detail: { href }, cancelable: true, bubbles: true });
        if (form.dispatchEvent(open)) window.location.href = href;
        say('draft handed to your mail client — hit send there', 'is-ok');
        if (window.track) window.track('contact_compose', { topic });   // topic only, never the message
      });
    }

    // The section's constellation converges on the two ways to reach out,
    // the same way the hero's field feeds the particle figure.
    const field = window.Constellation && window.Constellation.all().find((i) => i.presetName === 'contact');
    const mail = $('#mail-link');
    if (field && mail && !reduced) {
      let mailHot = false;
      mail.addEventListener('pointerenter', () => { mailHot = true; });
      mail.addEventListener('pointerleave', () => { mailHot = false; });
      const send = form && $('.composer__send', form);
      field.anchors = () => {
        const out = [];
        const t = performance.now() / 1000;
        const add = (el, act) => {
          const r = el.getBoundingClientRect();
          if (r.width) out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, act });
        };
        add(mail, mailHot ? 1 : 0.22 + Math.sin(t * 1.4) * 0.12);
        if (send) add(send, form.matches(':focus-within') ? 0.85 : 0.12);
        return out;
      };
    }
  }

  // ════════════════════════════════════════════════════════════
  //  Footer — the name, set edge to edge, lit by the pointer
  // ════════════════════════════════════════════════════════════
  function initFooter() {
    const name = $('[data-foot-name]');
    if (!name) return;

    const letters = [];
    $$('.foot__word', name).forEach((word) => {
      const text = word.textContent;
      word.textContent = '';
      [...text].forEach((ch) => {
        const span = document.createElement('span');
        span.className = 'foot__ch';
        span.textContent = ch;
        span.style.setProperty('--i', letters.length);
        word.appendChild(span);
        letters.push({ el: span, l: 0, shown: -1, cx: 0, cy: 0 });
      });
    });

    // Fit the line to the column exactly, whatever the fonts measure.
    const measure = document.createElement('span');
    measure.style.display = 'inline-block';
    while (name.firstChild) measure.appendChild(name.firstChild);
    name.appendChild(measure);
    let nameW = 0;
    function fit() {
      name.style.fontSize = '';
      const avail = name.clientWidth, natural = measure.offsetWidth;
      nameW = avail;
      if (!avail || !natural) return;
      const base = parseFloat(getComputedStyle(name).fontSize);
      name.style.fontSize = (base * (avail / natural) * 0.985).toFixed(2) + 'px';
      const box = name.getBoundingClientRect();
      letters.forEach((L) => {
        const r = L.el.getBoundingClientRect();
        L.cx = r.left + r.width / 2 - box.left;
        L.cy = r.top + r.height / 2 - box.top;
      });
    }
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    window.addEventListener('resize', fit);

    FX.inView(name, () => name.classList.add('is-in'), { threshold: 0.2 });

    const write = (L, v) => {
      if (Math.abs(v - L.shown) < 0.004) return;
      L.shown = v;
      L.el.style.setProperty('--l', v.toFixed(3));
    };
    if (reduced) { letters.forEach((L) => write(L, 0.9)); return; }

    let px = -9999, py = -9999, pointerIn = false;
    const foot = name.closest('.foot') || name;
    foot.addEventListener('pointermove', (e) => {
      const r = name.getBoundingClientRect();
      px = e.clientX - r.left; py = e.clientY - r.top; pointerIn = true;
    }, { passive: true });
    foot.addEventListener('pointerleave', () => { pointerIn = false; });

    FX.loop(name, (now) => {
      const radius = Math.max(140, nameW * 0.2);
      // Without a pointer (touch, or the cursor is elsewhere) a slow light crosses the name.
      const sweep = ((now / 5200) % 1.35) * (letters.length + 3) - 2;
      letters.forEach((L, i) => {
        const target = pointerIn
          ? Math.pow(FX.clamp(1 - Math.hypot(px - L.cx, (py - L.cy) * 0.6) / radius), 1.3)
          : FX.clamp(1 - Math.abs(i - sweep) / 2.4) * 0.85;
        L.l = FX.lerp(L.l, target, 0.11);
        write(L, L.l);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
