/**
 * core.js — loaded in <head> of every page (SPA + standalone + lab).
 * Single source of truth for: motion preferences, image URLs, header,
 * menu overlay, custom cursor and page transitions.
 *
 * Exposes window.Core. Page scripts (classic, non-module) use it as
 *   Core.img(url, 640)  ·  Core.reduceMotion.matches  ·  Core.ready(promise)
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  /* ════════════════════════════════════════════════════════
     MOTION + DATA PREFERENCES
  ════════════════════════════════════════════════════════ */
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  var coarsePointer = matchMedia('(pointer: coarse)');
  var saveData = !!(navigator.connection && navigator.connection.saveData);

  var DUR = { 1: 150, 2: 300, 3: 600 };
  function dur(n) { return reduceMotion.matches ? 0 : DUR[n]; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ════════════════════════════════════════════════════════
     IMAGES — Vercel Image Optimization over the WordPress originals
  ════════════════════════════════════════════════════════ */
  var IMG_WIDTHS = [128, 256, 640, 1080, 1600, 2048]; // must match vercel.json images.sizes
  var REMOTE_HOST = 'juanrozo.com';

  function snapWidth(w) {
    for (var i = 0; i < IMG_WIDTHS.length; i++) if (IMG_WIDTHS[i] >= w) return IMG_WIDTHS[i];
    return IMG_WIDTHS[IMG_WIDTHS.length - 1];
  }
  // config.js declares `const CONFIG` (a global lexical binding, not window.CONFIG)
  function cfg() { return typeof CONFIG !== 'undefined' ? CONFIG : {}; }

  function optimizerOn() {
    return cfg().imageOptimizer === 'vercel';
  }
  function isRemote(url) {
    try { return new URL(url, location.href).hostname === REMOTE_HOST; } catch (e) { return false; }
  }

  /** URL for `url` resized to width `w` (snapped to an allowed size). */
  function img(url, w, q) {
    if (!url) return '';
    w = snapWidth(w || 1080);
    if (url.charAt(0) === '/' && url.indexOf('/images/') === 0) {
      return url.split('?')[0] + '?w=' + w;          // local variants (server picks the file)
    }
    if (!isRemote(url) || !optimizerOn()) return url;
    return '/_vercel/image?url=' + encodeURIComponent(url) + '&w=' + w + '&q=' + (q || 75);
  }

  /** srcset over the allowed widths, never above the original width. */
  function srcset(url, maxW, q) {
    if (!url) return '';
    if (!optimizerOn() && url.indexOf('/images/') !== 0) return '';
    var list = IMG_WIDTHS.filter(function (w) { return w >= 256 && (!maxW || w <= snapWidth(maxW)); });
    return list.map(function (w) { return img(url, w, q) + ' ' + w + 'w'; }).join(', ');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Attribute string for an <img> built from a gallery item.
   * opts: { w (default src width), sizes, eager, high, q, cls }
   */
  function imgAttrs(item, opts) {
    opts = opts || {};
    var url = item.url || item.image || '';
    var W = item.width || 0, H = item.height || 0;
    var a = [
      'src="' + esc(img(url, opts.w || 1080, opts.q)) + '"',
      'alt="' + esc(item.alt || item.title || '') + '"',
      'decoding="async"',
      'loading="' + (opts.eager || opts.high ? 'eager' : 'lazy') + '"',
    ];
    var set = srcset(url, W, opts.q);
    if (set) { a.push('srcset="' + esc(set) + '"'); a.push('sizes="' + esc(opts.sizes || '100vw') + '"'); }
    if (W && H) { a.push('width="' + W + '"'); a.push('height="' + H + '"'); }
    if (opts.high) a.push('fetchpriority="high"');
    if (opts.cls) a.push('class="' + esc(opts.cls) + '"');
    if (opts.draggable === false) a.push('draggable="false"');
    return a.join(' ');
  }

  /** Aspect ratio (w/h) from data, or null. */
  function ratio(item) {
    return item && item.width && item.height ? item.width / item.height : null;
  }

  /** Resolves when the image is decoded (or failed), max `cap` ms. */
  function decoded(el, cap) {
    if (!el) return Promise.resolve();
    var p = (el.complete && el.naturalWidth)
      ? (el.decode ? el.decode().catch(function () {}) : Promise.resolve())
      : new Promise(function (res) {
          el.addEventListener('load', function () { (el.decode ? el.decode() : Promise.resolve()).catch(function () {}).then(res); }, { once: true });
          el.addEventListener('error', res, { once: true });
        });
    return cap ? Promise.race([p, sleep(cap)]) : p;
  }

  /* Optimizer safety net: if /_vercel/image fails, fall back to the original. */
  doc.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG' || t.dataset.fallback) return;
    var src = t.currentSrc || t.src || '';
    if (src.indexOf('/_vercel/image') === -1) return;
    var m = /[?&]url=([^&]+)/.exec(src);
    if (!m) return;
    t.dataset.fallback = '1';
    t.removeAttribute('srcset');
    t.src = decodeURIComponent(m[1]);
  }, true);

  /* Placeholder containers (.ph) get .is-loaded once their image decodes. */
  doc.addEventListener('load', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.parentElement && t.parentElement.classList.contains('ph')) {
      t.parentElement.classList.add('is-loaded');
    }
  }, true);

  /* ════════════════════════════════════════════════════════
     PAGE TRANSITIONS
     Leaving: a wipe covers the page, then the browser navigates.
     Arriving: the new page starts covered (html.is-arriving) and
     reveals once its first image is decoded (max 800 ms).
  ════════════════════════════════════════════════════════ */
  var ARRIVE_KEY = 'jr:arrive';
  try {
    if (sessionStorage.getItem(ARRIVE_KEY)) {
      sessionStorage.removeItem(ARRIVE_KEY);
      if (!reduceMotion.matches) root.classList.add('is-arriving');
    }
  } catch (e) { /* storage blocked: no cover */ }

  var readyList = [];
  function ready(p) { readyList.push(Promise.resolve(p)); }

  function reveal() {
    if (!root.classList.contains('is-arriving')) return;
    root.classList.add('is-revealing');
    setTimeout(function () { root.classList.remove('is-arriving', 'is-revealing'); }, dur(3) + 50);
  }

  function autoReady() {
    var first = doc.querySelector('img[fetchpriority="high"]');
    return first ? decoded(first) : Promise.resolve();
  }

  doc.addEventListener('DOMContentLoaded', function () {
    // Next task: lets page scripts that boot on DOMContentLoaded register first
    setTimeout(function () {
      var all = readyList.length ? Promise.all(readyList) : autoReady();
      Promise.race([all, sleep(800)]).then(reveal);
    }, 0);
  });

  function transitionDone(el, ms) {
    return new Promise(function (res) {
      var done = false;
      function fin() { if (!done) { done = true; res(); } }
      el.addEventListener('transitionend', fin, { once: true });
      setTimeout(fin, ms + 60);
    });
  }

  var wiping = false;

  /** In-document wipe: cover, run swap() (may return a readiness promise), uncover. */
  function wipe(swap) {
    if (reduceMotion.matches) return Promise.resolve(swap());
    if (wiping) return Promise.resolve();
    wiping = true;
    var el = doc.createElement('div');
    el.className = 'wipe';
    doc.body.appendChild(el);
    void el.offsetHeight;
    el.classList.add('is-in');
    return transitionDone(el, dur(2))
      .then(function () { return Promise.race([Promise.resolve(swap()), sleep(800)]); })
      .then(function () {
        el.classList.remove('is-in');
        el.classList.add('is-out');
        return transitionDone(el, dur(3));
      })
      .then(function () { el.remove(); wiping = false; });
  }

  /** Cross-document navigation with the wipe. */
  function go(url) {
    if (wiping) return;
    try { sessionStorage.setItem(ARRIVE_KEY, '1'); } catch (e) {}
    if (reduceMotion.matches) { location.assign(url); return; }
    wiping = true;
    var el = doc.createElement('div');
    el.className = 'wipe';
    doc.body.appendChild(el);
    void el.offsetHeight;
    el.classList.add('is-in');
    transitionDone(el, dur(2)).then(function () { location.assign(url); });
  }

  // Back/forward cache: never come back to a page still covered by the wipe.
  addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    wiping = false;
    doc.querySelectorAll('.wipe').forEach(function (w) { w.remove(); });
    root.classList.remove('is-arriving', 'is-revealing');
    try { sessionStorage.removeItem(ARRIVE_KEY); } catch (err) {}
    closeMenu({ instant: true });
  });

  /* Same-origin link interception (plain left clicks only). */
  function isPlainClick(e) {
    return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  }
  function samePath(a, b) {
    return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  }

  doc.addEventListener('click', function (e) {
    if (e.defaultPrevented || !isPlainClick(e)) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target && a.target !== '_self' || a.hasAttribute('download') || a.dataset.noTransition !== undefined) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (url.pathname.indexOf('/admin') === 0 || url.pathname.indexOf('/api/') === 0) return;
    if (url.hash && samePath(url.pathname, location.pathname)) return;

    e.preventDefault();
    if (samePath(url.pathname, location.pathname) && url.search === location.search) {
      closeMenu();
      return;
    }
    if (Core.onRoute && Core.onRoute(url) === true) return;
    go(url.pathname + url.search + url.hash);
  });

  /* ════════════════════════════════════════════════════════
     GALLERIES — counter, wheel gestures, horizontal scroll engine
  ════════════════════════════════════════════════════════ */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** "03 / 21" — one format for every gallery. */
  function counter(i, total) { return pad2(i + 1) + ' / ' + pad2(total); }

  /** Wheel delta in pixels whatever the deltaMode (Firefox mice report lines). */
  function wheelPx(e, axis, el) {
    var d = axis === 'x' ? e.deltaX : e.deltaY;
    var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? ((el && el.clientWidth) || innerWidth) : 1;
    return d * unit;
  }

  /**
   * Step galleries: one step per wheel/trackpad gesture. A gesture starts on
   * the first meaningful delta and ends after `idle` ms without events, so
   * long trackpad momentum never advances twice.
   */
  function wheelSteps(el, onStep, idle) {
    idle = idle || 150;
    var active = false, timer = null;
    function onWheel(e) {
      var dx = wheelPx(e, 'x', el), dy = wheelPx(e, 'y', el);
      var d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      e.preventDefault();
      clearTimeout(timer);
      timer = setTimeout(function () { active = false; }, idle);
      if (active || Math.abs(d) < 4) return;
      active = true;
      onStep(d > 0 ? 1 : -1);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return function () { el.removeEventListener('wheel', onWheel); clearTimeout(timer); };
  }

  /**
   * Horizontal gallery engine: a single interpolated target drives wheel,
   * drag (Pointer Events), thumbnails and keyboard. Native touch scrolling
   * and trackpad horizontal swipes are left to the browser.
   *   hscroll(el, { items, onChange(i) }) → { goTo, index, destroy }
   */
  function hscroll(el, opts) {
    opts = opts || {};
    var items = Array.prototype.slice.call(opts.items || el.children);
    var target = el.scrollLeft, raf = null, current = 0;
    var max = function () { return el.scrollWidth - el.clientWidth; };
    var clamp = function (v) { return Math.max(0, Math.min(max(), v)); };

    function step() {
      var cur = el.scrollLeft, next = cur + (target - cur) * 0.18;
      el.scrollLeft = next;
      raf = Math.abs(target - next) > 0.5 ? requestAnimationFrame(step) : null;
      if (!raf) el.scrollLeft = target;
    }
    function animate() {
      if (reduceMotion.matches) { el.scrollLeft = target; return; }
      if (!raf) raf = requestAnimationFrame(step);
    }
    function centerOf(i) {
      var it = items[i];
      return clamp(it.offsetLeft + it.offsetWidth / 2 - el.clientWidth / 2);
    }
    function goTo(i) {
      i = Math.max(0, Math.min(items.length - 1, i));
      target = centerOf(i);
      animate();
      setIndex(i);
    }
    function setIndex(i) {
      if (i === current) return;
      current = i;
      if (opts.onChange) opts.onChange(i);
    }

    function onWheel(e) {
      if (coarsePointer.matches) return;
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) { target = el.scrollLeft; return; } // trackpad: native
      e.preventDefault();
      target = clamp(target + wheelPx(e, 'y', el));
      animate();
    }
    function onScroll() {
      if (!raf && !dragging) target = el.scrollLeft;
      var edge = edgeIndex();
      if (edge !== -1) setIndex(edge);
    }

    // Drag with a mouse/pen (touch scrolls natively)
    var dragging = false, moved = false, startX = 0, startLeft = 0, lastX = 0, lastT = 0, vel = 0, pid = null;
    function onDown(e) {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      dragging = true; moved = false; pid = e.pointerId;
      startX = lastX = e.clientX; startLeft = el.scrollLeft; lastT = performance.now(); vel = 0;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }
    function onMove(e) {
      if (!dragging || e.pointerId !== pid) return;
      var dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        try { el.setPointerCapture(pid); } catch (err) {}
        el.classList.add('is-dragging');
      }
      if (!moved) return;
      var now = performance.now();
      vel = (e.clientX - lastX) / Math.max(1, now - lastT);
      lastX = e.clientX; lastT = now;
      el.scrollLeft = target = clamp(startLeft - dx);
    }
    function onUp(e) {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      el.classList.remove('is-dragging');
      if (!moved) return;
      target = clamp(el.scrollLeft - vel * (reduceMotion.matches ? 0 : 300)); // project the release velocity
      animate();
    }
    function onClick(e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }

    function onKey(e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
      else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
      else if (e.key === 'End') { e.preventDefault(); goTo(items.length - 1); }
    }

    // Active item = the one crossing the centre line (first/last at the edges)
    function edgeIndex() {
      if (el.scrollLeft < 2) return 0;
      if (el.scrollLeft > max() - 2) return items.length - 1;
      return -1;
    }
    var io = new IntersectionObserver(function (entries) {
      var edge = edgeIndex();
      if (edge !== -1) { setIndex(edge); return; }
      entries.forEach(function (en) { if (en.isIntersecting) setIndex(items.indexOf(en.target)); });
    }, { root: el, rootMargin: '0px -50% 0px -50%', threshold: 0 });
    items.forEach(function (it) { io.observe(it); });

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    el.addEventListener('keydown', onKey);
    if (opts.onChange) opts.onChange(0);

    return {
      goTo: goTo,
      index: function () { return current; },
      destroy: function () {
        io.disconnect();
        if (raf) cancelAnimationFrame(raf);
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('scroll', onScroll);
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('click', onClick, true);
        el.removeEventListener('keydown', onKey);
      },
    };
  }

  /* ════════════════════════════════════════════════════════
     FOCUS TRAP (menu, viewers)
  ════════════════════════════════════════════════════════ */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function trapFocus(container) {
    function onKey(e) {
      if (e.key !== 'Tab') return;
      var items = Array.prototype.filter.call(container.querySelectorAll(FOCUSABLE), function (el) {
        return el.offsetParent !== null || el === doc.activeElement;
      });
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (doc.activeElement === first || !container.contains(doc.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (doc.activeElement === last || !container.contains(doc.activeElement))) {
        e.preventDefault(); first.focus();
      }
    }
    doc.addEventListener('keydown', onKey);
    return function release() { doc.removeEventListener('keydown', onKey); };
  }

  /* ════════════════════════════════════════════════════════
     HEADER + MENU OVERLAY
  ════════════════════════════════════════════════════════ */
  var overlay, menuBtn, menuClose, navEl, previewEl;
  var menuOpen = false, releaseTrap = null, closeTimer = null;
  var previewUrls = {};

  function pageHref(p) {
    var c = cfg();
    return p.id === c.homePage ? '/' : '/' + String(p.slug || p.id).replace(/^\/+/, '');
  }

  function buildHeader() {
    var c = cfg();
    var logoUrl = '/images/logo.svg';
    var name = esc(c.name || 'Juan Rozo');

    if (doc.getElementById('main')) {
      doc.body.insertAdjacentHTML('afterbegin', '<a class="skip-link" href="#main" data-no-transition>Skip to content</a>');
    }

    var header = doc.createElement('header');
    header.className = 'site-header';
    header.innerHTML =
      '<a href="/" class="site-logo"><img src="' + logoUrl + '" alt="' + name + '" width="216" height="40" /></a>' +
      '<button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="menu-overlay">' +
        '<span aria-hidden="true">+</span><span class="visually-hidden">Menu</span>' +
      '</button>';
    var skip = doc.querySelector('.skip-link');
    if (skip) skip.after(header); else doc.body.prepend(header);

    overlay = doc.createElement('div');
    overlay.className = 'menu-overlay';
    overlay.id = 'menu-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Menu');
    overlay.inert = true;
    overlay.innerHTML =
      '<div class="menu-overlay__top">' +
        '<a href="/" class="menu-name"><img src="' + logoUrl + '" alt="' + name + ' — Home" width="216" height="40" /></a>' +
        '<button type="button" class="menu-close" id="menu-close"><span aria-hidden="true">+</span><span class="visually-hidden">Close menu</span></button>' +
      '</div>' +
      '<nav class="menu-nav" id="menu-nav" aria-label="Main"></nav>' +
      '<div class="menu-footer" id="menu-footer"></div>' +
      '<img class="menu-preview" alt="" aria-hidden="true" />';
    header.after(overlay);

    menuBtn = header.querySelector('.menu-btn');
    menuClose = overlay.querySelector('.menu-close');
    navEl = overlay.querySelector('.menu-nav');
    previewEl = overlay.querySelector('.menu-preview');

    buildNav();
    buildFooter(overlay.querySelector('.menu-footer'));

    menuBtn.addEventListener('click', openMenu);
    menuClose.addEventListener('click', function () { closeMenu(); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuOpen) { e.preventDefault(); closeMenu(); }
    });
  }

  function buildNav() {
    var c = cfg();
    var list = (c.menuPages || []).filter(function (p) {
      return p && p.id && p.menuLabel && String(p.slug || '').indexOf('lab/') !== 0;
    });
    navEl.innerHTML = '';
    list.forEach(function (p, i) {
      var a = doc.createElement('a');
      a.className = 'menu-link';
      a.href = pageHref(p);
      a.dataset.page = p.id;
      a.style.setProperty('--i', i);
      a.innerHTML = '<span class="menu-link-lbl">' + esc(p.menuLabel) + '</span>';
      navEl.appendChild(a);

      var gallery = (c.pageGalleries && c.pageGalleries[p.id]) || [];
      previewUrls[p.id] = p.id === 'info' || p.template === 'info'
        ? (c.about && c.about.photo) || ''
        : (gallery[0] && (gallery[0].url || gallery[0].image)) || '';

      a.addEventListener('mouseenter', function () { onLinkHover(a, true); prefetch(a.href); });
      a.addEventListener('mouseleave', function () { onLinkHover(a, false); });
      a.addEventListener('focus', function () { prefetch(a.href); });
    });
    setCurrent(location.pathname);
  }

  function buildFooter(el) {
    var c = cfg();
    var info = (c.pageContent && c.pageContent.info) || {};
    var links = [];
    if (c.instagram) links.push([c.instagramUrl || '#', c.instagram, 'Portfolio']);
    if (info.instagram2Label) links.push([info.instagram2Url || '#', info.instagram2Label, 'Personal']);
    el.innerHTML =
      '<span class="menu-footer-left">Melbourne</span>' +
      '<div class="menu-footer-right">' +
        links.map(function (l) {
          return '<a href="' + esc(l[0]) + '" target="_blank" rel="noopener" class="menu-footer-link">' +
            esc(l[1]) + ' <span class="menu-footer-note">' + l[2] + '</span></a>';
        }).join('') +
      '</div>';
  }

  /** Marks the menu link for `path` with aria-current. */
  function setCurrent(path) {
    if (!navEl) return;
    navEl.querySelectorAll('.menu-link').forEach(function (a) {
      var match = samePath(new URL(a.href).pathname, path);
      if (match) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  var prefetched = {};
  function prefetch(href) {
    if (saveData || prefetched[href]) return;
    try { if (samePath(new URL(href).pathname, location.pathname)) return; } catch (e) { return; }
    prefetched[href] = true;
    var l = doc.createElement('link');
    l.rel = 'prefetch';
    l.href = href;
    doc.head.appendChild(l);
  }

  var hoverTimer = null, currentHover = null;
  function onLinkHover(a, on) {
    if (!finePointer.matches) return;
    if (on) {
      currentHover = a;
      navEl.querySelectorAll('.hovered').forEach(function (x) { x.classList.remove('hovered'); });
      a.classList.add('hovered');
      navEl.classList.add('has-hover');
      overlay.classList.add('has-item-hover');
      var url = previewUrls[a.dataset.page];
      if (url) {
        previewEl.src = img(url, 640);
        previewEl.classList.add('visible');
      } else {
        previewEl.classList.remove('visible');
      }
    } else {
      a.classList.remove('hovered');
      if (currentHover === a) currentHover = null;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () {
        if (currentHover) return;
        navEl.classList.remove('has-hover');
        overlay.classList.remove('has-item-hover');
        previewEl.classList.remove('visible');
      }, 50);
    }
  }

  function preloadPreviews() {
    if (saveData || !finePointer.matches) return;
    Object.keys(previewUrls).forEach(function (k) {
      if (previewUrls[k]) { var i = new Image(); i.src = img(previewUrls[k], 640); }
    });
  }

  function openMenu() {
    if (menuOpen || !overlay) return;
    menuOpen = true;
    clearTimeout(closeTimer);
    overlay.classList.remove('closing');
    overlay.inert = false;
    overlay.classList.add('open');
    doc.body.classList.add('menu-open');
    root.classList.remove('header-hidden');
    menuBtn.setAttribute('aria-expanded', 'true');
    releaseTrap = trapFocus(overlay);
    var first = navEl.querySelector('.menu-link') || menuClose;
    first.focus({ preventScroll: true });
    preloadPreviews();
  }

  function closeMenu(opts) {
    if (!overlay || (!menuOpen && !(opts && opts.instant))) return;
    var wasOpen = menuOpen;
    menuOpen = false;
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    overlay.inert = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    doc.body.classList.remove('menu-open');
    navEl.classList.remove('has-hover');
    overlay.classList.remove('has-item-hover');
    previewEl.classList.remove('visible');

    if (opts && opts.instant) {
      overlay.style.transition = 'none';
      overlay.classList.remove('open', 'closing');
      void overlay.offsetHeight;
      overlay.style.transition = '';
    } else {
      overlay.classList.add('closing');
      overlay.classList.remove('open');
      closeTimer = setTimeout(function () { overlay.classList.remove('closing'); }, 450 + DUR[1]);
    }
    if (wasOpen && !(opts && opts.keepFocus)) menuBtn.focus({ preventScroll: true });
  }

  /* Header hides while scrolling down, returns when scrolling up. */
  function initHeaderScroll() {
    var lastY = scrollY, ticking = false;
    addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var y = scrollY;
        if (menuOpen || y < 80) root.classList.remove('header-hidden');
        else if (y > lastY + 6) root.classList.add('header-hidden');
        else if (y < lastY - 6) root.classList.remove('header-hidden');
        lastY = y;
      });
    }, { passive: true });
    doc.addEventListener('focusin', function (e) {
      if (e.target.closest && e.target.closest('.site-header')) root.classList.remove('header-hidden');
    });
  }

  /* ════════════════════════════════════════════════════════
     CUSTOM CURSOR — only for fine pointers with hover
  ════════════════════════════════════════════════════════ */
  var cursor = null;

  function createCursor() {
    if (cursor) return;
    var ring = doc.createElement('div');
    ring.className = 'cursor is-hidden';
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = '<span class="cursor__ring"></span><span class="cursor__label"></span>';
    var dot = doc.createElement('div');
    dot.className = 'cursor-dot is-hidden';
    dot.setAttribute('aria-hidden', 'true');
    doc.body.append(ring, dot);

    var label = ring.querySelector('.cursor__label');
    var mx = 0, my = 0, rx = 0, ry = 0, raf = null;
    var LERP = 0.3;

    function step() {
      rx += (mx - rx) * LERP;
      ry += (my - ry) * LERP;
      if (Math.abs(mx - rx) < 0.1 && Math.abs(my - ry) < 0.1) { rx = mx; ry = my; raf = null; }
      else raf = requestAnimationFrame(step);
      ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
    }
    function onMove(e) {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
      if (ring.classList.contains('is-hidden')) {
        ring.classList.remove('is-hidden'); dot.classList.remove('is-hidden');
        rx = mx; ry = my;
      }
      if (reduceMotion.matches) { rx = mx; ry = my; ring.style.transform = dot.style.transform; return; }
      if (!raf) raf = requestAnimationFrame(step);
    }
    function onLeave(e) {
      if (!e.relatedTarget) { ring.classList.add('is-hidden'); dot.classList.add('is-hidden'); }
    }
    function stateFor(t) {
      var el = t && t.closest && t.closest('[data-cursor], a, button, [role="button"], label');
      if (!el) return null;
      var v = el.getAttribute('data-cursor');
      if (v === 'none') return null;
      return v ? { label: v } : { link: true };
    }
    function onOver(e) {
      var s = stateFor(e.target);
      ring.classList.toggle('cursor--link', !!(s && s.link));
      ring.classList.toggle('cursor--label', !!(s && s.label));
      if (s && s.label) label.textContent = s.label;
    }
    function onDown() { ring.classList.add('cursor--active'); }
    function onUp() { ring.classList.remove('cursor--active'); }

    doc.addEventListener('mousemove', onMove, { passive: true });
    doc.addEventListener('mouseout', onLeave);
    doc.addEventListener('pointerover', onOver);
    doc.addEventListener('pointerdown', onDown);
    doc.addEventListener('pointerup', onUp);

    cursor = {
      el: ring,
      destroy: function () {
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseout', onLeave);
        doc.removeEventListener('pointerover', onOver);
        doc.removeEventListener('pointerdown', onDown);
        doc.removeEventListener('pointerup', onUp);
        if (raf) cancelAnimationFrame(raf);
        ring.remove(); dot.remove();
        cursor = null;
      },
    };
  }

  function syncCursor() {
    if (finePointer.matches) { root.classList.add('has-custom-cursor'); createCursor(); }
    else { root.classList.remove('has-custom-cursor'); if (cursor) cursor.destroy(); }
  }

  /* ════════════════════════════════════════════════════════
     BOOT
  ════════════════════════════════════════════════════════ */
  function boot() {
    buildHeader();
    initHeaderScroll();
    syncCursor();
    (finePointer.addEventListener ? finePointer.addEventListener('change', syncCursor) : finePointer.addListener(syncCursor));
  }
  if (finePointer.matches) root.classList.add('has-custom-cursor');
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  var Core = window.Core = {
    reduceMotion: reduceMotion,
    finePointer: finePointer,
    coarsePointer: coarsePointer,
    saveData: saveData,
    dur: dur,
    sleep: sleep,
    esc: esc,
    img: img,
    srcset: srcset,
    imgAttrs: imgAttrs,
    ratio: ratio,
    decoded: decoded,
    ready: ready,
    wipe: wipe,
    go: go,
    onRoute: null,       // SPA hook: (URL) => true when handled in-document
    trapFocus: trapFocus,
    counter: counter,
    wheelPx: wheelPx,
    wheelSteps: wheelSteps,
    hscroll: hscroll,
    openMenu: openMenu,
    closeMenu: closeMenu,
    setCurrent: setCurrent,
  };
})();
