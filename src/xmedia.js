/*
  xmedia - show the photo/video CDN URLs already embedded in an X/Twitter
  page's HTML, full-size, in a popup - the same trick unpaywall.js uses for
  soft-paywalled text, applied to the "log in to see this" wall X shows
  logged-out visitors over media. It never logs in, authenticates, or calls
  any API: it only regex-matches pbs.twimg.com/video.twimg.com URLs already
  sent to the browser, from the live DOM plus a re-fetch of the same URL (the
  raw HTML can carry media the rendered DOM already dropped, e.g. once a
  timeline virtualizes offscreen tweets).

  The popup opens synchronously, before the re-fetch's promise resolves -
  window.open() after an await/then has already lost the click's user
  gesture and gets treated as an unrequested popup. Repeat clicks reuse the
  same popup (tracked on window.__xmedia) instead of piling up tabs.
*/
(function () {
  function write(win, body) {
    win.document.open();
    win.document.write('<title>media</title><body style="margin:0;padding:14px;background:rgb(17,17,17);' +
      'color:rgb(210,210,210);font:14px system-ui,sans-serif">' + body + '</body>');
    win.document.close();
  }
  function show(win, html) {
    if (win.closed) return;
    html = html.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    var seen = {}, imgs = [];
    (html.match(/https:\/\/pbs\.twimg\.com\/media\/[\w-]+/g) || []).forEach(function (u) {
      if (!seen[u]) { seen[u] = true; imgs.push(u); }
    });
    var best = {};
    (html.match(/https:\/\/video\.twimg\.com\/[^"'\s\\<>]+?\.mp4(?:\?[^"'\s\\<>]*)?/g) || []).forEach(function (u) {
      var k = u.split('/vid/')[0];
      var m = u.match(/\/(\d+)x(\d+)\//);
      var area = m ? (+m[1]) * (+m[2]) : 1;
      if (!best[k] || area > best[k].area) best[k] = { u: u, area: area };
    });
    var st = 'style="max-width:100%;max-height:90vh;display:block;margin:0 auto 14px"';
    var out = imgs.map(function (u) {
      var full = u + '?format=jpg&name=orig';
      return '<a href="' + full + '" target="_blank" rel="noopener noreferrer">' +
        '<img src="' + full + '" ' + st + '></a>';
    }).join('');
    var keys = [];
    for (var k2 in best) { if (best.hasOwnProperty(k2)) keys.push(k2); }
    out += keys.map(function (k) {
      return '<video src="' + best[k].u + '" controls playsinline ' + st + '></video>';
    }).join('');
    write(win, out || '<p>No media found on this page.</p>');
  }

  var win = window.__xmedia;
  if (!win || win.closed) {
    win = window.open('', 'bm-xmedia', 'width=900,height=700');
    if (!win) { alert('Popup blocked - allow popups for this bookmarklet, then click it again.'); return; }
    window.__xmedia = win;
  } else {
    win.focus();
  }
  write(win, '<p style="opacity:.7">Loading media…</p>');

  var raw = document.documentElement.innerHTML;
  var started = false;
  try {
    fetch(location.href).then(function (r) { return r.text(); }).then(function (extra) {
      show(win, raw + extra);
    }).catch(function () { show(win, raw); });
    started = true;
  } catch (e) {}
  if (!started) show(win, raw);
})();
