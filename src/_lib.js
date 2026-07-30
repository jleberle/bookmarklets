/*
  Shared helpers, inlined into every bookmarklet by build.js at the
  /*@include*\/ marker. Names are BM_-prefixed so they can't collide with a
  script's own locals once spliced into its IIFE.
*/

function BM_safely(f) { try { return f(); } catch (e) { return null; } }

function BM_tlen(e) {
  if (!e) return 0;
  /* innerText requires layout; detached clones (print.js) fall back to textContent */
  var t = e.isConnected ? e.innerText : e.textContent;
  return (t || '').trim().length;
}

/* Depth-first walk of root, every descendant, and every open shadow root
   beneath it. Closed shadow roots have no observation API and are skipped -
   there is no way to reach them from outside. Each call site wraps its own
   per-element work in BM_safely, so one hostile/broken element (a custom
   element whose accessor throws, a cross-origin frame) can't abort the walk. */
function BM_deepEach(root, fn, includeSelf) {
  if (includeSelf) fn(root);
  var kids = root.children;
  if (!kids) return;
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    fn(k);
    if (k.shadowRoot) BM_deepEach(k.shadowRoot, fn, false);
    BM_deepEach(k, fn, false);
  }
}

function BM_deepQueryAll(root, sel) {
  var out = [];
  BM_deepEach(root, function (e) { if (e.nodeType === 1 && e.matches(sel)) out.push(e); }, true);
  return out;
}

/* Whole-token class/id matcher. `re` must be ^...$-anchored. A bare substring
   test on tokens like "meter" or "gate" also hits "parameter", "diameter",
   "aggregate", "navigate", "gateway" - anchoring against each token (and each
   hyphen/underscore-split part, and each adjacent pair of parts, so a
   two-word idiom like "sign-up" still matches inside "sign-up-prompt") rules
   that out while still matching legitimate compounds like "tp-modal" (tested
   whole) or "newsletter-signup" (tested by parts). */
function BM_tokenMatch(el, re) {
  var raw = (el.getAttribute('class') || '') + ' ' + (el.id || '');
  var toks = raw.split(/\s+/);
  for (var i = 0; i < toks.length; i++) {
    if (!toks[i]) continue;
    if (re.test(toks[i])) return true;
    var parts = toks[i].split(/[-_]/);
    for (var j = 0; j < parts.length; j++) {
      if (re.test(parts[j])) return true;
      if (j < parts.length - 1 && re.test(parts[j] + '-' + parts[j + 1])) return true;
    }
  }
  return false;
}

/* Returns a predicate that's true for root itself, anything holding a/v/iframe
   media, or anything whose text is both >minChars and >share of root's total.
   This is the guard that stops "remove annoyances" from also removing the
   article - a class-name or geometry match alone is never enough reason to
   hide/remove something that turns out to be most of the page's content. */
function BM_textShareGuard(root, minChars, share) {
  var total = BM_tlen(root) || 1;
  return function (e) {
    if (e === root) return true;
    if (e.querySelector && BM_safely(function () { return e.querySelector('video,audio,iframe'); })) return true;
    var t = BM_tlen(e);
    return t > minChars && t > share * total;
  };
}

/* Records each element's original style attribute exactly once, so undo()
   can restore it verbatim (or remove the attribute if there wasn't one).
   undo() is idempotent - a second call is a no-op, not an error. */
function BM_styleTracker() {
  var log = [], seen = new WeakSet();
  function backup(e) {
    if (!seen.has(e)) { seen.add(e); log.push([e, e.getAttribute('style')]); }
  }
  return {
    set: function (e, prop, val) { backup(e); e.style.setProperty(prop, val, 'important'); },
    undo: function () {
      for (var i = log.length - 1; i >= 0; i--) {
        var v = log[i][1];
        v === null ? log[i][0].removeAttribute('style') : log[i][0].setAttribute('style', v);
      }
      log = [];
    }
  };
}

/* Prefers a constructable stylesheet over an injected <style> element -
   adoptedStyleSheets goes through CSSOM rather than markup parsing, so it
   isn't blocked by a strict style-src that only allows specific sources for
   <style>/style="". Falls back to a real element where unsupported. Works
   for `document` or any ShadowRoot passed as target. */
function BM_injectStyle(cssText, target) {
  target = target || document;
  if (window.CSSStyleSheet && target.adoptedStyleSheets !== undefined) {
    var sheet = BM_safely(function () {
      var s = new CSSStyleSheet();
      s.replaceSync(cssText);
      return s;
    });
    if (sheet) {
      target.adoptedStyleSheets = target.adoptedStyleSheets.concat(sheet);
      return { remove: function () {
        target.adoptedStyleSheets = target.adoptedStyleSheets.filter(function (s) { return s !== sheet; });
      } };
    }
  }
  var el = document.createElement('style');
  el.textContent = cssText;
  (target === document ? document.documentElement : target).appendChild(el);
  return { remove: function () { el.remove(); } };
}

/* Keys whose value is, by convention, the article body itself. A hit here
   outranks the heuristic below, since the site has effectively labelled it. */
var BM_PROSE_KEY = /^(articleBody|body|bodyHtml|bodyHTML|content|contentHtml|text|richText|articleText|storyHtml|fullText|rawBody)$/i;

/* Is this string plausibly article prose rather than a URL, a base64 blob,
   minified CSS/JS, or a config value? Hydration payloads are full of long
   strings; this is what keeps an API key or a CDN URL from being presented
   as recovered article text. */
function BM_looksLikeProse(s) {
  if (typeof s !== 'string' || s.length < 400) return false;
  if (/^(https?:|data:|\/\/|[\w+\/=]{300,}$)/.test(s)) return false;
  /* sample the head rather than allocating a match array over a huge string */
  var head = s.slice(0, 2000), spaces = 0;
  for (var i = 0; i < head.length; i++) { var ch = head.charCodeAt(i); if (ch === 32 || ch === 10) spaces++; }
  if (spaces / head.length < 0.08) return false;
  return /[.!?]["'”]?(\s|$)/.test(s);
}

/* Depth- and count-bounded walk of a parsed JSON payload, collecting every
   string that is either prose-shaped or sits under a known body key.
   Bounds matter: some hydration blobs are megabytes of deeply nested state. */
function BM_harvestStrings(node, depth, out) {
  if (!node || typeof node !== 'object' || depth > 8 || out.length > 300) return;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length && i < 400; i++) BM_harvestStrings(node[i], depth + 1, out);
    return;
  }
  for (var k in node) {
    var v = node[k];
    if (typeof v === 'string') {
      var keyed = BM_PROSE_KEY.test(k);
      if (keyed || BM_looksLikeProse(v)) out.push({ keyed: keyed, raw: v });
    } else if (v && typeof v === 'object') BM_harvestStrings(v, depth + 1, out);
  }
}

function BM_toast(msg) {
  var d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;z-index:2147483647;bottom:16px;right:16px;padding:7px 12px;' +
    'font:13px system-ui,sans-serif;background:rgba(20,20,20,.93);color:rgb(255,255,255);' +
    'border-radius:6px;pointer-events:none;max-width:70vw';
  document.documentElement.appendChild(d);
  setTimeout(function () { d.remove(); }, 2600);
  return d;
}

/* <dialog>, the Popover API, and `inert` are the overlay/interaction-blocking
   mechanisms in current use; a site adopting something newer will need a new
   case added here. Pierces shadow roots via BM_deepQueryAll. */
function BM_closeOverlays(root) {
  BM_deepQueryAll(root, 'dialog[open]').forEach(function (d) { BM_safely(function () { d.close(); }); });
  BM_deepQueryAll(root, '[popover]').forEach(function (p) {
    BM_safely(function () { if (p.hidePopover && p.matches(':popover-open')) p.hidePopover(); });
  });
  BM_deepQueryAll(root, '[inert]').forEach(function (e) { e.removeAttribute('inert'); });
}

/* Restores document scroll/position/overflow after a scroll-lock script has
   clamped them, and closes overlays via BM_closeOverlays. Shared by clean.js
   and unpaywall.js, which both fight the same scroll-lock pattern.
   stripPaddingRight strips a compensating scrollbar-gap padding some
   scroll-lock scripts add - only clean.js wants that, since unpaywall
   targets the article rather than chrome-level layout. */
function BM_unlockScroll(tracker, stripPaddingRight) {
  [document.documentElement, document.body].forEach(function (e) {
    if (!e) return;
    tracker.set(e, 'overflow', 'visible'); tracker.set(e, 'overflow-y', 'auto');
    tracker.set(e, 'position', 'static'); tracker.set(e, 'height', 'auto');
    tracker.set(e, 'max-height', 'none'); tracker.set(e, 'touch-action', 'auto');
    tracker.set(e, 'overscroll-behavior', 'auto'); tracker.set(e, 'filter', 'none');
    tracker.set(e, 'pointer-events', 'auto');
    if (stripPaddingRight) {
      var q = parseFloat(getComputedStyle(e).paddingRight) || 0;
      if (q > 0 && q < 40) tracker.set(e, 'padding-right', '0');
    }
  });
  BM_closeOverlays(document.documentElement);
}

/* Debounced MutationObserver that self-limits to maxMs. fn receives the raw
   MutationRecord list so callers can process only what changed instead of
   re-scanning the whole document on every tick. stop() clears BOTH the
   observer and any already-queued debounced callback - calling disconnect()
   alone leaves a pending setTimeout that fires after "undo" already returned,
   silently re-applying changes that then can't be undone. */
function BM_watch(target, fn, opts, debounceMs, maxMs) {
  var t = null;
  var mo = new MutationObserver(function (records) {
    clearTimeout(t);
    t = setTimeout(function () { fn(records); }, debounceMs);
  });
  mo.observe(target, opts);
  var life = setTimeout(function () { mo.disconnect(); }, maxMs);
  return { stop: function () { clearTimeout(t); clearTimeout(life); mo.disconnect(); } };
}
