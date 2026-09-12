# bookmarklets

[![License: MIT-0](https://img.shields.io/badge/License-MIT--0-blue.svg)](LICENSE)

Small browser bookmarklets for making web pages readable. Sources live in
`src/`; `build.js` minifies and URL-encodes them into `dist/`.

## Install

Requires any Node ≥ 16 (only `fs`, `path`, `vm`, and `child_process` are
used, all stable since early Node versions — no other dependency). `.nvmrc`
pins the exact version this is developed against; `nvm use` picks it up.

```sh
node build.js
open dist/index.html   # drag the buttons to your bookmarks bar
```

Or paste the contents of `dist/<name>.txt` into a bookmark's URL field.

## The bookmarklets

| | what it does | reversible |
|---|---|---|
| **archive** | Pops up a menu to view or save the current page on Archive.today or the Wayback Machine. | click again / Esc / click outside |
| **unstick** | Removes `fixed`/`sticky` elements, clears `overflow: hidden`/`clip` locks, pauses autoplay video. The conservative one — only touches things that are almost never legitimate to keep. | no, reload |
| **clean** | Hides overlays, chat-widget bubbles and app-install banners, un-sticks chrome, restores scrolling/selection, defeats copy and right-click blockers. The expansive counterpart to `unstick` — where `unstick` only un-positions, `clean` also hides what it recognizes as junk. Keeps watching for late-injected popups for 10s. | click again |
| **unpaywall** | Un-blurs, un-clips and un-hides soft-paywalled article text. If the article is still truncated, recovers the full text from the page's JSON-LD `articleBody` and renders it in a clean reader. | click again |
| **print** | Extracts the article into a clean print layout — serif at 11pt, orphan/widow control, no page breaks inside figures — with a live page-count estimate and image/link-URL toggles. | Esc / Close |
| **detrack** | Strips known tracking params (`utm_*`, `fbclid`, `gclid`, `igshid`, …) from the current URL and from every `<a href>` on the page, then copies the cleaned current URL to the clipboard. | no, reload |
| **microblog** | Quotes the current selection into Micro.blog's posting page as `[Author](url):` followed by a blockquote. Prompts to confirm the guessed author name first. Idea and posting-page contract credited to Colin Devroe's [mb-bookmarklet](https://github.com/cdevroe/mb-bookmarklet); independent rewrite. | n/a, opens a popup |
| **xmedia** | Shows an X/Twitter page's photo and video CDN URLs full-size in a popup, past the "log in to see this" wall shown to logged-out visitors. Reuses one popup across repeat clicks. | n/a, opens a popup |
| **xreader** | Renders an X/Twitter tweet and its replies as a minimal, Nitter/xcancel-style reading list in a popup - avatar, name, handle, time, text, media, counts, no chrome. Reuses one popup across repeat clicks. | n/a, opens a popup |

`clean`, `unpaywall`'s overlay detection, `unstick`, and `detrack`'s link
collection all pierce open shadow roots when scanning the live document.
Closed shadow roots have no observation API and can't be reached by anything
running outside the page. `print` clones content instead of scanning it
live, and `cloneNode` does not carry shadow DOM across the clone — that one
limitation is a DOM spec constraint, not something fixable here.

### Scope of `unpaywall`

It only surfaces content the site **already sent to your browser** — either
hidden with CSS, or sitting unrendered in a data payload in the page source.
Hard paywalls, where the text never leaves the server, are untouchable
client-side and always will be. It deliberately does not fetch alternate URLs
(`rel=amphtml`, AMP mirrors, archive services), reset metered-article
counters, or spoof referrers — those go and get content the server withheld,
rather than reading what it handed over. That line is the whole design
constraint; widening it turns this into a different kind of tool.

**CSS hiding it undoes:** `filter: blur`, `backdrop-filter`, `line-clamp`
(prefixed and not), `mask-image`, `content-visibility: hidden`, `clip-path`,
`-webkit-text-security`, clipped `overflow`, sub-1 `opacity`, `display: none`
and `visibility: hidden` on text elements, and gradient fade masks — including
ones drawn as `::before`/`::after` pseudo-elements, which `getComputedStyle`
on real elements cannot see at all.

**Text sources it reads,** best-scoring wins:

| source | why it's there |
|---|---|
| JSON-LD `articleBody` | sites publish it for Google |
| `__NEXT_DATA__` | Next.js ships the page's props as JSON |
| any `<script type="application/json">` | generic hydration payloads |
| `window.__NUXT__`, `__INITIAL_STATE__`, `__PRELOADED_STATE__`, `__APOLLO_STATE__`, `__remixContext`, `__data` | Nuxt / Remix / Redux / Apollo |
| `<noscript>` | older progressive-enhancement fallbacks |

Candidates are filtered by `BM_looksLikeProse` so an API key or CDN URL in a
payload can't be presented as article text, and the winner must contain a
chunk of what's already visible on screen — otherwise an unrelated blob (a
privacy policy, another article in a feed) could masquerade as "the full
article". If that relatedness check fails the text is kept but the reader
doesn't auto-open; the toast says so.

Console helpers while it's active:

```js
__unpaywall.reader()   // force the reader open
__unpaywall.text()     // the recovered article text
__unpaywall.sources()  // every candidate found, with lengths - use when it picks wrong
```

### Scope of `detrack`

It only strips query-string keys on a known-tracker allowlist (`utm_*`,
`fbclid`, `gclid`, `mc_eid`, `igshid`, `si`, and similar) — never a bare
generic key like `id`, `ref` or `cid`, since those are as likely to be a
site's real routing parameter as they are a tracker. It doesn't follow
redirect chains or expand shortened links (`bit.ly`, `t.co`): that would
mean fetching, which the current-page bookmarklets in this repo don't do,
and a shortener's destination isn't something client-side code can resolve
without a network round trip anyway. Only `http:`/`https:` links are
touched; `mailto:`, `tel:` and `javascript:` hrefs are left alone.

### Scope of `xmedia`

It only reads `pbs.twimg.com`/`video.twimg.com` URLs already present in the
page's own HTML — the live DOM plus a re-fetch of `location.href` (the same
page, not an alternate one), since a virtualized timeline can drop offscreen
tweets from the rendered DOM before you scroll back to them. It never signs
in, calls an API, or reaches media that the server didn't already hand the
browser — the "log in to see this" wall X shows a logged-out visitor over
media on some pages is client-side CSS/JS sitting on top of URLs the
response already contains, the same category of thing `unpaywall` undoes for
text. A private account's tweets, which the server never sends to a
logged-out request in the first place, stay untouchable by this, same as a
hard paywall is for `unpaywall`.

### Scope of `xreader`

Same constraint as `xmedia`, extended to structure rather than just media
URLs: it only reads what a single re-fetch of the current page's own HTML
already contains, parsed with `DOMParser` rather than regex, since X's
logged-out markup carries no `data-testid` hooks to key off of and fields
have to be read positionally instead (an avatar's `alt` for the handle, the
first non-`@`-prefixed link to that handle for the display name, and so
on). A reply thread deep enough to need its own "show more replies" click
stays out of reach - same limitation `unpaywall` has for a hard paywall,
just applied to replies instead of article text. It does not auto-scroll, auto-click "show more", or paginate to pull in
additional replies - it renders only whatever that one fetch already
returned.

## Architecture

`src/_lib.js` holds logic shared by two or more scripts — spliced into each
entry at its `/*@include*/` marker before minification, so every bookmarklet
still ships as one self-contained blob (each runs in an isolated page
context; there's no runtime module loading to share code at request time).

The build tree-shakes it: each entry gets only the helpers it references,
plus their transitive dependencies. So `_lib.js` can grow to serve one
script without padding the other three — `unstick` currently pulls 5 of 15
helpers and stays under 3 KB while `unpaywall` uses all 15. Because a
dropped helper is a runtime `ReferenceError` rather than a syntax error,
every build also asserts each bundle is closed over its own `BM_`
references.

| helper | purpose |
|---|---|
| `BM_deepEach` / `BM_deepQueryAll` | Walk the live DOM including open shadow roots |
| `BM_tokenMatch` | Whole-token class/id matching — see "Why they break" below |
| `BM_textShareGuard` | Refuses to flag anything holding a large share of the page's text |
| `BM_styleTracker` | Backup-once / undo-in-reverse / idempotent-undo for inline styles |
| `BM_injectStyle` | Constructable stylesheet (falls back to `<style>`) for `document` or a `ShadowRoot` |
| `BM_watch` | Debounced `MutationObserver` whose `stop()` also cancels any pending debounced callback |
| `BM_closeOverlays` | Closes `<dialog>`, hides open `[popover]`, clears `[inert]` |
| `BM_unlockScroll` | Restores document scroll/position/overflow after a scroll-lock script clamps them |
| `BM_looksLikeProse` | Rejects URLs, base64 and minified blobs when scanning payloads for article text |
| `BM_harvestStrings` | Depth- and count-bounded walk of a parsed JSON payload collecting prose candidates |
| `BM_toast`, `BM_safely`, `BM_tlen` | small utilities |

`test.js` loads `_lib.js` itself into a Node `vm` sandbox and tests it
directly — there's no separate copy of the logic that could quietly drift
from what ships. `build.js` runs it before every build and refuses to write
`dist/` on failure. Scope: pure logic only (token matching, the text-share
guard's arithmetic, style undo, the shadow-DOM walk against a hand-built fake
tree). Anything that needs real layout — `BM_tlen`'s `innerText` path in a
live browser, `print`'s article scoring, `unpaywall`'s JSON-LD extraction — is
not covered here; spot-check those in an actual browser per the section below.
`print` has held up across every page tried so far. `unpaywall`'s CSS
un-hiding and text recovery both work, but hit rate on the reader
auto-opening varies by site, as expected of a heuristic scorer — that's the
`related` check in "Scope of `unpaywall`" declining to guess, not a bug.

## Why they break, and how to fix them

These lean on heuristics — computed style, element geometry, and class-name
patterns — because there is no reliable way to tell "annoyance" from "content"
in the DOM. Sites change, so expect drift. The usual fixes:

- **Content disappeared.** A junk pattern matched a real content wrapper.
  Every script's `BM_textShareGuard` call refuses to flag anything holding a
  large fraction of the page's text — widen that threshold, or narrow the
  pattern that fired.
- **Annoyance survived.** Add a token to `BAD` (`clean`), `GATE` (`unpaywall`),
  or `JUNKTOK` (`print`). Keep them *whole tokens*, matched via
  `BM_tokenMatch` — a raw substring test on `gate` or `meter` also matches
  `navigate`, `aggregate`, `parameter`, `diameter`; anchoring each token (and
  each hyphen-joined pair, so `sign-up` still matches inside
  `sign-up-prompt`) rules that out. `test.js` carries the regression set this
  is checked against — add new false positives there when you find them. A
  new chat-widget vendor for `clean` should be named specifically (e.g.
  `drift-widget`, not bare `drift`) — a bare vendor name is more likely to
  collide with an unrelated class or a page's own id than a bare junk word
  like `modal` is.
- **A new tracking param survived `detrack`.** Add its exact key to `TRACK`
  in `detrack.js`. Keep entries specific (`ref_src`, not `ref`) for the same
  reason `BAD`'s vendor tokens are specific — a generic key is as likely to
  be load-bearing on some site as it is to be a tracker.
- **Print picked the wrong block.** `findMain()` scores named-selector
  candidates by text length and paragraph count, penalising high link
  density, then descends through single-child wrappers. When none of the
  named selectors hit, it falls back to tallying `<p>` text onto ancestors.
  Add a selector to `priority` if a site needs it.

## Editing

Use `/* block comments */` only, one per line — no code sharing a line with
a comment. `build.js` minifies by collapsing newline-plus-indentation and
only strips a block comment when it is the *entire* content of its line(s);
a `//` comment is rejected outright since it would otherwise swallow
everything after it on the line. Terminate every statement with `;` — the
minifier joins lines by deleting the newline, so a line relying on automatic
semicolon insertion changes meaning once joined with the next. Template
literals (`` ` ``) are rejected outright for the same reason: a multi-line
one loses its semantic newlines when joined, and nothing catches that
downstream since the mangled code is still syntactically valid. Every build
also syntax-checks each script with `vm.Script`, verifies the URL
round-trip, and runs `test.js` first — aborting before anything is written
to `dist/` if any of those fail.
