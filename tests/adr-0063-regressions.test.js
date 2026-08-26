// tests/adr-0063-regressions.test.js — source-contract guards for the four
// cleanups in ADR-0063 (v0.2.693-alpha). Each locks a behavioral change against
// silent regression by reading the source as a string — the same pattern used by
// sw-app-shell.test.js and loop-fail-closed.test.js. Pure file reads, no fs
// mutation / network / DOM.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const ARENA = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const LOOP = readFileSync(join(ROOT, 'src/loop.js'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'src/input.js'), 'utf8');

describe('ADR-0063 — item 1: Gateway Setup panel must NOT auto-open on login', () => {
  it('main.js no longer calls _openHomepageStub() from a login-resolved auto-open block', () => {
    // The removed block was: if (owner && !getActiveWorld() && !hasShownThisSession())
    //   { setShownThisSession(); _openHomepageStub(); }
    // After removal, the session-flag helpers are no longer *called* anywhere in
    // main.js — they're only mentioned in a comment. The parens distinguish a real
    // call site from the comment prose.
    expect(MAIN).not.toMatch(/hasShownThisSession\(\)/);
    expect(MAIN).not.toMatch(/setShownThisSession\(\)/);
    // The auto-open condition must be gone entirely.
    expect(MAIN).not.toMatch(/!getActiveWorld\(\) && !hasShownThisSession/);
  });
});

describe('ADR-0063 — item 2: KeyQ TOGGLES the product panels (open if closed, close all if open)', () => {
  it('arenaRuntime Q handler closes via setMarketActive(false)+setBoardsActive(false) when open', () => {
    // The Q handler must check isMarketActive() and, when true, close BOTH the
    // market panel and the boards — not just re-open unconditionally.
    const qBlock = ARENA.match(/KeyQ[\s\S]{0,400}interact\(\)/);
    expect(qBlock).not.toBeNull();
    expect(qBlock[0]).toMatch(/isMarketActive\(\)/);
    expect(qBlock[0]).toMatch(/setMarketActive\(false\)/);
    expect(qBlock[0]).toMatch(/setBoardsActive\(false\)/);
  });
});

describe('ADR-0063 — item 4: loop.js uses THREE.Timer, not the deprecated THREE.Clock', () => {
  it('constructs a THREE.Timer (not Clock) and calls update() before getDelta()', () => {
    expect(LOOP).toMatch(/new THREE\.Timer\(\)/);
    expect(LOOP).not.toMatch(/new THREE\.Clock\(\)/);
    // update() must be called before getDelta() each frame.
    const updateIdx = LOOP.search(/_timer\.update\(/);
    const deltaIdx = LOOP.search(/_timer\.getDelta\(\)/);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(deltaIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(deltaIdx);
  });
});

describe('ADR-0063 — item 6: requestLock swallows the NotAllowedError promise rejection', () => {
  it('input.js requestLock catches the returned requestPointerLock() promise', () => {
    const fn = INPUT.match(/export function requestLock\(el\)\s*\{[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    const body = fn[0];
    // Must guard on a real element before locking.
    expect(body).toMatch(/typeof el\.requestPointerLock !== 'function'/);
    // Must catch the returned promise so NotAllowedError never surfaces uncaught.
    expect(body).toMatch(/\.catch\(/);
  });
});
