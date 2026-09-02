// tests/adr-0098-client-suspend-on-home.test.js
//
// ADR-0098 (v0.2.742-alpha): client-suspend on Home.
//
// Locks the four independent behaviours behind the "leave arena \u2192 title" fix:
//
//  1. loop.js exports stopLoop() which flips isLoopStopped() to true and prevents
//     the next scheduled rAF from executing update().
//  2. src/engine/state/clientSuspended.js is a pure flag with the exact shape the
//     audio/bots guards read (isClientSuspended + setClientSuspended).
//  3. src/audio.js#playBotShoot short-circuits when isClientSuspended() is true \u2014
//     no AudioContext is even resolved, so a server SHOT relay that races an
//     in-flight Home teardown plays no sound.
//  4. src/bots.js#applyBotShot short-circuits when isClientSuspended() is true \u2014
//     no bullet spawn callback fires either, so the perpetual world keeps ticking
//     on the server without our client painting anything.
//
// Each check reads the source text directly so refactors that break the contract
// (removing the guard, renaming the flag, dropping the export) fail the test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initLoop, startLoop, stopLoop, isLoopStopped } from '../src/loop.js';
import { isClientSuspended, setClientSuspended } from '../src/engine/state/clientSuspended.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_SRC = readFileSync(join(ROOT, 'src/audio.js'), 'utf8');
const BOTS_SRC = readFileSync(join(ROOT, 'src/bots.js'), 'utf8');
const RUNTIME_SRC = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');

// Bounded synchronous rAF stub \u2014 same shape as loop-fail-closed.test.js so a
// stopLoop() call halts the loop and no further frames execute.
function driveSync(cap = 64) {
  let scheduled = 0;
  globalThis.requestAnimationFrame = (cb) => {
    if (++scheduled > cap) return scheduled;
    cb();
    return scheduled;
  };
  return () => scheduled;
}

describe('ADR-0098 client-suspend on Home \u2014 loop.js', () => {
  beforeEach(() => {
    setClientSuspended(false);
    globalThis.requestAnimationFrame = () => 0;
  });
  afterEach(() => {
    delete globalThis.requestAnimationFrame;
    setClientSuspended(false);
  });

  it('stopLoop() sets isLoopStopped() true and prevents the next update tick', () => {
    driveSync();
    let ticks = 0;
    initLoop(() => { ticks++; stopLoop(); }, null);
    startLoop();
    expect(isLoopStopped()).toBe(true);
    // One tick ran (the one that called stopLoop); the rAF reschedule was skipped.
    expect(ticks).toBe(1);
  });

  it('is idempotent \u2014 calling stopLoop() twice does not throw and leaves the loop stopped', () => {
    stopLoop();
    stopLoop();
    expect(isLoopStopped()).toBe(true);
  });

  it('startLoop() after stopLoop() re-arms the loop \u2014 required for ENTER-after-Home', () => {
    driveSync();
    let ticks = 0;
    initLoop(() => { ticks++; if (ticks >= 2) stopLoop(); }, null);
    // First run \u2014 halts itself after 2 ticks.
    startLoop();
    expect(ticks).toBe(2);
    // Restart \u2014 must run again.
    ticks = 0;
    startLoop();
    expect(ticks).toBe(2);
  });
});

describe('ADR-0098 client-suspend on Home \u2014 clientSuspended flag', () => {
  afterEach(() => { setClientSuspended(false); });

  it('starts false', () => {
    expect(isClientSuspended()).toBe(false);
  });

  it('setClientSuspended(true) flips the flag; setClientSuspended(false) clears it', () => {
    setClientSuspended(true);
    expect(isClientSuspended()).toBe(true);
    setClientSuspended(false);
    expect(isClientSuspended()).toBe(false);
  });

  it('coerces truthy/falsy inputs to booleans', () => {
    setClientSuspended(1);
    expect(isClientSuspended()).toBe(true);
    setClientSuspended(0);
    expect(isClientSuspended()).toBe(false);
  });
});

describe('ADR-0098 client-suspend on Home \u2014 audio.js source contract', () => {
  it('imports isClientSuspended from the shared state module', () => {
    expect(AUDIO_SRC).toMatch(
      /import\s*\{\s*isClientSuspended\s*\}\s*from\s*'\.\/engine\/state\/clientSuspended\.js'/,
    );
  });
  it('exports suspendAudioContext + resumeAudioContext for the runtime to call', () => {
    expect(AUDIO_SRC).toMatch(/export\s+function\s+suspendAudioContext\s*\(/);
    expect(AUDIO_SRC).toMatch(/export\s+function\s+resumeAudioContext\s*\(/);
  });
  it('playBotShoot short-circuits when isClientSuspended() returns true', () => {
    // The guard must sit BEFORE _audioCtx() so a suspended client never even
    // resolves the AudioContext (no side-effect on a fresh page load either).
    const body = AUDIO_SRC.match(
      /export\s+function\s+playBotShoot\s*\(\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(body).not.toBeNull();
    const [firstStmt] = body[1].trim().split('\n');
    expect(firstStmt).toContain('isClientSuspended()');
    expect(firstStmt).toContain('return');
  });
});

describe('ADR-0098 client-suspend on Home \u2014 bots.js source contract', () => {
  it('imports isClientSuspended from the shared state module', () => {
    expect(BOTS_SRC).toMatch(
      /import\s*\{\s*isClientSuspended\s*\}\s*from\s*'\.\/engine\/state\/clientSuspended\.js'/,
    );
  });
  it('applyBotShot short-circuits when isClientSuspended() returns true (before the Array checks)', () => {
    const body = BOTS_SRC.match(
      /export\s+function\s+applyBotShot\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(body).not.toBeNull();
    const [firstStmt] = body[1].trim().split('\n');
    expect(firstStmt).toContain('isClientSuspended()');
    expect(firstStmt).toContain('return');
  });
});

describe('ADR-0098 client-suspend on Home \u2014 arenaRuntime.js wiring', () => {
  it('imports stopLoop + isLoopStopped from loop.js', () => {
    expect(RUNTIME_SRC).toMatch(
      /import\s*\{[^}]*\bstopLoop\b[^}]*\bisLoopStopped\b[^}]*\}\s*from\s*'\.\/loop\.js'/,
    );
  });
  it('imports setClientSuspended from the shared state module', () => {
    expect(RUNTIME_SRC).toMatch(
      /import\s*\{\s*setClientSuspended\s*\}\s*from\s*'\.\/engine\/state\/clientSuspended\.js'/,
    );
  });
  it('imports suspendAudioContext + resumeAudioContext from audio.js', () => {
    expect(RUNTIME_SRC).toMatch(
      /import\s*\{[^}]*\bsuspendAudioContext\b[^}]*\bresumeAudioContext\b[^}]*\}\s*from\s*'\.\/audio\.js'/,
    );
  });
  it('defines leaveToTitle and resumeFromTitle functions', () => {
    expect(RUNTIME_SRC).toMatch(/function\s+leaveToTitle\s*\(\)/);
    expect(RUNTIME_SRC).toMatch(/function\s+resumeFromTitle\s*\(\)/);
  });
  it('exports leaveToTitle and resumeFromTitle from the runtime factory return', () => {
    // The runtime factory's `return { \u2026 }` object must expose both handles.
    // Slice from the last `return {` to the end \u2014 that\u2019s the factory return.
    const returnIdx = RUNTIME_SRC.lastIndexOf('return {');
    expect(returnIdx).toBeGreaterThan(-1);
    const returnBlock = RUNTIME_SRC.slice(returnIdx);
    expect(returnBlock).toMatch(/\bleaveToTitle\b/);
    expect(returnBlock).toMatch(/\bresumeFromTitle\b/);
  });
  it('leaveToTitle sets the suspended flag, suspends audio, halts the loop', () => {
    const body = RUNTIME_SRC.match(
      /function\s+leaveToTitle\s*\(\)\s*\{([\s\S]*?)\n\s{2}\}/,
    );
    expect(body).not.toBeNull();
    const [, src] = body;
    expect(src).toContain('setClientSuspended(true)');
    expect(src).toContain('suspendAudioContext()');
    expect(src).toContain('stopLoop()');
  });
  it('resumeFromTitle clears the flag, resumes audio, restarts a stopped loop', () => {
    const body = RUNTIME_SRC.match(
      /function\s+resumeFromTitle\s*\(\)\s*\{([\s\S]*?)\n\s{2}\}/,
    );
    expect(body).not.toBeNull();
    const [, src] = body;
    expect(src).toContain('setClientSuspended(false)');
    expect(src).toContain('resumeAudioContext()');
    expect(src).toContain('startLoop()');
  });
  it('#btn-home handler calls leaveToTitle() before transitioning to HOME', () => {
    // Extract the click handler for elHomeBtn and assert order: leaveToTitle
    // must run BEFORE transition(GAME_EVENT.HOME) so the loop halts before the
    // phase change fires further ticks.
    const handler = RUNTIME_SRC.match(
      /elHomeBtn\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{([\s\S]*?)\}\)/,
    );
    expect(handler).not.toBeNull();
    const [, src] = handler;
    const leaveIdx = src.indexOf('leaveToTitle(');
    const transIdx = src.indexOf('transition(GAME_EVENT.HOME)');
    expect(leaveIdx).toBeGreaterThan(-1);
    expect(transIdx).toBeGreaterThan(-1);
    expect(leaveIdx).toBeLessThan(transIdx);
  });
  it('enter() calls resumeFromTitle() so ENTER-after-Home wakes the client', () => {
    // resumeFromTitle must appear inside the enter() body, and it must be the
    // first substantive call so the loop is armed before the phase transition.
    const body = RUNTIME_SRC.match(/function\s+enter\s*\(\)\s*\{([\s\S]*?)\n\s{2}\}/);
    expect(body).not.toBeNull();
    const [, src] = body;
    expect(src).toContain('resumeFromTitle()');
    expect(src.indexOf('resumeFromTitle()')).toBeLessThan(src.indexOf('transition('));
  });
});

// End-to-end tiny behavioural test: with the guard in place, calling into the
// audio module\u2019s playBotShoot with the flag ON must not touch the AudioContext.
// We assert via the source contract above rather than stubbing WebAudio; here we
// belt-and-brace by verifying the flag semantics directly.
describe('ADR-0098 client-suspend on Home \u2014 end-to-end flag semantics', () => {
  afterEach(() => setClientSuspended(false));
  it('flag flip is visible to any importer of clientSuspended.js', async () => {
    // Simulate the runtime toggle path.
    setClientSuspended(true);
    // A separate consumer sees the same view.
    const mod = await import('../src/engine/state/clientSuspended.js');
    expect(mod.isClientSuspended()).toBe(true);
    setClientSuspended(false);
    expect(mod.isClientSuspended()).toBe(false);
  });
});
