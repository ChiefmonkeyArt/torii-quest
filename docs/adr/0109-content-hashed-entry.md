# ADR-0109: Content-hash the entry bundle — drop the `?v=` timestamp cache-bust

- **Status:** Accepted
- **Version target:** v0.2.791-alpha
- **Supersedes:** the `?v=<timestamp>` entry cache-bust introduced in v0.2.285 and extended through v0.2.773/v0.2.775.

## Context

Since v0.2.285 the entry chunk was pinned to a stable filename (`assets/torii-entry.js`)
via `entryFileNames` so the inline bootstrap's `import()` target (and therefore its CSP
sha256) would not churn. Because the filename was stable, cache-busting was done with a
per-build `?v=<timestamp>` query string that the build plugin rewrote into BOTH the inline
bootstrap and every chunk's back-reference import (the `ENTRY_IMPORT_RE` write-time
rewrite).

That timestamp scheme is fragile. A stale cached chunk (served by a lingering service
worker or the HTTP cache) could still resolve the CURRENT entry file under an old
`?v=<oldstamp>` URL — the server answers any query string with the same `torii-entry.js`.
The browser treats `torii-entry.js?v=new` and `torii-entry.js?v=old` as two distinct
module records for the same source, so both evaluate. The second evaluation trips the
single-boot module guard and, after v0.2.775, loops through the `Stale build detected`
self-heal without ever converging (each reload re-serves the same stale/stale pair).

Observed live: a returning player was stuck in exactly that loop on their normal profile
(after clearing cache and unregistering the service worker twice) while an incognito tab
loaded cleanly.

## Decision

1. **Content-hash the entry.** `entryFileNames` becomes `assets/torii-entry-[hash].js`,
   so every build emits a unique, immutable entry filename. A stale cached chunk can now
   only reference an old entry file that no longer exists (404) — it can never re-evaluate
   the fresh entry, so the double-boot guard cannot fire.

2. **Delete the `?v=` machinery.** `BUILD_STAMP`, `ENTRY_BASE`, `ENTRY_IMPORT_RE`,
   `entryUrlForHtml`/`entryUrlForChunk`, and the write-time back-reference rewrite are
   removed from `vite.config.js`. The bundler already emits every chunk's back-reference
   as the relative `./torii-entry-<hash>.js`, so no rewrite is needed.

3. **Resolve the hashed entry from the bundle.** The `transformIndexHtml` plugin reads the
   entry chunk's `fileName` from `ctx.bundle` and emits the base-agnostic relative
   `import('./assets/torii-entry-<hash>.js')` into the inline bootstrap, dropping the
   bundler-emitted static `<script>` tag as before (root `/`, `/quest/`, and any preview
   sub-path all keep resolving).

4. **Keep the defensive layers.** The `__toriiShellImported` idempotency guard, the
   `main.js` module guard, and the `index.html` shell self-heal remain — now effectively
   unreachable but retained as belt-and-braces (they cost nothing and still protect
   against any future non-hash collision).

## Consequence

- Stale and fresh builds can no longer collide at the module-URL level; the
  `Stale build detected` loop is structurally impossible.
- The CSP inline-bootstrap sha256 now churns per build, but the plugin already recomputes
  it from the emitted HTML at `writeBundle`, so the hardened policy still matches the
  shipped bootstrap exactly.
- `tools/csp.mjs`'s `ENTRY_IMPORT_LINE` fallback and `INLINE_SCRIPT_SHA256` are updated to
  the hashed form; `tests/quest-base-entry.test.js` locks the share-one-content-hash
  invariant (root, `/quest/`, and the runtime registry's bare `assets/…` form).