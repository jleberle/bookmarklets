# bookmarklets — session notes

README.md documents what each bookmarklet does and the limits of each. This
file is the build and editing mechanics.

## Build

```sh
node build.js        # runs test.js first, ABORTS the build on any failure
```

No dependencies — only `fs`, `path`, `vm`, `child_process`. Node ≥ 16;
`.nvmrc` pins the development version.

## `src/_lib.js` is a fragment, not an entry

`build.js` skips it and splices it into each entry at the `/*@include*/`
marker. So shared helpers go in `_lib.js`, and a new file in `src/` is
automatically a new bookmarklet — there is no registry. But `build.js`'s `META`
map supplies each one's description for `dist/index.html`; a new bookmarklet
with no `META` entry builds fine and ships undescribed.

## `dist/` is committed

It holds the install artifacts people actually use (`dist/<name>.txt` to paste,
`dist/index.html` to drag from). Editing `src/` without rebuilding ships
nothing — the committed `dist/` is what a user gets. Rebuild and commit
together.

## Shadow DOM is the recurring constraint

- **Open** shadow roots are pierced by `clean`, `unstick`, `detrack`, and
  `unpaywall`'s overlay detection when scanning the live document.
- **Closed** shadow roots have no observation API and cannot be reached by
  anything running in page context. Not fixable.
- **`print` is different**: it clones content rather than scanning live, and
  `cloneNode` does not carry shadow DOM across. That is a DOM spec constraint,
  so `print` will always miss shadow content the others can see.

Before "fixing" a bookmarklet that misses an element, determine which of these
three cases applies. Only the first is a bug.

## Scope boundary for `unpaywall`

It only surfaces content the site **already sent to the browser** — hidden by
CSS, or unrendered in a JSON-LD payload. Hard paywalls are untouchable client
side. It deliberately does not fetch alternate URLs, and adding that would
change what the tool *is*, not just what it does.
