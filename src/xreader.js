/*
  xreader - render an X/Twitter tweet and its replies as a minimal,
  Nitter/xcancel-style reading list in a popup: avatar, name, handle, time,
  text, media, and counts - no chrome, no "log in to see replies" wall.

  Same read-only scope as xmedia and unpaywall: it never logs in, never
  calls an API, and only reads what a re-fetch of location.href already
  hands the browser. That re-fetch turns out to matter twice over here -
  X's simplified logged-out markup has no data-testid hooks to key off of,
  so structure is read positionally/by-attribute instead, and the same
  markup's <img>/<video> tags are only populated with real URLs in that raw
  HTML; the live, hydrated DOM leaves them as unloaded placeholders (a
  bandwidth-saving lazy-load gate that plain fetch()/DOMParser bypasses,
  since nothing there ever scrolls into view). A tweet's absolute or
  relative time string is likewise only in the raw HTML text - the exact
  timestamp is written in afterwards by an inline <script>, which
  DOMParser never executes.

  Video URLs live outside the <video> tag entirely (a bare <poster>, no
  <source>) - they're recovered the way xmedia recovers them, by
  regex-matching video.twimg.com URLs anywhere in the page text, then
  matched back to the right tweet via the numeric id both the poster
  thumbnail and the video URL encode (amplify_video/ext_tw_video/
  tweet_video, whichever the tweet uses).

  A reply that quotes another tweet nests a second <article> inside the
  reply's own - own-scope helpers throughout (ownScope, the id-suffixed
  href match for time) make sure a reply's fields never get read from that
  nested tweet by accident. The quoted tweet itself is shown as a small
  handle+text card, text only - no recursion into further nesting.

  Limitation: this only surfaces whatever X's logged-out markup already
  rendered for the current fetch - a reply thread deep enough to need its
  own "show more replies" pagination click stays out of reach, same as a
  hard paywall stays out of reach for unpaywall.
*/
(function () {
  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isTop(a) { return !a.parentElement || !a.parentElement.closest('article'); }
  function ownScope(a, sel) {
    return [].slice.call(a.querySelectorAll(sel)).filter(function (e) { return e.closest('article') === a; });
  }
  function statusId(a) {
    var r = a.querySelector('[aria-label="Reply"]');
    var m = r && (r.getAttribute('href') || '').match(/status\/(\d+)$/);
    return m ? m[1] : null;
  }
  function displayName(a, handle) {
    var as = a.querySelectorAll('a'), i, href, txt;
    for (i = 0; i < as.length; i++) {
      href = as[i].getAttribute('href') || ''; txt = (as[i].textContent || '').trim();
      if (txt && txt.charAt(0) !== '@' && href.indexOf(handle) !== -1) return txt;
    }
    return handle;
  }
  var TIME_RE = /^(\d+[smhd]|[A-Za-z]{3} \d{1,2}(, \d{4})?|\d{1,2}:\d{2}\s?[AP]M\s?·\s?[A-Za-z]{3}\s\d{1,2},\s\d{4})$/;
  function ownTime(a, id) {
    var cands = ownScope(a, 'a[href$="/status/' + id + '"]'), i, txt;
    for (i = 0; i < cands.length; i++) {
      txt = (cands[i].textContent || '').trim();
      if (TIME_RE.test(txt)) return txt;
    }
    return '';
  }
  function bestVideos(raw) {
    var best = {};
    (raw.match(/https:\/\/video\.twimg\.com\/[^"'\s\\<>]+?\.mp4(?:\?[^"'\s\\<>]*)?/g) || []).forEach(function (u) {
      var idm = u.match(/amplify_video\/(\d+)\//) || u.match(/ext_tw_video\/(\d+)\//) || u.match(/tweet_video\/(\d+)\//);
      var k = idm ? idm[1] : u.split('/vid/')[0];
      var m = u.match(/\/(\d+)x(\d+)\//), area = m ? (+m[1]) * (+m[2]) : 1;
      if (!best[k] || area > best[k].area) best[k] = { u: u, area: area };
    });
    return best;
  }
  function videoFor(a, vidBest) {
    var el = ownScope(a, 'video')[0];
    if (!el) return null;
    var m = (el.getAttribute('poster') || '').match(/amplify_video_thumb\/(\d+)\/|ext_tw_video_thumb\/(\d+)\/|tweet_video_thumb\/(\d+)\//);
    var key = m && (m[1] || m[2] || m[3]);
    return key && vidBest[key] ? vidBest[key].u : null;
  }
  function imagesFor(a) {
    return ownScope(a, 'img[src*="pbs.twimg.com/media"]').map(function (im) {
      var m = (im.getAttribute('src') || '').match(/^https:\/\/pbs\.twimg\.com\/media\/[\w-]+/);
      return m ? m[0] + '?format=jpg&name=orig' : null;
    }).filter(function (u) { return u; });
  }
  function stat(a, label) {
    var e = ownScope(a, '[aria-label="' + label + '"]')[0];
    return e ? (e.textContent || '').trim() : '';
  }

  function extract(doc, raw) {
    var vidBest = bestVideos(raw);
    var all = [].slice.call(doc.querySelectorAll('article')).filter(isTop);
    var seen = {}, out = [];
    all.forEach(function (a) {
      var id = statusId(a);
      if (!id || seen[id]) return;
      seen[id] = 1;
      var avatarImg = a.querySelector('img[alt^="@"]');
      var handle = avatarImg ? avatarImg.getAttribute('alt') : '';
      var avatar = avatarImg ? avatarImg.getAttribute('src') : '';
      var name = displayName(a, handle.replace(/^@/, ''));
      var textDiv = ownScope(a, 'div[dir="auto"]')[0];
      var nested = a.querySelector('article'), quote = null;
      if (nested) {
        var qh = nested.querySelector('img[alt^="@"]');
        var qt = nested.querySelector('div[dir="auto"]');
        quote = { handle: qh ? qh.getAttribute('alt') : '', text: qt ? qt.textContent.trim() : '' };
      }
      out.push({
        id: id, name: name, handle: handle, avatar: avatar,
        time: ownTime(a, id), text: textDiv ? textDiv.textContent.trim() : '',
        imgs: imagesFor(a), video: videoFor(a, vidBest), quote: quote,
        reply: stat(a, 'Reply'), repost: stat(a, 'Repost'), like: stat(a, 'Like')
      });
    });
    return out;
  }

  function media(t) {
    var st = 'style="max-width:100%;border-radius:8px;display:block;margin-top:8px"';
    var out = t.imgs.map(function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' +
        '<img src="' + u + '" ' + st + '></a>';
    }).join('');
    if (t.video) out += '<video src="' + t.video + '" controls playsinline ' + st + '></video>';
    return out;
  }
  function card(t, primary) {
    var handleUrl = 'https://x.com/' + t.handle.replace(/^@/, '') + '/status/' + t.id;
    var head = '<div class="hd">' +
      (t.avatar ? '<img class="av" src="' + t.avatar + '" alt="">' : '') +
      '<div class="who"><span class="nm">' + esc(t.name) + '</span>' +
      '<span class="hn">' + esc(t.handle) + '</span></div>' +
      (t.time ? '<a class="tm" href="' + handleUrl + '" target="_blank" rel="noopener noreferrer">' + esc(t.time) + '</a>' : '') +
      '</div>';
    var body = '<div class="tx">' + esc(t.text).replace(/\n/g, '<br>') + '</div>';
    var quote = t.quote ? '<div class="qt"><span class="hn">' + esc(t.quote.handle) + '</span> ' +
      esc(t.quote.text).replace(/\n/g, '<br>') + '</div>' : '';
    var stats = '<div class="st">' +
      '<span>💬 ' + esc(t.reply || '0') + '</span>' +
      '<span>🔁 ' + esc(t.repost || '0') + '</span>' +
      '<span>♡ ' + esc(t.like || '0') + '</span></div>';
    return '<div class="tw' + (primary ? ' main' : '') + '">' + head + body + media(t) + quote + stats + '</div>';
  }

  function render(win, tweets) {
    if (win.closed) return;
    if (!tweets.length) { write(win, '<p class="empty">No tweet found on this page.</p>'); return; }
    var out = card(tweets[0], true);
    if (tweets.length > 1) {
      out += '<div class="sep">Replies</div>';
      out += tweets.slice(1).map(function (t) { return card(t, false); }).join('');
    }
    write(win, out);
  }

  function write(win, body) {
    win.document.open();
    win.document.write('<title>tweet</title><style>' +
      ':root{color-scheme:light dark}' +
      'body{margin:0;padding:0 0 40px;background:rgb(255,255,255);color:rgb(15,20,25);' +
      'font:15px/1.4 -apple-system,system-ui,"Segoe UI",sans-serif}' +
      '.tw{max-width:600px;margin:0 auto;padding:14px 18px;border-bottom:1px solid rgb(230,233,234)}' +
      '.tw.main{padding-top:20px;padding-bottom:16px}' +
      '.tw.main .tx{font-size:19px}' +
      '.hd{display:flex;align-items:center;gap:8px;margin-bottom:6px}' +
      '.av{width:36px;height:36px;border-radius:50%;object-fit:cover;flex:none}' +
      '.who{display:flex;flex-direction:column;min-width:0;flex:1}' +
      '.nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.hn{color:rgb(83,100,113);font-size:13px}' +
      '.tm{color:rgb(83,100,113);font-size:13px;text-decoration:none;flex:none}' +
      '.tm:hover{text-decoration:underline}' +
      '.tx{white-space:pre-wrap;word-wrap:break-word}' +
      '.qt{margin-top:8px;padding:8px 10px;border:1px solid rgb(230,233,234);border-radius:8px;font-size:14px;color:rgb(83,100,113)}' +
      '.st{display:flex;gap:18px;margin-top:10px;color:rgb(83,100,113);font-size:13px}' +
      '.sep{max-width:600px;margin:0 auto;padding:10px 18px;font-weight:700;color:rgb(83,100,113);' +
      'border-bottom:1px solid rgb(230,233,234)}' +
      '.empty{text-align:center;padding:40px 18px;color:rgb(83,100,113)}' +
      '@media (prefers-color-scheme:dark){body{background:rgb(0,0,0);color:rgb(231,233,234)}' +
      '.tw,.sep{border-color:rgb(47,51,54)}.qt{border-color:rgb(47,51,54)}}' +
      '</style><body>' + body + '</body>');
    win.document.close();
  }

  var win = window.__xreader;
  if (!win || win.closed) {
    win = window.open('', 'bm-xreader', 'width=640,height=800');
    if (!win) { alert('Popup blocked - allow popups for this bookmarklet, then click it again.'); return; }
    window.__xreader = win;
  } else {
    win.focus();
  }
  write(win, '<p class="empty">Loading…</p>');

  var started = false;
  try {
    fetch(location.href).then(function (r) { return r.text(); }).then(function (rawText) {
      var raw = rawText.replace(/\\\//g, '/').replace(/&amp;/g, '&');
      var doc = new DOMParser().parseFromString(raw, 'text/html');
      render(win, extract(doc, raw));
    }).catch(function () { write(win, '<p class="empty">Could not load this page.</p>'); });
    started = true;
  } catch (e) {}
  if (!started) write(win, '<p class="empty">Could not load this page.</p>');
})();
