/**
 * viewer.js — full-screen photo viewer shared by the SPA and /lab grids.
 * A real modal dialog: focus moves in and is trapped, Escape closes, focus
 * returns to the photo that opened it. ←/→, swipe and buttons change photo;
 * neighbours are preloaded. Opening plays the RepeatingImageTransition
 * (GSAP, when present); reduced motion opens instantly.
 *
 *   Viewer.open(items, index, sourceImg, { onOpen, onClose })
 */
(function () {
  'use strict';

  var Core = window.Core;
  var el, imgWrap, imgEl, captionEl, counterEl, prevBtn, nextBtn, closeBtn;
  var items = [], index = 0, opts = {}, returnTo = null, releaseTrap = null;
  var isOpen = false, busy = false;

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Photo viewer');
    el.inert = true;
    el.innerHTML =
      '<figure class="viewer__figure">' +
        '<div class="viewer__img"><img alt="" draggable="false" decoding="async" /></div>' +
        '<figcaption class="viewer__caption" aria-live="polite"></figcaption>' +
      '</figure>' +
      '<p class="viewer__counter gallery-counter" aria-hidden="true"></p>' +
      '<button type="button" class="viewer__nav viewer__nav--prev"><span aria-hidden="true">←</span><span class="visually-hidden">Previous photo</span></button>' +
      '<button type="button" class="viewer__nav viewer__nav--next"><span aria-hidden="true">→</span><span class="visually-hidden">Next photo</span></button>' +
      '<button type="button" class="viewer__close"><span aria-hidden="true">+</span><span class="visually-hidden">Close viewer</span></button>';
    document.body.appendChild(el);
    imgWrap = el.querySelector('.viewer__img');
    imgEl = imgWrap.querySelector('img');
    captionEl = el.querySelector('.viewer__caption');
    counterEl = el.querySelector('.viewer__counter');
    prevBtn = el.querySelector('.viewer__nav--prev');
    nextBtn = el.querySelector('.viewer__nav--next');
    closeBtn = el.querySelector('.viewer__close');

    prevBtn.addEventListener('click', function () { go(-1); });
    nextBtn.addEventListener('click', function () { go(1); });
    closeBtn.addEventListener('click', close);
    el.addEventListener('click', function (e) { if (e.target === el || e.target.classList.contains('viewer__figure')) close(); });
    document.addEventListener('keydown', function (e) {
      if (!isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    });

    // Swipe (touch / pen)
    var sx = 0, sy = 0, tracking = false;
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      tracking = true; sx = e.clientX; sy = e.clientY;
    });
    el.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
    });
    el.addEventListener('pointercancel', function () { tracking = false; });
  }

  function url(item) { return item.url || item.image || ''; }

  function caption(item) {
    var parts = [];
    if (item.title || item.alt) parts.push('<span class="viewer__title">' + Core.esc(item.title || item.alt) + '</span>');
    var credit = [item.client, item.role].filter(Boolean).map(Core.esc).join(' · ');
    if (credit) parts.push('<span class="viewer__credit">' + credit + '</span>');
    return parts.join('');
  }

  function render(i) {
    var item = items[i];
    imgEl.src = Core.img(url(item), 1600, 85);
    imgEl.srcset = Core.srcset(url(item), item.width, 85);
    imgEl.sizes = '90vw';
    imgEl.alt = item.alt || item.title || '';
    if (item.width && item.height) { imgEl.width = item.width; imgEl.height = item.height; }
    else { imgEl.removeAttribute('width'); imgEl.removeAttribute('height'); }
    captionEl.innerHTML = caption(item);
    counterEl.textContent = Core.counter(i, items.length);
    var multi = items.length > 1;
    prevBtn.hidden = nextBtn.hidden = !multi;
    preload(i + 1); preload(i - 1);
  }

  function preload(i) {
    if (Core.saveData || i < 0 || i >= items.length) return;
    var p = new Image();
    p.sizes = '90vw';
    p.srcset = Core.srcset(url(items[i]), items[i].width, 85);
    p.src = Core.img(url(items[i]), 1600, 85);
  }

  function go(dir) {
    if (!isOpen || busy || items.length < 2) return;
    index = (index + dir + items.length) % items.length;
    if (Core.reduceMotion.matches) { render(index); return; }
    busy = true;
    imgWrap.classList.add('is-swapping');
    setTimeout(function () {
      render(index);
      Core.decoded(imgEl, 600).then(function () {
        imgWrap.classList.remove('is-swapping');
        busy = false;
      });
    }, Core.dur(1));
  }

  function open(list, i, sourceImg, options) {
    build();
    if (isOpen || busy) return;
    items = list; index = i; opts = options || {};
    returnTo = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : sourceImg && sourceImg.closest('[tabindex], a, button');
    busy = true;

    var startSrc = sourceImg ? (sourceImg.currentSrc || sourceImg.src) : '';
    render(index);
    if (startSrc) imgEl.src = startSrc;   // cached grid image first — upgraded below
    imgEl.removeAttribute('srcset');

    el.inert = false;
    el.classList.add('is-open');
    document.documentElement.classList.add('viewer-open');
    releaseTrap = Core.trapFocus(el);
    if (opts.onOpen) opts.onOpen();

    function done() {
      busy = false; isOpen = true;
      closeBtn.focus({ preventScroll: true });
      // upgrade to the large image for the current photo
      var item = items[index];
      imgEl.srcset = Core.srcset(url(item), item.width, 85);
      imgEl.src = Core.img(url(item), 1600, 85);
    }

    requestAnimationFrame(function () {
      if (Core.reduceMotion.matches || !window.gsap || !sourceImg) {
        el.classList.add('is-visible');
        setTimeout(done, Core.dur(2));
        return;
      }
      rit(sourceImg, startSrc, done);
    });
  }

  /* RepeatingImageTransition: copies of the photo step from the grid to the panel */
  function rit(startEl, src, done) {
    var gsap = window.gsap;
    var lerp = function (a, b, t) { return a + (b - a) * t; };
    var STEPS = 5, DUR = 0.35, INT = 0.05, PAUSE = 0.14;
    var cp = { from: 'inset(100% 0% 0% 0%)', reveal: 'inset(0% 0% 0% 0%)', hide: 'inset(0% 0% 100% 0%)' };
    el.classList.add('is-visible', 'is-rit');
    var a = startEl.getBoundingClientRect(), b = imgWrap.getBoundingClientRect();
    for (var i = 1; i <= STEPS; i++) {
      var t = i / (STEPS + 1);
      var w = lerp(a.width, b.width, t), h = lerp(a.height, b.height, t);
      var cx = lerp(a.left + a.width / 2, b.left + b.width / 2, t), cy = lerp(a.top + a.height / 2, b.top + b.height / 2, t);
      var m = document.createElement('div');
      m.className = 'rit-mover';
      gsap.set(m, { backgroundImage: 'url("' + src + '")', left: cx - w / 2, top: cy - h / 2, width: w, height: h, clipPath: cp.hide, zIndex: 1500 + i });
      document.body.appendChild(m);
      gsap.timeline({ delay: (i - 1) * INT })
        .fromTo(m, { opacity: 0.4, clipPath: cp.hide }, { opacity: 1, clipPath: cp.reveal, duration: DUR, ease: 'sine.in' })
        .to(m, { clipPath: cp.from, duration: DUR, ease: 'sine' }, '+=' + PAUSE)
        .call(function (node) { node.remove(); }, [m]);
    }
    gsap.fromTo(imgWrap, { clipPath: cp.hide }, {
      clipPath: cp.reveal, duration: DUR * 2, ease: 'sine.inOut', delay: STEPS * INT,
      onComplete: function () { el.classList.remove('is-rit'); imgWrap.style.clipPath = ''; done(); },
    });
  }

  function close() {
    if (!isOpen || busy) return;
    isOpen = false;
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    el.classList.remove('is-visible');
    setTimeout(function () {
      el.classList.remove('is-open');
      el.inert = true;
      document.documentElement.classList.remove('viewer-open');
      imgEl.removeAttribute('src');
      imgEl.removeAttribute('srcset');
      if (opts.onClose) opts.onClose();
    }, Core.dur(2));
    if (returnTo && returnTo.focus) returnTo.focus({ preventScroll: true });
  }

  window.Viewer = { open: open, close: close, isOpen: function () { return isOpen || busy; } };
})();
