/**
 * collage.js — organic photo collage used by the home page (and the
 * archived intro in /lab). One engine, two reveal styles:
 *   'spread'  — photos pop in at the centre and spread to their spots
 *   'stagger' — photos fade up in place, one after another
 *
 * Collage.mount(container, items, {
 *   count, exclude: () => [DOMRect…], reveal, onClick(item, imgEl)
 * }) → Promise (resolves when the reveal has started)
 */
(function () {
  'use strict';

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** n items balanced across people / things / personal, topped up from the pool. */
  function pickBalanced(pool, n) {
    var picked = {}, out = [];
    function take(list, k) {
      shuffle(list.filter(function (p) { return !picked[p.id]; })).slice(0, k)
        .forEach(function (p) { picked[p.id] = true; out.push(p); });
    }
    var per = Math.ceil(n / 3);
    ['people', 'things', 'personal'].forEach(function (cat) {
      take(pool.filter(function (p) { return (p.categories || []).indexOf(cat) !== -1; }), per);
    });
    if (out.length < n) take(pool, n - out.length);
    return shuffle(out).slice(0, n);
  }

  function overlap(a, b, gap) {
    var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
    var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
    return ox > 0 && oy > 0 ? { x: ox, y: oy } : null;
  }

  /**
   * Places boxes (aspect ratios h/w) around the viewport, away from each
   * other and from every exclusion rect. Boxes that cannot be placed
   * without touching an exclusion are dropped.
   */
  function layout(ratios, vw, vh, exclude) {
    var mobile = vw < 600;
    var base = mobile ? [0.30, 0.34, 0.24, 0.28, 0.22, 0.26] : [0.15, 0.17, 0.11, 0.13, 0.09, 0.14, 0.16, 0.10, 0.12];
    var widths = shuffle(base);
    var zones = shuffle(mobile ? [
      { x0: 0.02, x1: 0.30, y0: 0.10, y1: 0.28 }, { x0: 0.55, x1: 0.70, y0: 0.10, y1: 0.28 },
      { x0: 0.02, x1: 0.20, y0: 0.62, y1: 0.80 }, { x0: 0.50, x1: 0.70, y0: 0.62, y1: 0.80 },
      { x0: 0.02, x1: 0.30, y0: 0.80, y1: 0.95 }, { x0: 0.55, x1: 0.70, y0: 0.80, y1: 0.95 },
    ] : [
      { x0: 0.01, x1: 0.20, y0: 0.10, y1: 0.28 }, { x0: 0.22, x1: 0.46, y0: 0.10, y1: 0.24 },
      { x0: 0.65, x1: 0.88, y0: 0.10, y1: 0.28 }, { x0: 0.01, x1: 0.15, y0: 0.34, y1: 0.64 },
      { x0: 0.75, x1: 0.90, y0: 0.34, y1: 0.64 }, { x0: 0.01, x1: 0.20, y0: 0.68, y1: 0.90 },
      { x0: 0.22, x1: 0.44, y0: 0.72, y1: 0.93 }, { x0: 0.46, x1: 0.66, y0: 0.70, y1: 0.93 },
      { x0: 0.70, x1: 0.88, y0: 0.68, y1: 0.90 },
    ]);
    var gap = Math.max(8, vw * 0.012), margin = Math.max(8, vw * 0.01);
    var ex = exclude.map(function (r) { return { x: r.left, y: r.top, w: r.width, h: r.height }; });

    var boxes = ratios.map(function (ar, i) {
      var z = zones[i % zones.length], w = widths[i % widths.length] * vw;
      var h = w * ar;
      var maxH = vh * (mobile ? 0.22 : 0.3);
      if (h > maxH) { h = maxH; w = h / ar; }
      var x = (z.x0 + Math.random() * (z.x1 - z.x0)) * vw, y = (z.y0 + Math.random() * (z.y1 - z.y0)) * vh;
      return { x: x, y: y, w: w, h: h, ax: x, ay: y, ok: true };
    });

    function clamp(b) {
      b.x = Math.max(margin, Math.min(vw - b.w - margin, b.x));
      b.y = Math.max(margin, Math.min(vh - b.h - margin, b.y));
    }
    function pushOut(b, r, k) {
      var o = overlap(b, r, gap);
      if (!o) return false;
      var dx = (b.x + b.w / 2) - (r.x + r.w / 2), dy = (b.y + b.h / 2) - (r.y + r.h / 2);
      if (o.x < o.y) b.x += (dx >= 0 ? o.x : -o.x) * k; else b.y += (dy >= 0 ? o.y : -o.y) * k;
      return true;
    }
    boxes.forEach(clamp);

    for (var pass = 0; pass < 140; pass++) {
      var t = pass / 140;
      boxes.forEach(function (b, i) {
        ex.forEach(function (r) { pushOut(b, r, 0.8); });
        boxes.forEach(function (o, j) { if (i !== j) pushOut(b, o, 0.5); });
        var pull = 0.04 * (1 - t * 0.8);
        b.x += (b.ax - b.x) * pull;
        b.y += (b.ay - b.y) * pull;
        clamp(b);
      });
    }
    // Final pass: exclusions are hard limits — shrink, then drop if still touching
    boxes.forEach(function (b, i) {
      for (var k = 0; k < 6 && ex.some(function (r) { return overlap(b, r, gap); }); k++) {
        b.w *= 0.85; b.h *= 0.85;
        ex.forEach(function (r) { pushOut(b, r, 1); });
        clamp(b);
      }
      if (ex.some(function (r) { return overlap(b, r, gap); })) b.ok = false;
      for (var j = 0; j < i; j++) if (boxes[j].ok && overlap(b, boxes[j], 0)) b.ok = false;
    });
    return boxes;
  }

  function mount(container, items, opts) {
    opts = opts || {};
    var Core = window.Core;
    var reduce = Core.reduceMotion.matches;
    var vw = innerWidth, vh = innerHeight;
    var count = Math.min(items.length, opts.count || (vw < 600 ? 6 : 9));
    var chosen = items.slice(0, count);
    var ratios = chosen.map(function (it) { return it.width && it.height ? it.height / it.width : 1.33; });
    var boxes = layout(ratios, vw, vh, opts.exclude ? opts.exclude() : []);

    container.innerHTML = '';
    var els = [];
    chosen.forEach(function (item, i) {
      var b = boxes[i];
      if (!b.ok) return;
      var div = document.createElement('div');
      div.className = 'intro-collage-img ph';
      div.dataset.cursor = 'View';
      div.style.cssText = 'left:' + b.x.toFixed(1) + 'px;top:' + b.y.toFixed(1) + 'px;width:' +
        b.w.toFixed(1) + 'px;height:' + b.h.toFixed(1) + 'px;';
      div.innerHTML = '<img ' + Core.imgAttrs(item, {
        w: 640, eager: true, sizes: Math.ceil(b.w / vw * 100) + 'vw', draggable: false,
      }) + ' />';
      if (opts.onClick) div.addEventListener('click', function () { opts.onClick(item, div.querySelector('img')); });
      container.appendChild(div);
      els.push({ el: div, box: b });
    });

    // Hover (pointer devices): blur the others
    if (!container.dataset.hoverBound) {
      container.dataset.hoverBound = '1';
      container.addEventListener('pointerover', function (e) {
        if (e.pointerType !== 'mouse') return;
        var hit = e.target.closest('.intro-collage-img');
        container.classList.toggle('has-hover', !!hit);
        container.querySelectorAll('.collage-hovered').forEach(function (x) { x.classList.remove('collage-hovered'); });
        if (hit) hit.classList.add('collage-hovered');
      });
      container.addEventListener('pointerleave', function () {
        container.classList.remove('has-hover');
        container.querySelectorAll('.collage-hovered').forEach(function (x) { x.classList.remove('collage-hovered'); });
      });
    }

    // Reveal only once the photos are decoded (each capped so one slow image never blocks)
    var decodedAll = Promise.all(els.map(function (e) { return Core.decoded(e.el.querySelector('img'), 1500); }));
    return decodedAll.then(function () { reveal(els, opts.reveal || 'spread', reduce, vw, vh); });
  }

  function reveal(els, style, reduce, vw, vh) {
    if (reduce) {
      els.forEach(function (e) { e.el.classList.add('is-in'); });
      return;
    }
    var n = els.length;
    if (style === 'stagger') {
      els.forEach(function (e, i) {
        e.el.style.transform = 'translateY(24px)';
        e.el.style.transition = 'opacity var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-out)';
        e.el.style.transitionDelay = (i * 60) + 'ms';
        requestAnimationFrame(function () { e.el.classList.add('is-in'); e.el.style.transform = 'none'; });
      });
      return;
    }
    // 'spread': total ≤ 1.2 s for 9 photos — pop in at centre (9 × 35 ms),
    // short hold, then spread (560 ms + 8 × 20 ms stagger)
    var APPEAR = 35, HOLD = 100, SPREAD = 560, SPREAD_STAGGER = 20;
    els.forEach(function (e) {
      var dx = vw / 2 - (e.box.x + e.box.w / 2), dy = vh / 2 - (e.box.y + e.box.h / 2);
      e.el.style.transition = 'none';
      e.el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(0.6)';
    });
    els.forEach(function (e, i) { setTimeout(function () { e.el.classList.add('is-in'); }, i * APPEAR); });
    var start = n * APPEAR + HOLD;
    els.forEach(function (e, i) {
      setTimeout(function () {
        e.el.style.transition = 'transform ' + SPREAD + 'ms var(--ease-out), filter var(--dur-2) var(--ease-out), opacity var(--dur-2) var(--ease-out)';
        e.el.style.transform = 'none';
      }, start + i * SPREAD_STAGGER);
    });
  }

  window.Collage = { mount: mount, pickBalanced: pickBalanced, shuffle: shuffle };
})();
