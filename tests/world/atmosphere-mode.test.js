// tests/world/atmosphere-mode.test.js
//
// P2 — sky V artifact / atmosphere restore. The arena's warm sunrise sky layer
// (Sky.js dome + sun sprite + god rays + star shells) belongs to the HOME arena
// and must hide when a foreign `space` world (which paints its own flat
// background + starfield) is swapped in, and re-show on homecoming / non-space
// worlds. resolveAtmosphereMode is the pure decision (no THREE/DOM) so it is
// node-testable directly; the impure scene mutation (setArenaAtmosphere) is a
// THREE module and is asserted by source-contract instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  resolveAtmosphereMode,
  ATMOSPHERE_ARENA,
  ATMOSPHERE_SPACE,
} from '../../src/engine/world/atmosphereMode.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCENE = readFileSync(join(ROOT, 'src/scene.js'), 'utf8');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');

describe('P2 — atmosphere restore (resolveAtmosphereMode)', () => {
  it('resolves a space world to SPACE', () => {
    expect(resolveAtmosphereMode({ sky: { type: 'space' } })).toBe(ATMOSPHERE_SPACE);
  });

  it('resolves a clear world to ARENA (home arena is clear)', () => {
    expect(resolveAtmosphereMode({ sky: { type: 'clear', color: '#87ceeb' } })).toBe(ATMOSPHERE_ARENA);
  });

  it('resolves a dusk world to ARENA', () => {
    expect(resolveAtmosphereMode({ sky: { type: 'dusk' } })).toBe(ATMOSPHERE_ARENA);
  });

  it('resolves a world with NO sky to ARENA (fail closed to home)', () => {
    expect(resolveAtmosphereMode({})).toBe(ATMOSPHERE_ARENA);
    expect(resolveAtmosphereMode(null)).toBe(ATMOSPHERE_ARENA);
    expect(resolveAtmosphereMode(undefined)).toBe(ATMOSPHERE_ARENA);
  });

  it('resolves a malformed sky to ARENA (unknown type / non-string type)', () => {
    expect(resolveAtmosphereMode({ sky: { type: 'spacey' } })).toBe(ATMOSPHERE_ARENA);
    expect(resolveAtmosphereMode({ sky: { type: 42 } })).toBe(ATMOSPHERE_ARENA);
    expect(resolveAtmosphereMode({ sky: null })).toBe(ATMOSPHERE_ARENA);
    expect(resolveAtmosphereMode({ sky: {} })).toBe(ATMOSPHERE_ARENA);
  });

  it('resolves a space sky with extra keys to SPACE', () => {
    expect(resolveAtmosphereMode({ sky: { type: 'space', color: '#000000', stars: true } })).toBe(ATMOSPHERE_SPACE);
  });
});

describe('P2 — atmosphere restore (source contract)', () => {
  it('scene.js exports setArenaAtmosphere and toggles the sky layer meshes', () => {
    expect(SCENE).toMatch(/export function setArenaAtmosphere\(show\)/);
    // The five shared atmospheric meshes: Sky dome, sun sprite, god rays, both star shells.
    for (const mesh of ['_sky', '_sunSprite', '_godRays', '_starField', '_starFieldInner']) {
      expect(SCENE).toMatch(new RegExp(`${mesh}\\.visible = on;`));
    }
  });

  it('scene.js setArenaAtmosphere restores the arena fog on show', () => {
    expect(SCENE).toMatch(/if \(!scene\.fog\) scene\.fog = new THREE\.FogExp2\(ARENA_FOG_COLOR, ARENA_FOG_DENSITY\);/);
    expect(SCENE).toMatch(/const ARENA_FOG_COLOR = 0xc8a878;/);
    expect(SCENE).toMatch(/const ARENA_FOG_DENSITY = 0\.002;/);
  });

  it('scene.js setArenaAtmosphere is idempotent (guards on the current state)', () => {
    expect(SCENE).toMatch(/if \(_arenaAtmosphereVisible === on\) return;/);
  });

  it('runtime imports setArenaAtmosphere from scene.js', () => {
    expect(RUNTIME).toMatch(/import \{[^}]*setArenaAtmosphere[^}]*\} from '\.\/scene\.js'/);
  });

  it('runtime imports resolveAtmosphereMode + ATMOSPHERE_ARENA', () => {
    expect(RUNTIME).toMatch(/import \{ resolveAtmosphereMode, ATMOSPHERE_ARENA \} from '\.\/engine\/world\/atmosphereMode\.js'/);
  });

  it('runtime syncs the atmosphere on the in-place world swap', () => {
    expect(RUNTIME).toMatch(/setArenaAtmosphere\(resolveAtmosphereMode\(_minimalWorld\) === ATMOSPHERE_ARENA\);/);
  });

  it('runtime syncs the atmosphere on first minimal boot too', () => {
    // The same call must appear at least twice: once in boot, once in _rebuildWorldInPlace.
    const matches = RUNTIME.match(/setArenaAtmosphere\(resolveAtmosphereMode\(_minimalWorld\) === ATMOSPHERE_ARENA\);/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});