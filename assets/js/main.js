/* Main — Lenis smooth scroll, GSAP registration, nav plumbing.
   All animation choreography lives in motion.js */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─────────────── Lenis smooth scroll ───────────────
  let lenis = null;
  if (window.Lenis && !reduced) {
    lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);

    // Let ScrollTrigger update on lenis scroll — but leave gsap.ticker alone
    // (double-driving it via lagSmoothing(0) + gsap.ticker.add can freeze the ticker).
    if (window.gsap && window.ScrollTrigger) {
      lenis.on('scroll', ScrollTrigger.update);
    }
  }

  // GSAP registration
  if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  // Expose for motion.js
  window.__lenis = lenis;

  // ─────────────── Nav scroll state ───────────────
  const nav = document.querySelector('.nav');
  function onScroll() {
    if (!nav) return;
    if (window.scrollY > 40) nav.classList.add('is-scrolled');
    else nav.classList.remove('is-scrolled');
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ─────────────── Nav active section ───────────────
  const sections = ['#work', '#experience', '#stack', '#dsa', '#contact']
    .map((sel) => document.querySelector(sel))
    .filter(Boolean);
  const navLinks = document.querySelectorAll('.nav__links a');
  function updateActive() {
    const y = window.scrollY + window.innerHeight * 0.35;
    let active = null;
    sections.forEach((s) => { if (s.offsetTop <= y) active = s.id; });
    navLinks.forEach((l) => {
      const href = l.getAttribute('href') || '';
      l.classList.toggle('is-active', href === '#' + active);
    });
  }
  window.addEventListener('scroll', updateActive, { passive: true });

  // ─────────────── Smooth anchor scroll via Lenis ───────────────
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target, { offset: -20, duration: 1.4 });
      else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });
  });

  // ─────────────── Mobile nav drawer ───────────────
  const toggle = document.querySelector('.nav__toggle');
  const drawer = document.querySelector('.nav-drawer');
  if (toggle && drawer) {
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      drawer.classList.toggle('is-open', open);
      drawer.setAttribute('aria-hidden', String(!open));
      document.body.style.overflow = open ? 'hidden' : '';
      if (lenis) open ? lenis.stop() : lenis.start();
    };
    toggle.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')));
    drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setTimeout(() => setOpen(false), 150)));
  }

  // ─────────────── Magnetic buttons ───────────────
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced) {
    document.querySelectorAll('.magnetic').forEach((el) => {
      const strength = 0.35;
      let raf;
      const onMove = (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - (rect.left + rect.width / 2);
        const y = e.clientY - (rect.top + rect.height / 2);
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
        });
      };
      const reset = () => {
        cancelAnimationFrame(raf);
        el.style.transition = 'transform 0.5s cubic-bezier(.16,1,.3,1)';
        el.style.transform = 'translate(0,0)';
        setTimeout(() => { el.style.transition = ''; }, 500);
      };
      el.addEventListener('mousemove', onMove);
      el.addEventListener('mouseleave', reset);
    });
  }
})();
