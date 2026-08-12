#!/usr/bin/env node
/*
  Minify + URL-encode every src/*.js (except _lib.js, which is a fragment
  spliced into each entry at /*@include*\/) into a bookmarklet.
  Writes dist/<name>.txt (paste into a bookmark's URL field) and
  dist/index.html (open it and drag the buttons to your bookmarks bar).

  Runs test.js first and aborts the build on any failure.

  Run: node build.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
const LIB_FILE = '_lib.js';

const META = {
  archive: 'View or save the current page on Archive.today or the Wayback Machine.',
  clean: 'Hide overlays, chat widgets and app banners, unstick chrome, restore scrolling and selection. Click again to undo.',
  detrack: 'Strip tracking params from the current URL and every link on the page, copy the clean URL.',
  microblog: 'Quote the current selection to a Micro.blog post popup, formatted as a linked byline and blockquote.',
  print: 'Extract the article into a clean, ink-frugal print layout with a page-count preview.',
  unpaywall: 'Un-hide soft-paywalled article text; recovers full text from JSON-LD when present.',
  unstick: 'Remove sticky/fixed chrome and restore scrolling. No undo - reload to restore.'
};

/* The minifier only strips whole-line comments, so a // comment would
   swallow the rest of its line (harmless) but a stray one mid-expression
   would corrupt it - disallow line comments in src/ entirely so every
   comment is unambiguously a standalone line. */
function assertNoLineComments(name, src) {
  src.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//')) {
      throw new Error(`${name}:${i + 1} uses a // comment; use block comments in src/`);
    }
  });
}

/* The minifier joins lines by deleting the newline and leading whitespace,
   which silently corrupts a multi-line template literal (its newlines are
   semantic) and would still pass the later syntax check,
   since the mangled code stays syntactically valid - just wrong. Rejecting
   backticks in src/ code entirely avoids that class of bug. Checked against
   the comment-stripped source, since a backtick used for `code formatting`
   inside a comment is harmless - comments never reach the bundle. */
function assertNoTemplateLiterals(name, src) {
  if (/`/.test(stripBlockComments(src))) {
    throw new Error(`${name} uses a template literal (backtick) outside a comment; use string concatenation in src/`);
  }
}

/*
  Only strips a /* *\/ block comment when it is the ENTIRE content of one or
  more lines (ignoring surrounding whitespace) - never a comment sharing a
  line with code. That means a stray "/*" or "*\/" inside a string or regex
  literal elsewhere in the file is never touched, because this only matches
  comments whose delimiters both sit at line boundaries. The convention this
  depends on: every comment in src/ is written on its own line(s). It cannot
  by itself detect a violation of that convention, which is why every build
  also syntax-checks the result with `vm.Script` before writing anything.
*/
function stripBlockComments(src) {
  return src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n?/gm, '');
}

function minify(src) {
  return stripBlockComments(src).replace(/\n\s*/g, '').trim();
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const testFile = path.join(__dirname, 'test.js');
if (fs.existsSync(testFile)) {
  try {
    execFileSync('node', [testFile], { stdio: 'inherit' });
  } catch (e) {
    console.error('\ntest.js failed - build aborted, nothing written to dist/');
    process.exit(1);
  }
}

fs.mkdirSync(DIST, { recursive: true });

const libRaw = fs.readFileSync(path.join(SRC, LIB_FILE), 'utf8');
assertNoLineComments(LIB_FILE, libRaw);
assertNoTemplateLiterals(LIB_FILE, libRaw);

/*
  Split _lib.js into its individual BM_ declarations so each entry can take
  only what it uses. Comments are stripped first, which makes the split
  unambiguous: every chunk then starts at a line-initial `function BM_x` or
  `var BM_X` and runs to the next one. Without this, adding a helper that
  only one bookmarklet needs would silently pad all four.
*/
function splitLib(src) {
  const bare = stripBlockComments(src);
  const re = /^(?:function|var)\s+(BM_\w+)/gm;
  const marks = [];
  let m;
  while ((m = re.exec(bare))) marks.push({ at: m.index, name: m[1] });
  return marks.map((mark, i) => {
    const code = bare.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : bare.length);
    const deps = new Set((code.match(/\bBM_\w+/g) || []).filter((n) => n !== mark.name));
    return { name: mark.name, code, deps };
  });
}

const LIB_PARTS = splitLib(libRaw);
const LIB_BY_NAME = new Map(LIB_PARTS.map((p) => [p.name, p]));

/* Transitive closure over helper-to-helper references, emitted in the order
   they appear in _lib.js so declaration order is preserved. */
function libFor(entrySrc) {
  const want = new Set();
  const visit = (name) => {
    if (want.has(name) || !LIB_BY_NAME.has(name)) return;
    want.add(name);
    LIB_BY_NAME.get(name).deps.forEach(visit);
  };
  (stripBlockComments(entrySrc).match(/\bBM_\w+/g) || []).forEach(visit);
  return {
    code: LIB_PARTS.filter((p) => want.has(p.name)).map((p) => p.code).join(''),
    names: LIB_PARTS.filter((p) => want.has(p.name)).map((p) => p.name)
  };
}

const built = [];
for (const file of fs.readdirSync(SRC).filter(f => f.endsWith('.js') && f !== LIB_FILE).sort()) {
  const name = path.basename(file, '.js');
  let raw = fs.readFileSync(path.join(SRC, file), 'utf8');
  assertNoLineComments(name, raw);
  assertNoTemplateLiterals(name, raw);

  let used = { code: '', names: [] };
  if (raw.includes('/*@include*/')) {
    used = libFor(raw);
    raw = raw.replace('/*@include*/', used.code);
  }

  const min = minify(raw);
  /* vm.Script parses as a top-level program, unlike `new Function`, which
     parses as a function body and would let a stray top-level `return`
     through - `javascript:` URLs evaluate in program context too. */
  new vm.Script(min); /* throws on a syntax error before we ship it */

  /* An over-aggressive tree-shake leaves a call to a helper that is no longer
     declared. That is a runtime ReferenceError, not a syntax error, so
     `vm.Script` above sails straight past it - check the bundle is closed
     over its own BM_ references explicitly. */
  const refs = new Set(min.match(/\bBM_\w+/g) || []);
  const decl = new Set((min.match(/(?:function|var)\s+BM_\w+/g) || [])
    .map((s) => s.replace(/^(?:function|var)\s+/, '')));
  const missing = [...refs].filter((r) => !decl.has(r));
  if (missing.length) {
    throw new Error(`${name}: bundle references undeclared helper(s): ${missing.join(', ')}`);
  }

  const url = 'javascript:' + encodeURIComponent(min);
  if (decodeURIComponent(url.slice('javascript:'.length)) !== min) {
    throw new Error(`${name}: encode/decode round-trip mismatch`);
  }

  fs.writeFileSync(path.join(DIST, name + '.txt'), url);
  built.push({ name, url, bytes: url.length });
  console.log(`${name.padEnd(12)} ${String(url.length).padStart(6)} chars -> dist/${name}.txt`);
  console.log(`${' '.repeat(13)}lib: ${used.names.length}/${LIB_PARTS.length} helpers`);
}

const rows = built.map(b => `    <li>
      <a class="bm" href="${esc(b.url)}">${esc(b.name)}</a>
      <p>${esc(META[b.name] || '')}</p>
    </li>`).join('\n');

fs.writeFileSync(path.join(DIST, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bookmarklets</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, sans-serif; max-width: 46rem;
         margin: 0 auto; padding: 3rem 1.25rem 6rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .35rem; }
  .lede { opacity: .7; margin: 0 0 2.5rem; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: grid; grid-template-columns: 10rem 1fr; gap: 1rem;
       align-items: start; padding: 1rem 0; border-top: 1px solid rgba(128,128,128,.3); }
  .bm { display: block; text-align: center; text-decoration: none; font-weight: 600;
        padding: .55rem .8rem; border-radius: 8px; background: rgb(58,132,247);
        color: rgb(255,255,255); cursor: grab; }
  p { margin: 0; opacity: .8; }
  @media (max-width: 34rem) { li { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <h1>Bookmarklets</h1>
  <p class="lede">Drag a button to your bookmarks bar. Edit <code>src/</code> and run
     <code>node build.js</code> to regenerate.</p>
  <ul>
${rows}
  </ul>
</body>
</html>
`);

console.log(`\n${built.length} built -> dist/index.html`);
