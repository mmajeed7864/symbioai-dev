/* Symbio Motion — GSAP/anime.js-grade feel, zero dependencies (2026-08-01).
   Reference language: gsap.com + animejs.com + animmasterlib.dev — split-text hero rise,
   scroll-triggered staggers, animated counters, pointer-depth cards, magnetic CTAs.
   Everything gates on prefers-reduced-motion and degrades to static. */
(function () {
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { document.documentElement.classList.add('motion-off'); return; }
  var touch = window.matchMedia('(pointer: coarse)').matches;

  /* 1 ── split-text hero rise: wrap words in spans, stagger them up */
  function splitRise(el, baseDelay) {
    if (!el || el.dataset.split) return;
    el.dataset.split = '1';
    var words = el.textContent.split(/(\s+)/);
    el.textContent = '';
    var i = 0;
    words.forEach(function (w) {
      if (/^\s+$/.test(w)) { el.appendChild(document.createTextNode(w)); return; }
      var s = document.createElement('span');
      s.className = 'sm-word';
      s.style.transitionDelay = (baseDelay + i * 70) + 'ms';
      s.textContent = w;
      el.appendChild(s);
      i++;
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('sm-in'); });
    });
  }
  var h1 = document.querySelector('.hero h1, main h1');
  if (h1) splitRise(h1, 120);
  var sub = document.querySelector('.hero .sub, main h1 + p');
  if (sub) { sub.classList.add('sm-fade'); setTimeout(function(){ sub.classList.add('sm-in'); }, 650); }

  /* 2 ── scroll-triggered staggered reveals: upgrade every [data-reveal] + section cards */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('sm-in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

  var autoTargets = document.querySelectorAll(
    '.product-card, .card, section .section__title, .product-menu > *, footer .btn');
  var k = 0;
  autoTargets.forEach(function (el) {
    if (el.classList.contains('sm-rise')) return;
    el.classList.add('sm-rise');
    el.style.transitionDelay = ((k % 3) * 90) + 'ms';
    k++;
    io.observe(el);
  });

  /* 3 ── animated counters: any element with data-count-to (or digits in .product-card__price) */
  function animateCount(el, to, suffix) {
    var start = null, dur = 1200;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * eased).toLocaleString() + (suffix || '');
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var cio = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      cio.unobserve(el);
      var m = el.textContent.match(/^([0-9,.]+)(.*)$/);
      var to = parseFloat((el.dataset.countTo || (m && m[1]) || '').replace(/,/g, ''));
      if (isFinite(to) && to > 1) animateCount(el, to, el.dataset.countSuffix || (m && m[2]) || '');
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('[data-count-to]').forEach(function (el) { cio.observe(el); });

  /* 4 ── pointer-depth tilt on product cards (desktop only, subtle, rAF-throttled) */
  if (!touch) {
    document.querySelectorAll('.product-card').forEach(function (card) {
      var raf = null;
      card.addEventListener('pointermove', function (ev) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = null;
          var r = card.getBoundingClientRect();
          var x = (ev.clientX - r.left) / r.width - 0.5;
          var y = (ev.clientY - r.top) / r.height - 0.5;
          card.style.transform =
            'perspective(900px) rotateY(' + (x * 5) + 'deg) rotateX(' + (-y * 4) + 'deg) translateY(-4px)';
        });
      });
      card.addEventListener('pointerleave', function () {
        card.style.transform = '';
      });
    });

    /* 5 ── magnetic primary CTAs */
    document.querySelectorAll('.btn--primary, .hero .btn, a[class*="btn"][href*="scan"]').forEach(function (b) {
      var raf = null;
      b.addEventListener('pointermove', function (ev) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = null;
          var r = b.getBoundingClientRect();
          var x = (ev.clientX - (r.left + r.width / 2)) / r.width;
          var y = (ev.clientY - (r.top + r.height / 2)) / r.height;
          b.style.transform = 'translate(' + (x * 6) + 'px,' + (y * 5) + 'px)';
        });
      });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });
  }

  /* 6 ── gentle parallax drift on hero mock panels + lane art while scrolling */
  var drifters = document.querySelectorAll('.hero [class*="mock"], .product-card__art');
  if (drifters.length) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var vh = window.innerHeight;
        drifters.forEach(function (el, idx) {
          var r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > vh) return;
          var p = (r.top + r.height / 2 - vh / 2) / vh;
          el.style.setProperty('--sm-drift', (p * (idx % 2 ? 10 : -14)) + 'px');
        });
      });
    }, { passive: true });
  }
}());
