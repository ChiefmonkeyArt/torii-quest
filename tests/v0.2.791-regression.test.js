// tests/v0.2.791-regression.test.js
//
// v0.2.791-alpha (stale-build loop fix). The entry chunk was pinned to a stable
// filename (`torii-entry.js`) and cache-busted only with a per-build `?v=<timestamp>`
// query string. That is fragile: a stale cached chunk could still resolve the CURRENT
// entry file under an old `?v=` URL, re-evaluate `torii-entry.js` a second time, and
// trip the duplicate-boot guard ("Stale build detected — refreshing to sync…") in a
// loop that survived cache-clear + service-worker unregister (the user's exact symptom).
// Fix: content-hash the entry (`torii-entry-<hash>.js`) so a stale chunk can only point
// at an old, now-404 entry file — stale and fresh builds can never collide at the
// module-URL level. The bundler already emits every chunk's back-reference as the
// relative `./torii-entry-<hash>.js`, so the old write-time `?v=` back-reference rewrite
// is deleted. These source-locks guard the verified regression so nobody can silently
// reintroduce the `?v=` timestamp scheme (which would resurface the loop).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VITE = readFileSync(join(ROOT, 'vite.config.js'), 'utf8');

describe('v0.2.791-alpha — content-hashed entry (no ?v= timestamp)', () => {
  it('entryFileNames is content-hashed, not the stable pinned name', () => {
    expect(VITE).toContain("entryFileNames: 'assets/torii-entry-[hash].js'");
    expect(VITE).not.toContain("entryFileNames: 'assets/torii-entry.js'");
  });

  it('no per-build timestamp/cache-bust machinery remains', () => {
    expect(VITE).not.toContain('BUILD_STAMP');
    expect(VITE).not.toContain('entryUrlForHtml');
    expect(VITE).not.toContain('entryUrlForChunk');
    expect(VITE).not.toContain('ENTRY_BASE');
  });

  it('the write-time ?v= back-reference rewrite is deleted', () => {
    expect(VITE).not.toContain('ENTRY_IMPORT_RE');
  });

  it('the plugin resolves the hashed entry filename from the emitted bundle', () => {
    expect(VITE).toContain('function hashedEntryFileName');
    expect(VITE).toContain('isEntry');
  });

  it('the injected import uses the hashed relative entryUrl + idempotency guard', () => {
    expect(VITE).toContain("import('${entryUrl}')");
    expect(VITE).toContain('window.__toriiShellImported');
  });

  it('CSP fallback ENTRY_IMPORT_LINE carries the hashed path + guard', async () => {
    const { ENTRY_IMPORT_LINE } = await import('../tools/csp.mjs');
    expect(ENTRY_IMPORT_LINE).toContain("import('./assets/torii-entry-[hash].js')");
    expect(ENTRY_IMPORT_LINE).toContain('window.__toriiShellImported');
  });
});