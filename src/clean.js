/*
  clean - hide overlays, unstick chrome, restore scrolling and selection.
  Reversible: click again to undo. Watches for late-injected popups for 10s,
  processing only newly-added nodes rather than re-scanning the whole
  document on every mutation. Pierces open shadow roots.

  Adapted from the public "unfuck-css" bookmarklet (renamed, same logic).
  Nothing is removed from the DOM - elements are hidden or un-positioned and
  every touched element's original style attribute is saved for undo.
*/
/*@include*/
(function () {
  if (window.__clean) { window.__clean.undo(); return; }

  var W = innerWidth, H = innerHeight, VP = W * H;
  var tracker = BM_styleTracker();
  var n = 0, m = 0;
  var keep = BM_textShareGuard(document.body, 500, 0.4);

  /* Anchored to whole class/id tokens (via BM_tokenMatch) rather than tested
     as a raw substring - a bare "modal" would also match "IsRemoteModal", but
     more importantly a bare "meter" or "gate" would match "parameter",
     "diameter", "aggregate", "navigate", none of which are overlays. */
  var BAD = /^(cookie|consent|gdpr|newsletter|paywall|subscri\w*|signup|sign-up|promo\w*|interstitial|backdrop|overlay|popup|modal)$/i;

  function considerElement(e) {
    if (e.nodeType !== 1) return;
    if (e.hasAttribute('data-cleaned') || e.id === 'clean-css') return;
    BM_safely(function () {
      var c = getComputedStyle(e);
      if (c.filter && c.filter.indexOf('blur') > -1 && BM_tlen(e) > 150) tracker.set(e, 'filter', 'none');
      var p = c.position;
      if (p !== 'fixed' && p !== 'sticky' && p !== 'absolute') return;
      if (c.display === 'none' || c.visibility === 'hidden') return;
      var r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (keep(e)) return;
      var big = r.width * r.height > 0.65 * VP && r.top < H * 0.3 && r.left < W * 0.3,
        md = e.getAttribute('aria-modal') === 'true' || e.getAttribute('role') === 'dialog',
        jk = BM_tokenMatch(e, BAD);
      if (big || md || (jk && p !== 'absolute')) {
        tracker.set(e, 'display', 'none'); e.setAttribute('data-cleaned', 'h'); m++;
      } else if (p !== 'absolute') {
        tracker.set(e, 'position', 'static'); tracker.set(e, 'z-index', 'auto'); e.setAttribute('data-cleaned', 'u'); n++;
      }
    });
  }

  function fullSweep() {
    BM_deepEach(document.documentElement, considerElement, true);
  }

  function unlock() { BM_unlockScroll(tracker, true); }

  var css = BM_injectStyle(
    'html,body{overflow:visible!important;overflow-y:auto!important;position:static!important;' +
    'height:auto!important;max-height:none!important}*{user-select:auto!important;-webkit-user-select:auto!important}'
  );

  /* capture-phase interception also defeats handlers added via addEventListener */
  var sp = function (ev) { ev.stopImmediatePropagation(); };
  var EV = ['contextmenu', 'selectstart', 'copy', 'cut', 'dragstart'];
  EV.forEach(function (t) { document.addEventListener(t, sp, true); });

  unlock();
  fullSweep();

  var watcher = BM_watch(document.documentElement, function (records) {
    unlock();
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) BM_deepEach(added[j], considerElement, true);
      }
    }
  }, { childList: true, subtree: true }, 150, 10000);

  window.__clean = {
    undo: function () {
      watcher.stop();
      tracker.undo();
      document.querySelectorAll('[data-cleaned]').forEach(function (e) { e.removeAttribute('data-cleaned'); });
      EV.forEach(function (t) { document.removeEventListener(t, sp, true); });
      css.remove();
      delete window.__clean;
      BM_toast('restored');
    }
  };

  BM_toast('cleaned: ' + n + ' unstuck, ' + m + ' hidden - click again to undo');
})();
