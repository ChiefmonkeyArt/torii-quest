// tests/main-enrich-reapply-cache.test.js — regression lock for the v0.2.876 fix:
// a directory row that resolved its owner name on one presence scan must NOT flip
// back to the serial on the next scan. `_enrichWorldOwners` re-fetches the world
// list fresh every scan (worlds carry no displayName), so when the profile is
// ALREADY cached from a prior scan the fetch step is skipped (missing is empty);
// the apply loop that re-attaches the cached displayName/avatar MUST still run.
//
// main.js is a large entry module with top-level side-effectful imports, so —
// consistent with tests/main-owner-profile-name-wiring.test.js — this locks the
// fix at the source level via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractBody(startNeedle) {
  const start = SRC.indexOf(startNeedle);
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start, start + 3600);
}

describe('_enrichWorldOwners — cached profile re-apply across scans (v0.2.876)', () => {
  const body = extractBody('async function _enrichWorldOwners(worlds)');
  const end = body.indexOf('\n}\n');

  it('does NOT early-return when there is nothing left to fetch (missing is empty)', () => {
    // The old bug returned `worlds` immediately when every owner was already cached,
    // skipping the apply loop. The fetch is now wrapped in `if (missing.length) {` so
    // it is skippable, while the apply loop below it still runs unconditionally.
    expect(body.slice(0, end)).not.toMatch(/if\s*\(!missing\.length\)\s*return\s+worlds/);
  });

  it('guards the fetch with `if (missing.length)` so a cache hit can skip it', () => {
    expect(body.slice(0, end)).toMatch(/if\s*\(missing\.length\)\s*\{/);
  });

  it('re-applies the cached displayName to world objects after the fetch block', () => {
    const apply = body.slice(0, end);
    const fetchGuard = apply.indexOf('if (missing.length) {');
    const applyIdx = apply.indexOf('w.displayName = p.displayName;');
    expect(fetchGuard).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(-1);
    // The apply assignment must appear AFTER the fetch guard (not short-circuited).
    expect(applyIdx).toBeGreaterThan(fetchGuard);
  });
});