/**
 * shared.js — Site-wide cursor behaviour
 * Auto-injected by server.py into every page that doesn't already
 * have a cursor element. This ensures the custom cursor and correct
 * cursor states work on all pages, current and future.
 */
(function () {
  'use strict';

  // Touch devices: hide cursor div and bail
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

  // If this page already has its own cursor system, do nothing
  if (document.getElementById('cursor')) return;

  /* ── Create cursor element ─────────────────────────────── */
  const cursor = document.createElement('div');
  cursor.id = 'cursor';
  cursor.className = 'cursor';
  cursor.innerHTML = '<span></span>';
  document.body.appendChild(cursor);

  /* ── Smooth tracking ───────────────────────────────────── */
  let cx = 0, cy = 0, px = 0, py = 0;
  document.addEventListener('mousemove', function (e) { cx = e.clientX; cy = e.clientY; });
  (function loop() {
    px += (cx - px) * 0.12;
    py += (cy - py) * 0.12;
    cursor.style.transform = 'translate(' + px + 'px, ' + py + 'px)';
    requestAnimationFrame(loop);
  })();

  /* ── Interactive target detection ──────────────────────── */
  function isInteractive(el) {
    if (!el) return false;
    return !!el.closest('a, button, .menu-btn, .menu-close, .menu-name, .menu-footer-link, .menu-link');
  }

  document.addEventListener('mouseover', function (e) {
    if (isInteractive(e.target)) cursor.classList.add('cursor--link');
  }, false);

  document.addEventListener('mouseout', function (e) {
    // Only remove if we're leaving the interactive zone entirely
    if (isInteractive(e.target) && !isInteractive(e.relatedTarget)) {
      cursor.classList.remove('cursor--link');
    }
  }, false);

})();
