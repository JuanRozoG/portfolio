/**
 * shared.js — Injected into every standalone page by server.py
 * - Universal menu overlay (build, open, close, hover, preview)
 * - Wipe transition before cross-page navigation
 * - Custom red cursor (non-touch only)
 *
 * Edit this file to update menu behaviour on all pages at once.
 */
(function () {
  'use strict';

  var isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  /* ════════════════════════════════════════════════════════
     WIPE TRANSITION
     Intercepts all menu-link clicks and plays wipe-in
     before navigating. Runs in capture phase so it fires
     before any inline listeners on the links.
  ════════════════════════════════════════════════════════ */
  var navigating = false;

  function wipeNavigate(url) {
    if (navigating) return;
    navigating = true;

    var overlay = document.createElement('div');
    overlay.className = 'wipe-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9000',
      'background:#0a0a0a', 'transform:translateY(100%)',
      'pointer-events:none', 'will-change:transform',
      'animation:sharedWipeIn 0.12s cubic-bezier(0.4,0,1,1) forwards'
    ].join(';');
    document.body.appendChild(overlay);

    var done = false;
    function go() { if (done) return; done = true; window.location.href = url; }
    overlay.addEventListener('animationend', go);
    setTimeout(go, 200); // fallback
  }

  // Inject the wipe keyframe if not already present
  if (!document.getElementById('shared-wipe-kf')) {
    var wipeStyle = document.createElement('style');
    wipeStyle.id = 'shared-wipe-kf';
    wipeStyle.textContent = '@keyframes sharedWipeIn{from{transform:translateY(100%)}to{transform:translateY(0)}}';
    document.head.appendChild(wipeStyle);
  }

  // Intercept menu-link clicks — capture phase, before inline handlers
  document.addEventListener('click', function (e) {
    var link = e.target.closest('.menu-link');
    if (!link) return;
    var slug = link.dataset.slug || link.dataset.page;
    if (!slug) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Close menu visually first, then wipe
    var menuEl = document.getElementById('menu-overlay');
    var menuBtn = document.getElementById('menu-btn');
    if (menuEl) { menuEl.classList.remove('open', 'menu-ready'); }
    if (menuBtn) { menuBtn.classList.remove('hidden'); }
    document.body.classList.remove('menu-open');
    setTimeout(function () { wipeNavigate('/' + slug); }, 80);
  }, true); // capture phase

  /* ════════════════════════════════════════════════════════
     UNIVERSAL MENU OVERLAY
     Builds nav + footer from CONFIG, handles open/close/
     keyboard/hover/preview. Does NOT touch .menu-name so
     the <img> logo stays intact.
  ════════════════════════════════════════════════════════ */
  (function initMenu() {
    var overlay   = document.getElementById('menu-overlay');
    var menuBtn   = document.getElementById('menu-btn');
    var menuClose = document.getElementById('menu-close');
    var menuNavEl = document.getElementById('menu-nav');
    var footerEl  = document.getElementById('menu-footer');

    // Guard: skip if overlay missing or already set up by the page
    if (!overlay || overlay.dataset.menuInit) return;
    if (!menuBtn || !menuClose || !menuNavEl) return;
    overlay.dataset.menuInit = '1';

    var menuOpen = false;
    var menuCurrentLink = null;

    // Build footer from CONFIG
    if (footerEl && typeof CONFIG !== 'undefined') {
      var insta1    = CONFIG.instagram || '';
      var insta1Url = CONFIG.instagramUrl || '#';
      var insta2    = (CONFIG.pageContent && CONFIG.pageContent.info && CONFIG.pageContent.info.instagram2Label) || '';
      var insta2Url = (CONFIG.pageContent && CONFIG.pageContent.info && CONFIG.pageContent.info.instagram2Url)   || '#';
      footerEl.innerHTML =
        '<span class="menu-footer-left">Melbourne</span>' +
        '<div class="menu-footer-right">' +
          (insta2 ? '<a href="' + insta2Url + '" target="_blank" rel="noopener" class="menu-footer-link">' + insta2 + '</a>' : '') +
          (insta1 ? '<a href="' + insta1Url + '" target="_blank" rel="noopener" class="menu-footer-link">' + insta1 + '</a>' : '') +
        '</div>';
    }

    // Build preview image element
    var previewEl = overlay.querySelector('.menu-preview');
    if (!previewEl) {
      previewEl = document.createElement('img');
      previewEl.className = 'menu-preview';
      previewEl.alt = '';
      previewEl.setAttribute('aria-hidden', 'true');
      overlay.appendChild(previewEl);
    }

    // Build nav links from CONFIG.menuPages
    if (typeof CONFIG !== 'undefined' && CONFIG.menuPages) {
      CONFIG.menuPages.forEach(function (pg) {
        var a = document.createElement('a');
        a.href = '#';
        a.className = 'menu-link';
        a.dataset.page     = pg.id;
        a.dataset.template = pg.template;
        a.dataset.slug     = pg.slug;
        a.innerHTML = '<span class="menu-link-lbl">' + pg.menuLabel + '</span>';
        menuNavEl.appendChild(a);
      });
    }

    function openMenu() {
      menuOpen = true;
      overlay.classList.remove('menu-ready');
      overlay.classList.add('open');
      menuBtn.classList.add('hidden');
      document.body.classList.add('menu-open');
      setTimeout(function () { if (menuOpen) overlay.classList.add('menu-ready'); }, 1600);
    }

    function closeMenu() {
      menuOpen = false;
      overlay.classList.remove('open', 'menu-ready');
      menuBtn.classList.remove('hidden');
      document.body.classList.remove('menu-open');
    }

    menuBtn.addEventListener('click', openMenu);
    menuClose.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuOpen) closeMenu();
    });

    // Hover effects + preview image
    var previewTimer = null;

    function attachHover(link) {
      link.addEventListener('mouseenter', function () {
        if (menuCurrentLink && menuCurrentLink !== link) menuCurrentLink.classList.remove('hovered');
        link.classList.add('hovered');
        menuCurrentLink = link;
        menuNavEl.classList.add('has-hover');
        overlay.classList.add('has-item-hover');

        if (previewEl) {
          var pageId     = link.dataset.page;
          var ownGallery = (typeof CONFIG !== 'undefined' && CONFIG.pageGalleries && CONFIG.pageGalleries[pageId]) || [];
          var gallery    = ownGallery.length > 0 ? ownGallery
            : ((CONFIG.pageGalleries && (CONFIG.pageGalleries['people'] || CONFIG.pageGalleries['intro'])) || []);
          clearTimeout(previewTimer);
          if (gallery.length > 0) {
            var imgUrl = gallery[0].image || gallery[0].url || '';
            if (imgUrl) {
              if (previewEl.getAttribute('data-current') !== imgUrl) {
                previewEl.classList.remove('visible');
                previewTimer = setTimeout(function () {
                  previewEl.src = imgUrl;
                  previewEl.setAttribute('data-current', imgUrl);
                  void previewEl.offsetHeight;
                  previewEl.classList.add('visible');
                }, 30);
              } else {
                previewEl.classList.add('visible');
              }
            } else {
              previewEl.classList.remove('visible');
            }
          } else {
            previewEl.classList.remove('visible');
          }
        }
      });

      link.addEventListener('mouseleave', function () {
        link.classList.remove('hovered');
        if (menuCurrentLink === link) menuCurrentLink = null;
        setTimeout(function () {
          if (!menuCurrentLink) {
            menuNavEl.classList.remove('has-hover');
            overlay.classList.remove('has-item-hover');
            if (previewEl) { clearTimeout(previewTimer); previewEl.classList.remove('visible'); }
          }
        }, 50);
      });
    }

    menuNavEl.querySelectorAll('.menu-link').forEach(attachHover);
  })();

  /* ════════════════════════════════════════════════════════
     CUSTOM CURSOR (non-touch only, only if no cursor exists)
  ════════════════════════════════════════════════════════ */
  if (isTouch) return;
  if (document.getElementById('cursor')) return;

  var cursor = document.createElement('div');
  cursor.id        = 'cursor';
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
  });
  document.addEventListener('mouseout', function (e) {
    if (isInteractive(e.target) && !isInteractive(e.relatedTarget)) {
      cursor.classList.remove('cursor--link');
    }
  });

})();
