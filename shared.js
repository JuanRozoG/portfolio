/**
 * shared.js — Site-wide cursor + page-transition behaviour
 * Auto-injected by server.py into every standalone page.
 * - Creates and tracks the custom red cursor
 * - Intercepts menu-link clicks to add wipe transition before navigation
 */
(function () {
  'use strict';

  var isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  /* ════════════════════════════════════════════════════════
     WIPE TRANSITION
     Intercepts all menu-link clicks on standalone pages and
     plays the wipe-in animation before navigating away.
     The destination page already has bodyReveal for the entry.
  ════════════════════════════════════════════════════════ */
  var navigating = false;

  function wipeNavigate(url) {
    if (navigating) return;
    navigating = true;

    var overlay = document.createElement('div');
    overlay.className = 'wipe-overlay';
    // Wipe styles — must match style.css since standalone pages
    // don't always load style.css (some have inline CSS only).
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9000',
      'background:#0a0a0a', 'transform:translateY(100%)',
      'pointer-events:none', 'will-change:transform',
      'animation:sharedWipeIn 0.6s cubic-bezier(0.65,0,0.35,1) forwards'
    ].join(';');
    document.body.appendChild(overlay);

    var done = false;
    function go() { if (done) return; done = true; window.location.href = url; }
    overlay.addEventListener('animationend', go);
    setTimeout(go, 700); // fallback
  }

  // Inject the keyframe if not already present
  if (!document.getElementById('shared-wipe-kf')) {
    var style = document.createElement('style');
    style.id = 'shared-wipe-kf';
    style.textContent = [
      '@keyframes sharedWipeIn{',
      'from{transform:translateY(100%)}',
      'to{transform:translateY(0)}',
      '}'
    ].join('');
    document.head.appendChild(style);
  }

  // Delegate menu-link clicks — fires after the page's own listeners
  // (which call closeMenu), so timing is correct.
  document.addEventListener('click', function (e) {
    var link = e.target.closest('.menu-link');
    if (!link) return;
    var slug = link.dataset.slug || link.dataset.page;
    if (!slug) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Close menu visually first, then wipe
    var overlay = document.getElementById('menu-overlay');
    if (overlay) {
      overlay.classList.remove('open', 'menu-ready');
      document.body.classList.remove('menu-open');
    }
    setTimeout(function () { wipeNavigate('/' + slug); }, 80);
  }, true); // capture phase so we run before inline listeners

  /* ════════════════════════════════════════════════════════
     CUSTOM CURSOR (non-touch only, only if no cursor exists)
  ════════════════════════════════════════════════════════ */
  if (isTouch) return;
  if (document.getElementById('cursor')) return;

  var cursor = document.createElement('div');
  cursor.id = 'cursor';
  cursor.className = 'cursor';
  cursor.innerHTML = '<span></span>';
  document.body.appendChild(cursor);

  var cx = 0, cy = 0, px = 0, py = 0;
  document.addEventListener('mousemove', function (e) { cx = e.clientX; cy = e.clientY; });
  (function loop() {
    px += (cx - px) * 0.12;
    py += (cy - py) * 0.12;
    cursor.style.transform = 'translate(' + px + 'px,' + py + 'px)';
    requestAnimationFrame(loop);
  })();

  function isInteractive(el) {
    if (!el) return false;
    return !!el.closest('a, button, .menu-btn, .menu-close, .menu-name, .menu-footer-link, .menu-link');
  }

  document.addEventListener('mouseover', function (e) {
    if (isInteractive(e.target)) cursor.classList.add('cursor--link');
  }, false);

  document.addEventListener('mouseout', function (e) {
    if (isInteractive(e.target) && !isInteractive(e.relatedTarget)) {
      cursor.classList.remove('cursor--link');
    }
  }, false);

})();
