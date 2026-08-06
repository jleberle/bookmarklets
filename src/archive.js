/*
  archive - view or save the current page on Archive.today and the
  Wayback Machine. Toggles a small menu of the four actions; click again
  (or Esc, or click outside) closes it without navigating anywhere.
  No lib helpers needed - this never touches the page's own DOM content.

  Strips known email/social tracking params (utm_*, emc, nl, segment_id,
  fbclid, gclid, ...) before building the links. An archived snapshot is
  keyed on the exact URL a crawler saved, which never includes the tracking
  string a newsletter or share link appended - leaving it in gets a
  "no page found" instead of the real archive.
*/
(function () {
  var ID = 'bm-archive-menu';
  var existing = document.getElementById(ID);
  if (existing) { existing.remove(); return; }

  var TRACKING_EXACT = /^(fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|ref_url|spm|_hsenc|_hsmi|mkt_tok|vero_id|yclid|ito|smid|smtyp|cmp|cmpid|emc|nl|segment_id|s_cid|icid|ncid|elqtrackid|trk|trkcampaign)$/i;
  var TRACKING_PREFIX = /^utm_/i;

  function cleanHref() {
    var u;
    try { u = new URL(location.href); } catch (e) { return location.href; }
    var drop = [];
    u.searchParams.forEach(function (v, k) {
      if (TRACKING_PREFIX.test(k) || TRACKING_EXACT.test(k)) drop.push(k);
    });
    drop.forEach(function (k) { u.searchParams.delete(k); });
    return u.href;
  }

  var url = encodeURIComponent(cleanHref());
  var links = [
    { label: 'View on Archive.today', href: 'https://archive.ph/newest/' + url },
    { label: 'Save to Archive.today', href: 'https://archive.ph/?run=1&url=' + url },
    { label: 'View on Wayback Machine', href: 'https://web.archive.org/web/2/' + url },
    { label: 'Save to Wayback Machine', href: 'https://web.archive.org/save/' + url }
  ];

  var menu = document.createElement('div');
  menu.id = ID;
  menu.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;' +
    'background:rgba(20,20,20,.96);color:rgb(255,255,255);border-radius:10px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.35);font:14px system-ui,sans-serif;' +
    'padding:6px;min-width:220px';

  function close() {
    menu.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function onOutside(e) { if (!menu.contains(e.target)) close(); }

  links.forEach(function (link) {
    var a = document.createElement('a');
    a.textContent = link.label;
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.cssText = 'display:block;padding:8px 10px;border-radius:6px;' +
      'color:inherit;text-decoration:none;white-space:nowrap';
    a.onmouseenter = function () { a.style.background = 'rgba(255,255,255,.14)'; };
    a.onmouseleave = function () { a.style.background = 'none'; };
    a.onclick = function () { setTimeout(close, 0); };
    menu.appendChild(a);
  });

  document.documentElement.appendChild(menu);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onOutside, true);
})();
