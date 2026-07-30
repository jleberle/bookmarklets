/*
  unpaywall - un-hide soft-paywalled article text and, when the page shipped
  more text than it's showing, recover the rest from the data already
  embedded in the document.

  Scope: this only surfaces content the site already sent to your browser -
  either hidden with CSS, or sitting in a hydration/structured-data payload
  in the page source. Hard paywalls (text never leaves the server) are
  untouchable client-side; no bookmarklet can fix that. It deliberately does
  not fetch alternate URLs, reset meter counters, or spoof referrers - those
  go get content the server withheld rather than reading what it handed over.
*/
/*@include*/
(function () {
  if (window.__unpaywall) { window.__unpaywall.undo(); return; }

  var W = innerWidth, H = innerHeight, VP = W * H;
  var tracker = BM_styleTracker();
  var nUnstuck = 0, nHidden = 0, nShown = 0;

  /* Anchored to whole class/id tokens - a bare substring test on "meter" or
     "gate" also matches "parameter", "diameter", "aggregate", "navigate",
     "gateway"; anchoring rules that out. The remaining matches this still
     picks up on unrelated content (e.g. a legitimate "premium-article-body"
     wrapper) are backstopped by the text-share guard below, which is checked
     first. See test.js for the false-positive regression set this list is
     checked against on every build. */
  var GATE = /^(paywall|regwall|meter|piano|tp-modal|tp-backdrop|subscri\w*|premium|gate|blocker|leaky|consent|newsletter|signup|sign-up|register|promo\w*|interstitial|modal|overlay|popup)$/i;
  var MEDIA = /^(IMG|VIDEO|IFRAME|SVG|CANVAS|PICTURE|OBJECT|EMBED)$/;
  var keep = BM_textShareGuard(document.body, 500, 0.4);

  /* ---------- locate the article ---------- */
  function findArticle() {
    var sels = ['[itemprop="articleBody"]', '[class*="article-body"]', '[class*="article__body"]',
      '[class*="story-body"]', '[class*="entry-content"]', '[class*="post-content"]',
      '[class*="articleBody"]', 'article', 'main'];
    for (var i = 0; i < sels.length; i++) {
      var nodes;
      try { nodes = document.querySelectorAll(sels[i]); } catch (e) { continue; }
      var best = null, bs = 0;
      for (var j = 0; j < nodes.length; j++) {
        var n = nodes[j], s = BM_tlen(n) + n.querySelectorAll('p').length * 50;
        if (s > bs) { bs = s; best = n; }
      }
      if (best && BM_tlen(best) > 300) return best;
    }
    return document.body;
  }

  /* ---------- un-blur / un-clip / un-fade ----------
     Runs on the live article container. Shadow DOM piercing doesn't apply
     here the way it does to overlay detection below - a paywall's own clip
     wrapper is essentially never inside a shadow root. */
  function unclip(root) {
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (MEDIA.test(e.tagName)) continue;
      BM_safely(function () {
        var c = getComputedStyle(e);
        if (c.filter && c.filter.indexOf('blur') > -1) tracker.set(e, 'filter', 'none');
        /* a blur applied to what's *behind* an overlay rather than to itself */
        if (c.backdropFilter && c.backdropFilter.indexOf('blur') > -1) tracker.set(e, 'backdrop-filter', 'none');
        /* both the legacy prefixed property and its unprefixed successor */
        var clamp = c.webkitLineClamp || c.lineClamp;
        if (clamp && clamp !== 'none') {
          tracker.set(e, '-webkit-line-clamp', 'unset');
          tracker.set(e, 'line-clamp', 'unset');
          tracker.set(e, 'display', 'block');
        }
        if (c.maskImage && c.maskImage !== 'none') tracker.set(e, 'mask-image', 'none');
        if (c.webkitMaskImage && c.webkitMaskImage !== 'none') tracker.set(e, '-webkit-mask-image', 'none');
        /* skips rendering entirely while leaving the text in the DOM */
        if (c.contentVisibility === 'hidden') tracker.set(e, 'content-visibility', 'visible');
        /* inset() can lop off the bottom of an article as effectively as overflow */
        if (c.clipPath && c.clipPath !== 'none' && BM_tlen(e) > 200) tracker.set(e, 'clip-path', 'none');
        /* dots out glyphs the way a password field does */
        if (c.webkitTextSecurity && c.webkitTextSecurity !== 'none') tracker.set(e, '-webkit-text-security', 'none');
        var clipped = e.scrollHeight > e.clientHeight + 24;
        if (clipped && (c.overflow === 'hidden' || c.overflow === 'clip' || c.overflowY === 'hidden' || c.overflowY === 'clip')) {
          tracker.set(e, 'max-height', 'none'); tracker.set(e, 'height', 'auto');
          tracker.set(e, 'overflow', 'visible'); tracker.set(e, 'overflow-y', 'visible');
        }
        if (parseFloat(c.opacity) < 0.95 && BM_tlen(e) > 100) tracker.set(e, 'opacity', '1');
        if (/linear-gradient/.test(c.backgroundImage) && BM_tlen(e) < 25 &&
          (c.position === 'absolute' || c.position === 'fixed')) { tracker.set(e, 'display', 'none'); nHidden++; }
      });
    }
  }

  /* ---------- reveal hidden article text ---------- */
  var SAFE = /print|sr-only|screen-reader|visually-hidden|skip-link/i;
  function reveal(root) {
    var els = root.querySelectorAll('p,h2,h3,h4,li,blockquote,figure,figcaption,section');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (SAFE.test((e.getAttribute('class') || '') + ' ' + (e.id || ''))) continue;
      BM_safely(function () {
        var c = getComputedStyle(e);
        if (c.display === 'none') { tracker.set(e, 'display', 'revert'); nShown++; }
        else if (c.visibility === 'hidden') { tracker.set(e, 'visibility', 'visible'); nShown++; }
      });
    }
  }

  /* ---------- kill gate overlays (live document; shadow-piercing) ---------- */
  function considerGate(e) {
    if (!e || e.nodeType !== 1) return;
    if (e.hasAttribute('data-unpaywalled') || e.id === 'unpaywall-reader') return;
    BM_safely(function () {
      var c = getComputedStyle(e), p = c.position;
      if (p !== 'fixed' && p !== 'sticky' && p !== 'absolute') return;
      if (c.display === 'none' || c.visibility === 'hidden') return;
      var r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (keep(e)) return;
      var big = r.width * r.height > 0.55 * VP && r.top < H * 0.5;
      var modal = e.getAttribute('aria-modal') === 'true' || e.getAttribute('role') === 'dialog';
      if (big || modal || BM_tokenMatch(e, GATE)) {
        tracker.set(e, 'display', 'none'); e.setAttribute('data-unpaywalled', '1'); nHidden++;
      } else if (p === 'fixed' || p === 'sticky') {
        tracker.set(e, 'position', 'static'); tracker.set(e, 'z-index', 'auto'); e.setAttribute('data-unpaywalled', '1'); nUnstuck++;
      }
    });
  }
  function killGatesFull() { BM_deepEach(document.documentElement, considerGate, true); }

  /* ---------- unlock scroll ---------- */
  function unlock() {
    [document.documentElement, document.body].forEach(function (e) {
      if (!e) return;
      tracker.set(e, 'overflow', 'visible'); tracker.set(e, 'overflow-y', 'auto');
      tracker.set(e, 'position', 'static'); tracker.set(e, 'height', 'auto');
      tracker.set(e, 'max-height', 'none'); tracker.set(e, 'touch-action', 'auto');
      tracker.set(e, 'overscroll-behavior', 'auto'); tracker.set(e, 'filter', 'none');
      tracker.set(e, 'pointer-events', 'auto');
    });
    BM_closeOverlays(document.documentElement);
  }

  /* ---------- recover full text the page already shipped ----------
     Beyond JSON-LD, most modern news sites hydrate the page from a JSON blob
     that already carries the whole article: Next.js writes __NEXT_DATA__,
     and Nuxt/Remix/Apollo/Redux stash equivalents on window or in a
     <script type="application/json">. Same principle as the CSS un-hiding
     above - the text is already in the document you were served, it just
     was never rendered. */

  /* Payload bodies are often HTML rather than plain text; flatten to text but
     keep block boundaries so paras() can still find paragraph breaks. */
  function htmlToText(s) {
    if (!/<[a-z][^>]*>/i.test(s)) return s;
    var d = BM_safely(function () { return new DOMParser().parseFromString(s, 'text/html'); });
    if (!d || !d.body) return s;
    d.body.querySelectorAll('script,style,noscript').forEach(function (n) { n.remove(); });
    d.body.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,blockquote,br,figcaption').forEach(function (n) {
      n.after(d.createTextNode('\n'));
    });
    return (d.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function embeddedCandidates() {
    var found = [];
    function add(label, obj) {
      var o = [];
      BM_harvestStrings(obj, 0, o);
      o.forEach(function (c) { c.src = label; found.push(c); });
    }
    function fromScripts(sel, labeller) {
      var ss = document.querySelectorAll(sel);
      for (var i = 0; i < ss.length && i < 25; i++) {
        var txt = ss[i].textContent || '';
        if (!txt || txt.length > 8e6) continue;
        var d = BM_safely(function () { return JSON.parse(txt); });
        if (d) add(labeller(ss[i]), d);
      }
    }
    fromScripts('script[type="application/ld+json"]', function () { return 'JSON-LD structured data'; });
    fromScripts('script[type="application/json"]', function (s) {
      return s.id === '__NEXT_DATA__' ? 'Next.js hydration data' : 'embedded JSON' + (s.id ? ' (#' + s.id + ')' : '');
    });
    ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APOLLO_STATE__', '__remixContext', '__data']
      .forEach(function (g) {
        var v = BM_safely(function () { return window[g]; });
        if (v && typeof v === 'object') add('window.' + g, v);
      });
    return found;
  }

  function noscriptBody() {
    var best = '', ns = document.querySelectorAll('noscript');
    for (var i = 0; i < ns.length; i++) {
      var d = document.createElement('div');
      d.innerHTML = ns[i].textContent || '';
      var t = (d.textContent || '').trim();
      if (t.length > best.length) best = t;
    }
    return best;
  }

  function bestRecovered() {
    var cands = BM_safely(embeddedCandidates) || [];
    /* htmlToText spins up a DOMParser per candidate, so only convert the
       most promising handful rather than everything harvested */
    cands.sort(function (a, b) { return b.raw.length * (b.keyed ? 1.25 : 1) - a.raw.length * (a.keyed ? 1.25 : 1); });
    cands = cands.slice(0, 12);
    var best = null;
    cands.forEach(function (c) {
      var t = BM_safely(function () { return htmlToText(c.raw); }) || '';
      if (t.length < 400) return;
      var score = t.length * (c.keyed ? 1.25 : 1);
      if (!best || score > best.score) best = { text: t, src: c.src, score: score };
    });
    var ns = BM_safely(noscriptBody) || '';
    if (ns.length > (best ? best.text.length : 0)) best = { text: ns, src: '<noscript> fallback', score: ns.length };
    return best || { text: '', src: '', score: 0 };
  }

  /* ---------- reader overlay ---------- */
  var host = null, escHandler = null, readerCss = null;
  function paras(text) {
    var parts = text.split(/\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    if (parts.length >= 3) return parts;
    var sent = text.match(/[^.!?]+[.!?]*\s*/g) || [text], out = [], buf = '';
    for (var i = 0; i < sent.length; i++) {
      buf += sent[i];
      if (buf.length > 420) { out.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }
  function openReader(text, src) {
    if (host) return;
    host = document.createElement('div');
    host.id = 'unpaywall-reader';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646';
    var sh = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    readerCss = BM_injectStyle(
      '.bg{position:fixed;inset:0;overflow:auto;background:rgb(250,249,246);color:rgb(26,26,26);font:19px/1.7 Georgia,"Iowan Old Style",serif}' +
      '@media(prefers-color-scheme:dark){.bg{background:rgb(22,22,24);color:rgb(232,230,227)}}' +
      '.col{max-width:42rem;margin:0 auto;padding:76px 24px 96px}' +
      'h1{font:600 30px/1.25 system-ui,-apple-system,sans-serif;margin:0 0 10px}' +
      '.src{font:12px/1.4 system-ui,sans-serif;opacity:.55;margin:0 0 36px}' +
      'p{margin:0 0 1.15em}' +
      '.btn{position:fixed;top:16px;font:13px system-ui,sans-serif;padding:8px 15px;border:0;' +
      'border-radius:999px;background:rgb(30,30,32);color:rgb(255,255,255);cursor:pointer}' +
      '.close{right:16px}.copy{right:112px}' +
      '@media(prefers-color-scheme:dark){.btn{background:rgb(238,238,238);color:rgb(20,20,20)}}',
      sh
    );
    var bg = document.createElement('div'); bg.className = 'bg';
    var btn = document.createElement('button'); btn.className = 'btn close'; btn.textContent = 'close (Esc)';
    var cp = document.createElement('button'); cp.className = 'btn copy'; cp.textContent = 'copy';
    var col = document.createElement('div'); col.className = 'col';
    var h1 = document.createElement('h1');
    h1.textContent = (document.querySelector('h1') || {}).innerText || document.title || 'Article';
    var srcEl = document.createElement('p'); srcEl.className = 'src';
    srcEl.textContent = text.length.toLocaleString() + ' characters recovered from ' + src;
    col.appendChild(h1); col.appendChild(srcEl);
    paras(text).forEach(function (t) { var p = document.createElement('p'); p.textContent = t; col.appendChild(p); });
    bg.appendChild(btn); bg.appendChild(cp); bg.appendChild(col);
    sh.appendChild(bg);
    document.documentElement.appendChild(host);
    btn.addEventListener('click', closeReader);
    cp.addEventListener('click', function () {
      BM_safely(function () {
        navigator.clipboard.writeText(text).then(function () { cp.textContent = 'copied'; }, function () { cp.textContent = 'blocked'; });
      });
    });
    escHandler = function (ev) { if (ev.key === 'Escape') closeReader(); };
    document.addEventListener('keydown', escHandler, true);
  }
  function closeReader() {
    if (host) { host.remove(); host = null; }
    if (readerCss) { readerCss.remove(); readerCss = null; }
    if (escHandler) { document.removeEventListener('keydown', escHandler, true); escHandler = null; }
  }

  /* ---------- run ---------- */
  var art = findArticle();
  if (art && art.setAttribute) art.setAttribute('data-unpaywall-article', '1');

  var css = BM_injectStyle(
    'html,body{overflow:visible!important;overflow-y:auto!important;position:static!important;' +
    'height:auto!important;max-height:none!important}*{user-select:auto!important;-webkit-user-select:auto!important}' +
    /* Fade-to-white masks are usually a ::after pseudo-element, which no
       amount of getComputedStyle on real elements can see. Scoped to the
       article so this can't strip icons elsewhere on the page; it may still
       drop a background-image bullet or icon inside the article itself,
       which is a fair trade against losing the text. */
    '[data-unpaywall-article]::before,[data-unpaywall-article]::after,' +
    '[data-unpaywall-article] *::before,[data-unpaywall-article] *::after{' +
    'background-image:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'
  );

  var sp = function (ev) { ev.stopImmediatePropagation(); };
  var EV = ['contextmenu', 'selectstart', 'copy', 'cut'];
  EV.forEach(function (t) { document.addEventListener(t, sp, true); });

  function fullSweep() {
    BM_safely(unlock); BM_safely(function () { unclip(art); }); BM_safely(function () { reveal(art); }); BM_safely(killGatesFull);
  }
  fullSweep();

  /* Watches for 30s rather than 8 because metered paywalls commonly fire on
     scroll depth or a timer, well after load. Attribute watching is filtered
     to `class` deliberately: unlock() rewrites html/body `style` on every
     tick, so observing `style` would retrigger this callback forever. */
  var watcher = BM_watch(document.documentElement, function (records) {
    BM_safely(unlock);
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'attributes') { BM_safely(function () { considerGate(r.target); }); continue; }
      var added = r.addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) BM_safely(function () { BM_deepEach(added[j], considerGate, true); });
      }
    }
  }, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, 150, 30000);

  var rec = bestRecovered();
  var recovered = rec.text, rsrc = rec.src;

  /* Sanity check: a recovered blob should contain some of the text already
     on screen. Without this, a long unrelated string in a hydration payload
     (a privacy policy, another article in a feed) could be presented as
     "the full article". If it fails we keep the text but don't auto-open. */
  function visibleProbe() {
    var ps = art.querySelectorAll ? art.querySelectorAll('p') : [];
    for (var i = 0; i < ps.length; i++) {
      var t = (ps[i].innerText || '').trim().replace(/\s+/g, ' ');
      if (t.length > 120) return t.slice(0, 60).toLowerCase();
    }
    return '';
  }
  var probe = BM_safely(visibleProbe) || '';
  var related = !probe || recovered.replace(/\s+/g, ' ').toLowerCase().indexOf(probe) > -1;

  var visible = BM_tlen(art);
  var haveMore = recovered.length > 1200 && recovered.length > visible * 1.25 && related;
  if (haveMore) openReader(recovered, rsrc);

  window.__unpaywall = {
    reader: function () { if (recovered) openReader(recovered, rsrc || 'page source'); else BM_toast('no embedded full text found'); },
    text: function () { return recovered; },
    sources: function () { return (BM_safely(embeddedCandidates) || []).map(function (c) { return c.src + ' (' + c.raw.length + ')'; }); },
    undo: function () {
      watcher.stop(); closeReader();
      tracker.undo();
      document.querySelectorAll('[data-unpaywalled]').forEach(function (e) { e.removeAttribute('data-unpaywalled'); });
      if (art && art.removeAttribute) art.removeAttribute('data-unpaywall-article');
      EV.forEach(function (t) { document.removeEventListener(t, sp, true); });
      css.remove(); delete window.__unpaywall; BM_toast('restored');
    }
  };

  BM_toast('unpaywall: ' + nHidden + ' hidden, ' + nUnstuck + ' unstuck, ' + nShown + ' revealed' +
    (haveMore ? ' + full text from ' + rsrc
      : recovered
        ? (related ? ' (__unpaywall.reader() for full text)' : ' (found unrelated text; __unpaywall.reader() to inspect)')
        : '') +
    ' - click again to undo');
})();
