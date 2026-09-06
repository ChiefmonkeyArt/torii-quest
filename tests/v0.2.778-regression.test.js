// tests/v0.2.778-regression.test.js — hard-freeze hardening (Bug L).
//
// Bug L (user report, twice in one day): "the game / homescreen froze … nothing
// is clickable and a hard refresh (Shift+Ctrl+R) does nothing … have to close
// the tab and reopen." Happened after the user entered the arena and returned
// to the title screen — the 3D loop (NPC walk + bot angle-lerp) keeps running
// warm behind the menu (ADR-0098). A hard-freeze-that-survives-reload is the
// signature of a SYNCHRONOUS infinite loop: the old angle-normalisation
// `while (d > Math.PI) d -= 2π` loops FOREVER if d becomes ±Infinity/NaN (a
// poisoned GLB-animation quaternion or an upstream divide-by-zero), because
// subtracting a finite 2π from ±Infinity is still ±Infinity. One such loop
// inside the per-frame update blocks the main thread permanently.
//
// This suite freezes the fix + the diagnostic:
//   1. engine/math/angle.js normalizeAngle() is O(1) + non-finite-safe (unit
//      tests on the pure function).
//   2. botNetState._lerpAngle and napNpc walk use normalizeAngle — no `while`
//      angle-normalisation remains anywhere in src (comment-aware sweep).
//   3. input.wrapAngle guards non-finite input.
//   4. engine/diagnostics/freezeWatchdog.js ships a blob-worker stall monitor
//      and setFreezeStage(); it is wired + stage-stamped in main.js/loop.js.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeAngle } from '../src/engine/math/angle.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SRC = {
  angle: read('src/engine/math/angle.js'),
  bot: read('src/engine/entities/botNetState.js'),
  napNpc: read('src/napNpc.js'),
  input: read('src/input.js'),
  loop: read('src/loop.js'),
  watchdog: read('src/engine/diagnostics/freezeWatchdog.js'),
  main: read('src/main.js'),
};

// Remove line + block comments so prose describing the fix never falsely matches
// a "here is a loop" assertion (the comments intentionally describe the old
// `while` loops we removed).
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/gm, '$1');
}

// Recursively collect every .js under src/ so the "no loop remains" sweep is
// exhaustive (not just the two known call sites).
function allSrcJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allSrcJs(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('v0.2.778 — Bug L: normalizeAngle is O(1) and non-finite-safe', () => {
  it('is a single-shot wrap with no loop construct (cannot infinite-loop)', () => {
    expect(stripComments(SRC.angle)).toMatch(/export function normalizeAngle/);
    // The function body must be branch-free arithmetic — no loop construct.
    const body = stripComments(SRC.angle).match(/export function normalizeAngle[\s\S]*?\n\}/)?.[0] || '';
    expect(body).not.toMatch(/while\s*\(|for\s*\(;;/);
  });

  it('clamps ±Infinity and NaN to a neutral 0 heading', () => {
    expect(normalizeAngle(Infinity)).toBe(0);
    expect(normalizeAngle(-Infinity)).toBe(0);
    expect(normalizeAngle(NaN)).toBe(0);
  });

  it('wraps finite values into the shortest-arc range', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 10);
    expect(normalizeAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 10);
    // 3π/2 ≡ -π/2 (and -3π/2 ≡ +π/2): the wrap lands inside [-π, π).
    expect(normalizeAngle(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 10);
    expect(normalizeAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
  });

  it('stays within [-π, π) across a sweep of large + negative inputs', () => {
    for (let k = -50; k <= 50; k++) {
      const a = k * Math.PI * 0.73 + 0.123; // non-trivial angles far outside unity range
      const r = normalizeAngle(a);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(-Math.PI);
      expect(r).toBeLessThan(Math.PI);
    }
  });
});

describe('v0.2.778 — Bug L: every angle-normalisation path uses the safe wrap', () => {
  it('botNetState._lerpAngle uses normalizeAngle (no while loop)', () => {
    expect(SRC.bot).toMatch(/import\s*\{\s*normalizeAngle\s*\}\s*from\s*['"]\.\.\/math\/angle\.js['"]/);
    expect(stripComments(SRC.bot)).toMatch(/const d = normalizeAngle\(b - a\)/);
    expect(stripComments(SRC.bot)).not.toMatch(/while\s*\(\s*d\s*>\s*Math\.PI/);
  });

  it('napNpc walk uses normalizeAngle (no while loop)', () => {
    expect(SRC.napNpc).toMatch(/import\s*\{\s*normalizeAngle\s*\}\s*from\s*['"]\.\/engine\/math\/angle\.js['"]/);
    expect(stripComments(SRC.napNpc)).toMatch(/const dyaw = normalizeAngle\(targetYaw - _root\.rotation\.y\)/);
    expect(stripComments(SRC.napNpc)).not.toMatch(/while\s*\(\s*dyaw\s*>/);
  });

  it('no angle-normalisation `while` loops remain anywhere in src (comment-aware sweep)', () => {
    const loopRe = /while\s*\([^)]*(?:Math\.PI|2\s*\*\s*Math\.PI)/;
    for (const file of allSrcJs(join(ROOT, 'src'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (loopRe.test(code)) {
        throw new Error(`angle-normalisation loop remains in ${file.replace(ROOT, '')}`);
      }
    }
  });

  it('input.wrapAngle guards non-finite input', () => {
    expect(stripComments(SRC.input)).toMatch(/if\s*\(\s*!Number\.isFinite\(a\)\s*\)\s*return 0/);
  });
});

describe('v0.2.778 — Bug L: freeze watchdog ships and is wired', () => {
  it('freezeWatchdog exports setFreezeStage + installFreezeWatchdog', () => {
    expect(SRC.watchdog).toMatch(/export function setFreezeStage/);
    expect(SRC.watchdog).toMatch(/export function installFreezeWatchdog/);
  });

  it('spawns a blob worker that pings main and warns on a stall', () => {
    expect(SRC.watchdog).toMatch(/new Blob\(\[workerCode\]/);
    expect(SRC.watchdog).toMatch(/new Worker\(url\)/);
    expect(SRC.watchdog).toMatch(/postMessage\(\{\s*type:\s*['"]ping['"]\s*\}\)/);
    expect(SRC.watchdog).toMatch(/freeze-watchdog.*main thread unresponsive/);
  });

  it('is idempotent and browser-only (no-op under node/test)', () => {
    expect(SRC.watchdog).toMatch(/typeof Worker\s*===\s*['"]undefined['"]/);
    expect(SRC.watchdog).toMatch(/__toriiFreezeWatchdog/);
  });

  it('is installed in main.js and stage-stamped in loop.js', () => {
    expect(SRC.main).toMatch(/installFreezeWatchdog\(\)/);
    expect(SRC.loop).toMatch(/setFreezeStage\('loop-update'\)/);
    expect(SRC.loop).toMatch(/setFreezeStage\('loop-idle'\)/);
  });
});