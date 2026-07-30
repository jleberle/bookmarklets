/*
  unstick - remove sticky/fixed chrome and restore scrolling.
  The conservative one. Only touches things that are almost never
  legitimate to keep once you have explicitly asked for them gone.
  One-way (no undo); reload the page to restore. Pierces open shadow roots.
*/
/*@include*/
(function () {
  var skip = new Set([document.documentElement, document.body]);
  var keep = BM_textShareGuard(document.body, 500, 0.4);

  BM_deepEach(document.documentElement, function (n) {
    BM_safely(function () {
      var s = getComputedStyle(n), p = s.position;

      /* never remove html/body themselves - some sites scroll-lock by
         setting position:fixed on body, and removing it wipes the page.
         also never remove something holding a large share of the page's
         text - a class name or position alone is not reason enough. */
      if (!skip.has(n) && (p === 'fixed' || p === 'sticky') && !keep(n)) { n.remove(); return; }

      ['overflow', 'overflowX', 'overflowY'].forEach(function (k) {
        if (s[k] === 'hidden' || s[k] === 'clip') {
          var prop = k.replace(/[A-Z]/, function (c) { return '-' + c.toLowerCase(); });
          n.style.setProperty(prop, 'visible', 'important');
        }
      });
    });
  }, true);

  [document.documentElement, document.body].forEach(function (el) {
    ['overflow', 'overflow-x', 'overflow-y'].forEach(function (k) {
      el.style.setProperty(k, 'visible', 'important');
    });
    el.style.setProperty('pointer-events', 'auto', 'important');
    el.style.setProperty('touch-action', 'auto', 'important');
    el.style.removeProperty('user-select');
  });

  BM_deepQueryAll(document.documentElement, 'video').forEach(function (v) { v.pause(); v.muted = true; });
})();
