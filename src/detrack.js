/*
  detrack - strips known tracking params from the current URL and from every
  <a href> on the page, then copies the cleaned current URL to the
  clipboard. Pierces open shadow roots when collecting links, same as
  clean/unpaywall/unstick. No undo - reload to restore original hrefs.
*/
/*@include*/
(function () {
  /* Tested as exact query-key names, not compound tokens like class names
     are (BM_tokenMatch's word-splitting doesn't apply here) - a bare "id"
     or "ref" would risk eating a param a site actually needs to route on,
     so every entry here is a specific, well-known tracker key. */
  var TRACK = /^(utm_\w+|fbclid|gclid|gclsrc|dclid|msclkid|mc_eid|mc_cid|igshid|ig_rid|_ga|_gl|yclid|twclid|ttclid|mkt_tok|vero_id|oly_enc_id|oly_anon_id|wickedid|si|ref_src|ref_url|spm|scid|elqtrackid|elq|sc_channel|sc_campaign|sc_content|guccounter|guce_referrer|guce_referrer_sig|ito|xtor|cmpid|s_cid|hmb_campaign|hmb_medium|hmb_source)$/i;

  function cleanURL(href) {
    var u = BM_safely(function () { return new URL(href); });
    if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
    var drop = [];
    u.searchParams.forEach(function (v, k) { if (TRACK.test(k)) drop.push(k); });
    drop.forEach(function (k) { u.searchParams.delete(k); });
    return { url: u, changed: drop.length > 0 };
  }

  var here = cleanURL(location.href);
  if (here && here.changed) history.replaceState(null, '', here.url.toString());

  var n = 0;
  BM_deepQueryAll(document.documentElement, 'a[href]').forEach(function (a) {
    BM_safely(function () {
      var res = cleanURL(a.href);
      if (res && res.changed) { a.setAttribute('href', res.url.toString()); n++; }
    });
  });

  var cleanHere = here ? here.url.toString() : location.href;
  var suffix = n ? ' - ' + n + ' link' + (n === 1 ? '' : 's') + ' cleaned' : '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    BM_safely(function () {
      navigator.clipboard.writeText(cleanHere).then(
        function () { BM_toast('link copied' + suffix); },
        function () { BM_toast('copy blocked' + suffix); }
      );
    });
  } else {
    BM_toast('clipboard unavailable' + suffix);
  }
})();
