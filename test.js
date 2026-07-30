#!/usr/bin/env node
/*
  Pure-logic regression tests, run by build.js before every build.
  Loads the actual src/_lib.js into a sandbox via vm and tests it directly,
  so these tests can't silently drift from what ships in dist/.

  Deliberately out of scope: anything that needs real layout (BM_tlen's
  innerText path, BM_deepEach's shadow-DOM walk, print.js's article scoring,
  unpaywall.js's JSON-LD extraction). Spot-check those in an actual browser -
  see README's "Why they break, and how to fix them".
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const libSrc = fs.readFileSync(path.join(__dirname, 'src', '_lib.js'), 'utf8');
const sandbox = { window: { CSSStyleSheet: undefined }, WeakSet, MutationObserver: function () {}, document: {} };
vm.createContext(sandbox);
vm.runInContext(libSrc, sandbox);

let failed = 0;
function check(name, cond) {
  if (!cond) { failed++; console.log('FAIL: ' + name); }
}

function fakeEl(cls, id) {
  return { getAttribute: (k) => (k === 'class' ? cls : k === 'id' ? id : null), id: id || '' };
}

/* ---- BM_tokenMatch: the fix for the "meter" substring-matching "parameter"
   class of bug. GATE/BAD are extracted from the actual source files below
   rather than hand-copied, so this suite can't silently drift from what
   ships. ---- */
function extractRegex(file, varName) {
  const src = fs.readFileSync(path.join(__dirname, 'src', file), 'utf8');
  const m = src.match(new RegExp('var ' + varName + ' = (/.*/i);'));
  if (!m) throw new Error(`could not find ${varName} in ${file}`);
  return eval(m[1]);
}
const GATE = extractRegex('unpaywall.js', 'GATE');
const BAD = extractRegex('clean.js', 'BAD');

const mustNotMatch = [
  'chart-parameters', 'diameter-label', 'perimeter-box', 'aggregate-stats',
  'investigate-panel', 'delegate-list', 'propagate-note', 'navigate-next',
  'gateway-content', 'metering-data', 'article-body', 'read-more-link'
];
mustNotMatch.forEach((c) => check(`GATE must NOT match: ${c}`, !sandbox.BM_tokenMatch(fakeEl(c), GATE)));

const mustMatch = [
  'paywall-gate', 'tp-modal', 'consent_banner', 'newsletter-signup',
  'cookie-consent-banner', 'modal-backdrop', 'sign-up-prompt'
];
mustMatch.forEach((c) => check(`GATE must match: ${c}`, sandbox.BM_tokenMatch(fakeEl(c), GATE)));

/* Known, accepted residual false positives - the text-share guard in
   killGates()/sw() is the backstop that protects these if they turn out to
   hold real article content. Documented here so a future change that
   "fixes" them doesn't silently reduce catch rate without a decision. */
const acceptedFalsePositives = ['premium-article-body', 'register-of-deeds', 'promotional-history-figure'];
acceptedFalsePositives.forEach((c) => check(
  `GATE known accepted FP (still matches, relies on text-share guard): ${c}`,
  sandbox.BM_tokenMatch(fakeEl(c), GATE)
));

/* ---- same class of check, against clean.js's BAD ---- */
const badMustNotMatch = ['chart-parameters', 'diameter-label', 'navigate-next', 'article-body'];
badMustNotMatch.forEach((c) => check(`BAD must NOT match: ${c}`, !sandbox.BM_tokenMatch(fakeEl(c), BAD)));

const badMustMatch = ['cookie-banner', 'gdpr-notice', 'newsletter-signup', 'sign-up-prompt', 'modal-backdrop'];
badMustMatch.forEach((c) => check(`BAD must match: ${c}`, sandbox.BM_tokenMatch(fakeEl(c), BAD)));

/* ---- BM_textShareGuard: pure arithmetic, faked via textContent-bearing
   plain objects (no real DOM needed for this part of the contract) ---- */
function fakeNode(text, hasMedia) {
  return {
    isConnected: false,
    textContent: text,
    innerText: text,
    querySelector: hasMedia ? () => ({}) : () => null
  };
}
{
  const root = fakeNode('x'.repeat(1000));
  const guard = sandbox.BM_textShareGuard(root, 500, 0.4);
  check('textShareGuard: protects root itself', guard(root));
  check('textShareGuard: protects media container regardless of text length', guard(fakeNode('short', true)));
  check('textShareGuard: protects >minChars AND >share', guard(fakeNode('y'.repeat(600))));
  check('textShareGuard: does not protect small unrelated element', !guard(fakeNode('tiny bit of text')));
  check('textShareGuard: does not protect long-but-under-share element', !guard(fakeNode('z'.repeat(300))));
}

/* ---- BM_styleTracker: backup-once / undo-in-reverse / idempotent undo ---- */
{
  function fakeStyled(initial) {
    let attr = initial;
    return {
      getAttribute: (k) => (k === 'style' ? attr : null),
      setAttribute: (k, v) => { if (k === 'style') attr = v; },
      removeAttribute: (k) => { if (k === 'style') attr = null; },
      style: { setProperty: (p, v) => { attr = `${p}:${v}`; } },
      _attr: () => attr
    };
  }
  const t = sandbox.BM_styleTracker();
  const a = fakeStyled(null), b = fakeStyled('color:red');
  t.set(a, 'display', 'none');
  t.set(b, 'display', 'none');
  t.set(a, 'display', 'block'); /* second set on same element must not re-backup */
  t.undo();
  check('styleTracker: restores no-prior-style element to no style', a._attr() === null);
  check('styleTracker: restores prior style verbatim', b._attr() === 'color:red');
  const beforeSecondUndo = a._attr();
  t.undo();
  check('styleTracker: undo is idempotent', a._attr() === beforeSecondUndo);
}

/* ---- BM_deepEach / BM_deepQueryAll: shadow-DOM piercing ----
   html > body > [div.a > my-widget(#shadow > span.x), div.b] */
{
  function el(tag, opts) {
    opts = opts || {};
    return {
      tagName: tag, nodeType: 1, children: opts.children || [], shadowRoot: opts.shadowRoot || null,
      matches: (sel) => sel === (opts.sel || '')
    };
  }
  const spanX = el('SPAN', { sel: 'span.x' });
  const shadow = { children: [spanX] };
  const widget = el('MY-WIDGET', { shadowRoot: shadow, sel: 'my-widget' });
  const divA = el('DIV', { children: [widget], sel: 'div.a' });
  const divB = el('DIV', { children: [], sel: 'div.b' });
  const body = el('BODY', { children: [divA, divB], sel: 'body' });
  const html = el('HTML', { children: [body], sel: 'html' });

  const seen = [];
  sandbox.BM_deepEach(html, (e) => seen.push(e.tagName), true);
  check(
    'deepEach: visits shadow content exactly once, depth-first',
    JSON.stringify(seen) === JSON.stringify(['HTML', 'BODY', 'DIV', 'MY-WIDGET', 'SPAN', 'DIV'])
  );

  const found = sandbox.BM_deepQueryAll(html, 'span.x');
  check('deepQueryAll: finds an element that only exists inside a shadow root', found.length === 1 && found[0] === spanX);
}

/* ---- BM_looksLikeProse: the filter that keeps an API key or CDN URL in a
   hydration payload from being surfaced as "recovered article text" ---- */
{
  const prose = 'The mayor announced the plan on Tuesday. '.repeat(20);
  const cases = [
    ['real prose', prose, true],
    ['too short', 'Too short.', false],
    ['long URL', 'https://example.com/' + 'a'.repeat(500), false],
    ['data URI', 'data:image/png;base64,' + 'A'.repeat(500), false],
    ['base64 blob', 'QUJDREVG'.repeat(60), false],
    ['minified css', 'a{color:red}'.repeat(60), false],
    ['minified json', JSON.stringify({ k: 'v' }).repeat(80), false],
    ['no sentence enders', 'word '.repeat(200), false],
    ['html body', '<p>' + prose + '</p>', true]
  ];
  cases.forEach(([label, input, want]) =>
    check(`looksLikeProse: ${label}`, sandbox.BM_looksLikeProse(input) === want));
}

/* ---- BM_harvestStrings against realistic payload shapes ---- */
{
  const prose = 'The mayor announced the plan on Tuesday. '.repeat(20);

  const nextData = {
    props: {
      pageProps: {
        article: { headline: 'X', articleBody: prose, related: [{ title: 'other' }] },
        config: { apiKey: 'abc123', cdn: 'https://cdn.example.com/' + 'a'.repeat(500) }
      }
    },
    page: '/article'
  };
  const out = [];
  sandbox.BM_harvestStrings(nextData, 0, out);
  check('harvest: __NEXT_DATA__ yields exactly the articleBody', out.length === 1 && out[0].raw === prose);
  check('harvest: articleBody is flagged as key-matched', out[0] && out[0].keyed === true);

  const ld = { '@graph': [{ '@type': 'WebPage' }, { '@type': 'NewsArticle', articleBody: prose }] };
  const out2 = [];
  sandbox.BM_harvestStrings(ld, 0, out2);
  check('harvest: JSON-LD @graph still reached by the generic walker', out2.length === 1 && out2[0].raw === prose);

  /* must terminate on a self-referential payload rather than recursing forever */
  const cyclic = { a: {} };
  cyclic.a.self = cyclic;
  const out3 = [];
  let threw = false;
  try { sandbox.BM_harvestStrings(cyclic, 0, out3); } catch (e) { threw = true; }
  check('harvest: depth bound terminates on a cyclic payload', !threw);
}

if (failed) {
  console.log(`\n${failed} failing`);
  process.exit(1);
}
console.log('all tests passed');
