// tests/portal-mirror-full-arena.test.js — locks the v0.2.886 fix: the portal LIVE
// MIRROR (the wardrobe-door view through the travel gate) must render the DESTINATION
// world with the FULL legacy arena builder (buildArena + buildFoliage), NOT the
// simplified buildMinimalWorld cloud-platform reconstruction.
//
// Root cause (playtester): the home world renders via buildArena (sea, terrain, crates,
// bridge, torii gates, NAP zone, coastline, grass), but the peek/travel mirror used
// buildMinimalWorld — a generic heightmap platform that read as "missing all her
// details". Bekka's world is a copy of the home world, so the mirror must build the
// same recognisable arena. This is a SOURCE contract (portalMirror.js is browser-only,
// imports THREE + WebGL, so it cannot be imported in a node test).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = readFileSync(join(ROOT, 'src/engine/world/portalMirror.js'), 'utf8');

describe('v0.2.886 — portal mirror builds the FULL arena', () => {
  it('imports the full arena builder, not the minimal world renderer', () => {
    expect(MIRROR).toContain("import { buildArena } from '../../arena.js';");
    expect(MIRROR).toContain("import { buildFoliage } from '../../arena-foliage.js';");
    expect(MIRROR).not.toContain('buildMinimalWorld');
  });

  it('calls buildArena + buildFoliage into the mirror scene', () => {
    expect(MIRROR).toContain('buildArena(_scene)');
    expect(MIRROR).toContain('buildFoliage(undefined, _scene)');
  });
});

describe('v0.2.886 — arena builders accept a target scene', () => {
  it('buildArena / buildSeaMesh / buildBridge / buildFoliage are scene-parameterised', () => {
    const ARENA = readFileSync(join(ROOT, 'src/arena.js'), 'utf8');
    const SEA = readFileSync(join(ROOT, 'src/terrain/sea.js'), 'utf8');
    const BRIDGE = readFileSync(join(ROOT, 'src/bridge.js'), 'utf8');
    const FOLIAGE = readFileSync(join(ROOT, 'src/arena-foliage.js'), 'utf8');

    expect(ARENA).toContain('export function buildArena(scene = defaultScene)');
    expect(SEA).toContain('export function buildSeaMesh(scene, opts = {})');
    expect(BRIDGE).toContain('buildBridge(targetScene');
    expect(FOLIAGE).toContain('buildFoliage(onProgress, targetScene');
  });

  it('the mirror sea + grass are untracked (track:false / non-home scene)', () => {
    const ARENA = readFileSync(join(ROOT, 'src/arena.js'), 'utf8');
    const SEA = readFileSync(join(ROOT, 'src/terrain/sea.js'), 'utf8');
    // The HOME scene's sea is tracked (tick/dispose/getSeaMat); a mirror scene's is not.
    expect(ARENA).toContain('track: scene === defaultScene');
    expect(SEA).toContain('if (opts.track !== false)');
  });
});
