/* Analytics — GA4 + meaningful interaction events.
   ──────────────────────────────────────────────────────────────────────────
   SET YOUR MEASUREMENT ID BELOW. Until it is a real "G-XXXX" id, nothing is
   loaded and no network request is made — the page ships clean. Replace the
   placeholder and redeploy to switch analytics on. Nothing else needs editing.
*/
(function () {
  'use strict';

  var GA_MEASUREMENT_ID = 'G-EQ1LP4X2W7'; // ← replace with your real GA4 id

  var idLooksReal = /^G-[A-Z0-9]{6,12}$/.test(GA_MEASUREMENT_ID) &&
                    GA_MEASUREMENT_ID !== 'G-XXXXXXXXXX';

  // gtag stub is always defined so track() never throws; it only reaches the
  // network once a real id has loaded the GA library.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  if (idLooksReal) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    document.head.appendChild(s);
    gtag('js', new Date());
    // anonymize_ip is default in GA4; send_page_view fires the initial view.
    gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
  }

  // Single funnel for every event. No-ops safely when GA is not configured, so
  // the wiring below is identical whether or not an id is set.
  function track(name, params) {
    try { window.gtag('event', name, params || {}); } catch (e) { /* never break UX */ }
  }
  window.track = track;

  var NETWORK_EVENT = {
    github: 'github_click',
    linkedin: 'linkedin_click',
    leetcode: 'leetcode_click',
    codechef: 'codechef_click',
    hackerrank: 'hackerrank_click',
    email: 'email_click'
  };

  document.addEventListener('DOMContentLoaded', function () {
    // ── Outbound profile / contact clicks (delegated; survives re-renders) ──
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('a[href]') : null;
      if (!el) return;
      var href = el.getAttribute('href') || '';
      var social = el.getAttribute('data-social');

      if (social && NETWORK_EVENT[social]) {
        track(NETWORK_EVENT[social], {
          link_domain: social,
          link_url: href,
          transport_type: 'beacon'
        });
        track('outbound_click', { network: social, link_url: href, transport_type: 'beacon' });
        return;
      }

      // Résumé / CV (present only once a résumé link is added to the page).
      if (el.matches('[data-analytics="resume"]') || /\.pdf($|\?)/i.test(href)) {
        track('resume_download', { link_url: href, transport_type: 'beacon' });
        return;
      }

      // Mail links anywhere else on the page.
      if (href.indexOf('mailto:') === 0) {
        track('email_click', { link_url: href });
        return;
      }

      // Hero call-to-action buttons.
      if (el.matches('.btn')) {
        track('cta_click', {
          label: (el.textContent || '').trim().slice(0, 40),
          link_url: href,
          transport_type: /^https?:/.test(href) ? 'beacon' : undefined
        });
        return;
      }

      // Primary navigation (desktop + drawer).
      if (el.matches('[data-nav]') || el.closest('.nav-drawer')) {
        if (href.charAt(0) === '#') {
          track('nav_click', { section: href.slice(1) });
        }
      }
    }, true);

    // ── Theme toggle ──
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        // read after the toggle applies on the next frame
        requestAnimationFrame(function () {
          var theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
          track('theme_toggle', { theme: theme });
        });
      });
    });

    // ── Project reach (fires once when a case scrolls into view) ──
    var seen = {};
    var cases = document.querySelectorAll('article.case[data-case]');
    if (cases.length && 'IntersectionObserver' in window) {
      var caseObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var key = en.target.getAttribute('data-case');
          if (seen['case:' + key]) return;
          seen['case:' + key] = 1;
          var title = en.target.querySelector('.case__title, h3');
          track('project_view', {
            project: key,
            project_name: title ? title.textContent.trim().slice(0, 60) : key
          });
        });
      }, { threshold: 0.45 });
      cases.forEach(function (c) { caseObs.observe(c); });
    }

    // ── Section reach (once each), including the contact section ──
    var sections = document.querySelectorAll('section[id]');
    if (sections.length && 'IntersectionObserver' in window) {
      var secObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var id = en.target.id;
          if (seen['sec:' + id]) return;
          seen['sec:' + id] = 1;
          track('section_view', { section: id });
          if (id === 'contact') track('contact_reached', {});
        });
      }, { threshold: 0.4 });
      sections.forEach(function (s) { secObs.observe(s); });
    }
  });
})();
