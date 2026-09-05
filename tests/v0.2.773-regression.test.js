// tests/v0.2.773-regression.test.js
//
// v0.2.773-alpha regression locks: double-boot guards for the shell + module.
//
// Bug: a stale service-worker cache serving an older `torii-entry.js?v=<oldstamp>`
// alongside the freshly fetched `torii-entry.js?v=<newstamp>` produced TWO
// distinct ES-module records for the same source file, and both booted the
// arena in the same tab (strobing render, duplicate self in mirror, two WS
// sessions with different NIP-42 challenges, pointer-lock flap logged twice).
//
// Three defensive layers, all source-contract tested here:
//   (1) src/main.js top-level guard  — throws on second module invocation.
//   (2) index.html inline shell      — self-heals (unregister SW + purge caches
//                                      + reload once) if it runs a second time.
//   (3) vite.config.js build injection — the injected entry `import()` is wrapped
//                                        in a `__toriiShellImported` idempotency
//                                        gate so at most one entry loads per tab.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function readSrc(p) {
  return readFileSync(join(ROOT, p), 'utf8');
}

describe('v0.2.773 — module-side double-boot guard (src/main.js)', () => {
  const src = readSrc('src/main.js');

  it('short-circuits on `window.__toriiBooted`', () => {
    expect(src).toMatch(/window\.__toriiBooted/);
    expect(src).toMatch(/if \(window\.__toriiBooted\)/);
  });

  it('sets the flag before running any downstream side effects', () => {
    // The `__toriiBooted = true` assignment must appear BEFORE the first
    // `import { … } from './state.js';` (the first real side-effect import),
    // so a second module invocation can never fall through into the arena
    // wiring.
    const flagIdx = src.indexOf("window.__toriiBooted = true");
    const firstSideEffectImportIdx = src.indexOf("from './state.js'");
    expect(flagIdx).toBeGreaterThan(-1);
    expect(firstSideEffectImportIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeLessThan(firstSideEffectImportIdx);
  });

  it('throws on the duplicate invocation path so callers see a hard error', () => {
    expect(src).toMatch(/throw new Error\(['"]torii-boot: duplicate module invocation suppressed/);
  });

  it('logs a diagnostic warning on the duplicate invocation path', () => {
    expect(src).toMatch(/\[torii-boot\] duplicate boot suppressed/);
  });

  it('is SSR-safe: the guard is wrapped in a typeof window !== "undefined" check', () => {
    expect(src).toMatch(/typeof window !== ['"]undefined['"]/);
  });
});

describe('v0.2.773 — shell inline double-boot self-heal (index.html)', () => {
  const html = readSrc('index.html');

  it('checks a single-run flag `__toriiShellRan` in the inline bootstrap', () => {
    expect(html).toMatch(/window\.__toriiShellRan/);
    expect(html).toMatch(/if \(window\.__toriiShellRan\)/);
  });

  it('sets the flag on the FIRST-run branch so a subsequent scope self-heals', () => {
    expect(html).toMatch(/window\.__toriiShellRan = true/);
  });

  it('unregisters every service worker on the self-heal path', () => {
    expect(html).toMatch(/getRegistrations\(\)/);
    expect(html).toMatch(/\.unregister\(\)/);
  });

  it('purges every cache on the self-heal path', () => {
    expect(html).toMatch(/caches\.keys\(\)/);
    expect(html).toMatch(/caches\.delete/);
  });

  it('locks the self-heal loop by inspecting `?nuked=1` in the URL', () => {
    expect(html).toMatch(/nuked=1/);
    // The check is a regex against location.search, not a naive .includes()
    // — the loop-lock must not misfire on any other query string containing
    // the substring "nuked=1" mid-value.
    expect(html).toMatch(/\/\[\?&\]nuked=1\(\?:&\|\$\)\//);
  });

  it('reloads via location.replace so the loop history is not polluted', () => {
    expect(html).toMatch(/location\.replace\(/);
  });
});

describe('v0.2.773 — build-time entry-import idempotency guard (vite.config.js)', () => {
  const cfg = readSrc('vite.config.js');

  it('wraps the injected entry `import()` in a `__toriiShellImported` gate', () => {
    // The injected line MUST include the idempotency check. If someone drops
    // the guard back to a bare `import(entryUrl)`, this test fires so the
    // duplicate-boot regression can never sneak back in unnoticed.
    expect(cfg).toMatch(/window\.__toriiShellImported/);
    expect(cfg).toMatch(/if \(!window\.__toriiShellImported\)/);
    expect(cfg).toMatch(/window\.__toriiShellImported = true/);
  });

  it('still injects the versioned entry URL', () => {
    // Sanity: don't let the guard rewrite accidentally drop the actual import.
    expect(cfg).toMatch(/import\('\$\{entryUrlForHtml\(\)\}'\)/);
  });
});

describe('v0.2.773 — CSP fallback + build injection stay in lockstep', () => {
  // INLINE_SCRIPT_SHA256 is DELIBERATELY not equal to the sha of index.html — it
  // is the sha of the root-fallback (%BASE_URL% → / plus ENTRY_IMPORT_LINE),
  // used only before an emitted dist/index.html is available. Shipped builds
  // recompute the real hash from the final emitted HTML and write it into
  // dist/_headers (verified by tests/sw-app-shell.test.js). This test locks the
  // more important invariant for v0.2.773: the fallback ENTRY_IMPORT_LINE has
  // the same double-boot guard as the vite build injection, so a fallback
  // deploy is never a stealth regression.
  it('ENTRY_IMPORT_LINE carries the __toriiShellImported idempotency guard', async () => {
    const { ENTRY_IMPORT_LINE } = await import('../tools/csp.mjs');
    expect(ENTRY_IMPORT_LINE).toMatch(/window\.__toriiShellImported/);
    expect(ENTRY_IMPORT_LINE).toMatch(/if \(!window\.__toriiShellImported\)/);
    expect(ENTRY_IMPORT_LINE).toMatch(/window\.__toriiShellImported = true/);
    // Still an import() call — the guard mustn't swallow the actual load.
    expect(ENTRY_IMPORT_LINE).toMatch(/import\(['"][^'"]*torii-entry\.js['"]\)/);
  });
});
