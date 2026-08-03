/*
  print - extract the article into a clean, ink-frugal print layout.
  Clones the content and strips every attribute except a small allowlist, so
  the site's own stylesheet has nothing left to match - dark themes, custom
  fonts and layout hacks are gone by construction rather than by overriding
  them. Shows a live page-count/word-count estimate before you commit paper.

  Limitation: cloneNode(true) does not carry shadow DOM across the clone (this
  is a DOM spec constraint, not something fixable here), so content rendered
  inside a shadow root - a web-component-based article body, for instance -
  will not appear in the extracted output.
*/
/*@include*/
(function () {
  if (window.__printfmt) { window.__printfmt.close(); return; }

  var JUNKSEL = 'script,style,noscript,iframe,form,button,input,select,textarea,svg,video,audio,canvas,' +
    'nav,aside,footer,header,object,embed,dialog,template,' +
    '[role="navigation"],[role="banner"],[role="complementary"],[role="dialog"],[aria-hidden="true"],[hidden]';
  var JUNKTOK = /^(ad|ads|advert|advertisement|promo|promos|sponsor|sponsored|share|sharing|social|related|recirc|recommend|recommended|newsletter|subscribe|subscription|comment|comments|disqus|sidebar|nav|navigation|menu|breadcrumb|breadcrumbs|toolbar|widget|popup|modal|cookie|consent|banner|paywall|meta|tags|taglist|trending|morefrom|readmore|nextup|outbrain|taboola)$/i;
  var KEEPATTR = /^(href|src|alt|title|colspan|rowspan|datetime|start|type|reversed)$/i;
  var PAGE_MM = 279.4, MARGIN_MM = 18, COL_MM = 170;

  /* ---------- find the main content ---------- */
  function scoreOf(n) {
    var t = BM_tlen(n);
    if (t < 200) return 0;
    var links = 0, as = n.querySelectorAll('a');
    for (var i = 0; i < as.length; i++) links += (as[i].innerText || '').length;
    var density = links / t;
    var ps = n.querySelectorAll('p').length;
    if (ps < 1) return 0;
    return (t + ps * 80) * (density > 0.45 ? 0.15 : 1);
  }
  function tighten(n) {
    for (var guard = 0; guard < 12; guard++) {
      var kids = [], c = n.children;
      for (var i = 0; i < c.length; i++) if (!/^(SCRIPT|STYLE)$/.test(c[i].tagName)) kids.push(c[i]);
      var nText = BM_tlen(n);
      var big = kids.filter(function (k) { return BM_tlen(k) > 0.9 * nText; });
      if (big.length === 1 && big[0].querySelectorAll('p').length >= 1) n = big[0]; else break;
    }
    return n;
  }
  /* Fallback when none of the named article selectors hit: tally each <p>'s
     text mass onto its ancestors (up to 4 hops) in one pass, then take the
     highest-scoring ancestor. A single querySelectorAll('p') plus a bounded
     ancestor walk, versus re-scoring every div/section/td on the page with
     two nested querySelectorAll calls each - the fallback only runs on sites
     where the priority selectors already failed, i.e. exactly the messy
     ones, so this is the path most worth keeping cheap. */
  function scoredFallback() {
    var tally = new Map();
    BM_deepQueryAll(document.body, 'p').forEach(function (p) {
      var t = BM_tlen(p);
      if (t < 25) return;
      var anc = p.parentElement, hops = 0;
      while (anc && hops < 4) {
        tally.set(anc, (tally.get(anc) || 0) + t);
        anc = anc.parentElement; hops++;
      }
    });
    var best = null, bs = 0;
    tally.forEach(function (score, el) { if (score > bs) { bs = score; best = el; } });
    return best;
  }
  function findMain() {
    var priority = ['[itemprop="articleBody"]', '[class*="article-body"]', '[class*="article__body"]',
      '[class*="story-body"]', '[class*="entry-content"]', '[class*="post-content"]', 'article', '[role="main"]', 'main'];
    for (var i = 0; i < priority.length; i++) {
      var nodes = BM_safely(function () { return document.querySelectorAll(priority[i]); }) || [];
      var best = null, bs = 0;
      for (var j = 0; j < nodes.length; j++) { var s = scoreOf(nodes[j]); if (s > bs) { bs = s; best = nodes[j]; } }
      if (best) return tighten(best);
    }
    var b = scoredFallback();
    return b ? tighten(b) : document.body;
  }

  /* ---------- clean the clone ---------- */
  function clean(root) {
    /* detached clones have no layout; BM_tlen falls back to textContent */
    var keeps = BM_textShareGuard(root, 0, 0.3);
    root.querySelectorAll(JUNKSEL).forEach(function (e) { if (!keeps(e)) e.remove(); });
    root.querySelectorAll('*').forEach(function (e) { if (BM_tokenMatch(e, JUNKTOK) && !keeps(e)) e.remove(); });
    root.querySelectorAll('img').forEach(function (im) {
      var src = im.getAttribute('src') || '';
      var lazy = im.getAttribute('data-src') || im.getAttribute('data-original') || '';
      /* Resolve and allowlist the protocol before trusting a lazy-load
         attribute as the real src - same reasoning as the href allowlist
         below, applied to img rather than a. */
      var lazyUrl = lazy && BM_safely(function () { return new URL(lazy, location.href); });
      if (lazyUrl && /^(https?|data):$/.test(lazyUrl.protocol) && (!src || /^data:|placeholder|blank|spacer/i.test(src))) {
        im.setAttribute('src', lazyUrl.href); src = lazyUrl.href;
      }
      var w = parseInt(im.getAttribute('width') || '0', 10), h = parseInt(im.getAttribute('height') || '0', 10);
      if (!src || (w && w < 60) || (h && h < 60)) im.remove();
    });
    root.querySelectorAll('a').forEach(function (a) {
      /* Allowlist the resolved protocol rather than blocklisting the raw
         href - a raw href of "data:..." or "vbscript:..." would otherwise
         survive into the clickable preview alongside real links. */
      var h = a.getAttribute('href') || '';
      var resolved = h && BM_safely(function () { return new URL(h, location.href); });
      if (!resolved || !/^(https?|mailto):$/.test(resolved.protocol)) {
        var s = document.createElement('span'); s.textContent = a.textContent; a.replaceWith(s); return;
      }
      a.setAttribute('href', resolved.href);
    });
    root.querySelectorAll('*').forEach(function (e) {
      var at = e.attributes;
      for (var i = at.length - 1; i >= 0; i--) if (!KEEPATTR.test(at[i].name)) e.removeAttribute(at[i].name);
    });
    root.querySelectorAll('p,div,li,td,span').forEach(function (e) {
      if (!e.children.length && !(e.textContent || '').trim()) e.remove();
    });
    return root;
  }

  /* ---------- build preview ---------- */
  var main = findMain();
  var doc = clean(main.cloneNode(true));

  var title = BM_safely(function () {
    var h = document.querySelector('h1');
    return (h && (h.innerText || '').trim()) || document.title || location.hostname;
  }) || location.hostname;
  var byline = BM_safely(function () {
    var b = document.querySelector('[itemprop="author"],[rel="author"],[class*="byline"],[class*="author"]');
    return b ? (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160) : '';
  }) || '';
  var dateStr = BM_safely(function () {
    var t = document.querySelector('time[datetime],time');
    return t ? (t.innerText || t.getAttribute('datetime') || '').trim() : '';
  }) || '';

  var host = document.createElement('div');
  host.id = 'pf-host';

  var css = BM_injectStyle([
    '@page{margin:' + MARGIN_MM + 'mm 16mm}',
    '#pf-host{position:fixed;inset:0;z-index:2147483645;overflow:auto;background:rgb(140,140,145)}',
    '#pf-bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;',
    'padding:10px 14px;background:rgb(28,28,30);color:rgb(245,245,245);font:13px system-ui,-apple-system,sans-serif}',
    '#pf-bar button,#pf-bar select{font:13px system-ui,sans-serif;padding:5px 10px;border:0;border-radius:6px;',
    'background:rgb(70,70,76);color:rgb(245,245,245);cursor:pointer}',
    '#pf-bar button.go{background:rgb(58,132,247);font-weight:600}',
    '#pf-est{opacity:.75;margin-left:auto}',
    '#pf-sheet{background:rgb(255,255,255);margin:22px auto 60px;padding:' + MARGIN_MM + 'mm 0;width:' + (COL_MM + 32) + 'mm;',
    'box-shadow:0 2px 14px rgba(0,0,0,.35)}',
    '#pf-doc{all:initial;display:block;width:' + COL_MM + 'mm;margin:0 auto;',
    'font:11pt/1.5 Georgia,"Iowan Old Style","Times New Roman",serif;color:rgb(0,0,0);text-rendering:optimizeLegibility}',
    '#pf-doc *{all:unset;display:revert;box-sizing:border-box;max-width:100%;background:transparent!important;color:rgb(0,0,0)!important}',
    '#pf-doc p{display:block;margin:0 0 .75em;orphans:3;widows:3;text-align:left}',
    '#pf-doc h1{display:block;font:700 20pt/1.2 inherit;margin:0 0 .25em;break-after:avoid;page-break-after:avoid}',
    '#pf-doc h2{display:block;font:700 14pt/1.25 inherit;margin:1.4em 0 .4em;break-after:avoid;page-break-after:avoid}',
    '#pf-doc h3,#pf-doc h4{display:block;font:700 12pt/1.3 inherit;margin:1.2em 0 .35em;break-after:avoid;page-break-after:avoid}',
    '#pf-doc ul,#pf-doc ol{display:block;margin:0 0 .75em;padding-left:1.5em}',
    '#pf-doc ul li{display:list-item;list-style:disc}#pf-doc ol li{display:list-item;list-style:decimal}',
    '#pf-doc li{margin:0 0 .3em}',
    '#pf-doc blockquote{display:block;margin:1em 0;padding-left:12pt;border-left:2pt solid rgb(170,170,170);font-style:italic;break-inside:avoid;page-break-inside:avoid}',
    '#pf-doc pre{display:block;font:9.5pt/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-wrap:break-word;',
    'border:.5pt solid rgb(190,190,190);padding:6pt;margin:0 0 .75em;break-inside:avoid;page-break-inside:avoid}',
    '#pf-doc code{font:9.5pt ui-monospace,Menlo,Consolas,monospace}',
    '#pf-doc img{display:block;max-width:100%;max-height:95mm;height:auto;margin:.8em auto;break-inside:avoid;page-break-inside:avoid}',
    '#pf-doc figure{display:block;margin:1em 0;break-inside:avoid;page-break-inside:avoid}',
    '#pf-doc figcaption{display:block;font:9pt/1.35 system-ui,sans-serif;color:rgb(75,75,75)!important;margin-top:.35em}',
    '#pf-doc table{display:table;border-collapse:collapse;width:100%;margin:1em 0;font-size:9.5pt;break-inside:avoid;page-break-inside:avoid}',
    '#pf-doc tr{display:table-row}#pf-doc td,#pf-doc th{display:table-cell;border:.5pt solid rgb(150,150,150);padding:4pt;vertical-align:top}',
    '#pf-doc th{font-weight:700}',
    '#pf-doc a{color:rgb(0,0,0)!important;text-decoration:underline}',
    '#pf-doc strong,#pf-doc b{font-weight:700}#pf-doc em,#pf-doc i{font-style:italic}',
    '#pf-doc hr{display:block;border:0;border-top:.5pt solid rgb(180,180,180);margin:1.2em 0}',
    '#pf-head{display:block;margin:0 0 1.4em;padding-bottom:.6em;border-bottom:.5pt solid rgb(170,170,170)}',
    '#pf-head .sub{display:block;font:9pt/1.4 system-ui,sans-serif;color:rgb(80,80,80)!important;margin-top:.5em;word-break:break-all}',
    '#pf-doc.noimg img,#pf-doc.noimg figure{display:none!important}',
    '#pf-doc.grayimg img{filter:grayscale(1) contrast(1.05)}',
    '#pf-doc.urls a[href^="http"]::after{content:" <" attr(href) ">";font:8pt system-ui,sans-serif;color:rgb(90,90,90)!important;word-break:break-all}',
    '@media print{',
    'html,body{height:auto!important;max-height:none!important;overflow:visible!important;background:rgb(255,255,255)!important;margin:0!important;padding:0!important}',
    'body>*{display:none!important}',
    'body>#pf-host{display:block!important;position:static!important;overflow:visible!important;background:none!important}',
    '#pf-bar{display:none!important}',
    '#pf-sheet{margin:0!important;padding:0!important;width:auto!important;box-shadow:none!important;background:none!important}',
    '#pf-doc{width:auto!important}',
    '}'
  ].join(''));

  var bar = document.createElement('div');
  bar.id = 'pf-bar';
  function mk(tag, txt, cls) { var e = document.createElement(tag); if (txt) e.textContent = txt; if (cls) e.className = cls; return e; }
  var bPrint = mk('button', 'Print', 'go');
  var selImg = document.createElement('select');
  [['keep', 'Images: keep'], ['gray', 'Images: grayscale'], ['none', 'Images: none']].forEach(function (o) {
    var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; selImg.appendChild(op);
  });
  var bUrls = mk('button', 'Link URLs: off');
  var bMinus = mk('button', 'A-'), bPlus = mk('button', 'A+');
  var est = mk('span', '', ''); est.id = 'pf-est';
  var bClose = mk('button', 'Close (Esc)');
  [bPrint, selImg, bUrls, bMinus, bPlus, bClose, est].forEach(function (e) { bar.appendChild(e); });

  var sheet = document.createElement('div'); sheet.id = 'pf-sheet';
  var page = document.createElement('div'); page.id = 'pf-doc';
  var head = document.createElement('div'); head.id = 'pf-head';
  var h1 = document.createElement('h1'); h1.textContent = title;
  var sub = document.createElement('span'); sub.className = 'sub';
  sub.textContent = [byline, dateStr].filter(Boolean).join('  ·  ') + (byline || dateStr ? '\n' : '') + location.href;
  head.appendChild(h1); head.appendChild(sub);
  page.appendChild(head); page.appendChild(doc);
  sheet.appendChild(page);
  host.appendChild(bar); host.appendChild(sheet);
  document.body.appendChild(host);

  /* ---------- page estimate ---------- */
  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:100mm';
  document.body.appendChild(probe);
  var pxPerMm = probe.offsetHeight / 100 || 3.78;
  probe.remove();
  function estimate() {
    var contentPx = (PAGE_MM - MARGIN_MM * 2) * pxPerMm;
    var pages = Math.max(1, Math.ceil(page.scrollHeight / contentPx));
    var words = (page.innerText || '').trim().split(/\s+/).length;
    est.textContent = '≈ ' + pages + ' page' + (pages > 1 ? 's' : '') + '  ·  ' + words.toLocaleString() + ' words';
  }
  estimate();

  /* ---------- controls ---------- */
  var fs = 11;
  selImg.addEventListener('change', function () {
    page.classList.remove('noimg', 'grayimg');
    if (selImg.value === 'none') page.classList.add('noimg');
    if (selImg.value === 'gray') page.classList.add('grayimg');
    estimate();
  });
  bUrls.addEventListener('click', function () {
    page.classList.toggle('urls');
    bUrls.textContent = 'Link URLs: ' + (page.classList.contains('urls') ? 'on' : 'off');
    estimate();
  });
  function setFs(v) { fs = Math.min(16, Math.max(8, v)); page.style.fontSize = fs + 'pt'; estimate(); }
  bMinus.addEventListener('click', function () { setFs(fs - 0.5); });
  bPlus.addEventListener('click', function () { setFs(fs + 0.5); });
  bPrint.addEventListener('click', function () { window.print(); });

  var esc = function (ev) { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', esc, true);
  function close() {
    document.removeEventListener('keydown', esc, true);
    host.remove(); css.remove(); delete window.__printfmt;
  }
  bClose.addEventListener('click', close);
  window.__printfmt = { close: close, node: page };
})();
