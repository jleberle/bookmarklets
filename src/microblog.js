/*
  microblog - quote the current selection to Micro.blog's posting page
  (https://micro.blog/post?bookmarklet=true&text=...), formatted as a
  linked byline followed by a blockquote:

    [Author Name](url):

    > selected text

  The bookmarklet=true param and text= field are Micro.blog's own documented
  posting-page contract, not third-party code; the window.open() dimensions
  below are this repo's own choice, independent of any other bookmarklet.

  The idea of a selection-aware Micro.blog bookmarklet, and the discovery of
  that posting-page contract, comes from Colin Devroe's mb-bookmarklet
  (https://github.com/cdevroe/mb-bookmarklet) - this is an independent
  rewrite with a different output format (linked byline + blockquote, with
  an author-name prompt), not a copy of his code.

  Requires a text selection - alerts and stops otherwise, since there is
  nothing to quote. The author guess (meta author/article:author/
  og:site_name/twitter:site, falling back to document.title) is shown in a
  prompt() so it can be corrected before the popup opens; Cancel aborts
  without opening anything.
*/
/*@include*/
(function () {
  var sel = BM_safely(function () { return window.getSelection().toString(); }) || '';
  if (!sel) { alert('Select some text to quote first, then click this bookmarklet.'); return; }

  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]') ||
      document.querySelector('meta[property="' + name + '"]');
    return el ? el.getAttribute('content') : '';
  }

  var guess = meta('author') || meta('article:author') || meta('og:site_name') ||
    meta('twitter:site') || document.title;
  var author = prompt('Author name:', guess);
  if (author === null) return;

  var quote = sel.split('\n').map(function (line) { return '> ' + line; }).join('\n');
  var text = '[' + author + '](' + location.href + '):\n\n' + quote;
  var dest = 'https://micro.blog/post?bookmarklet=true&text=' + encodeURIComponent(text);
  window.open(dest, 'bm-microblog-post', 'width=560,height=640,noopener,noreferrer');
})();
