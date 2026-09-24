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
import * as THREE from 'three';
import { computePortalCamera } from '../src/engine/world/portalCamera.js';
import { quatFromYaw } from '../src/engine/world/gateTransform.js';

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

  it('maps the destination gate with yaw π (180° flip into the arena)', () => {
    // The viewer stands SOUTH of the gate looking NORTH, but the destination arena lies
    // SOUTH of the destination gate — so the destination gate carries yaw π to flip the
    // view 180° (M_to · M_from⁻¹ rotates north → south, into the arena). Identity yaw
    // would show the sea behind the gate; π/2 would split the view sideways.
    expect(MIRROR).toContain('quatFromYaw(Math.PI)');
  });

  it('lights the mirror scene like the home arena (ambient + directional)', () => {
    expect(MIRROR).toContain("new T.AmbientLight(0xffc080, 0.55)");
    expect(MIRROR).toContain("new T.DirectionalLight(0xffa830, 1.15)");
  });
});

describe('v0.2.887 — portal camera looks INTO the arena (not the sea)', () => {
  // The viewer stands south of the gate (z=30) looking north (yaw π). The source gate
  // is fed with identity yaw at (0, 32); the destination gate carries yaw π. The portal
  // camera must end up looking SOUTH (toward the arena at the origin), not north (sea).
  const viewer = { position: { x: 0, y: 1.7, z: 30 }, quaternion: quatFromYaw(Math.PI) };
  const portalFrom = { position: { x: 0, y: 0, z: 32 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  const portalTo = { position: { x: 0, y: 0, z: 32 }, quaternion: quatFromYaw(Math.PI) };

  it('maps the north-facing viewer to a south-facing camera (into the arena)', () => {
    const cam = computePortalCamera({ viewer, portalFrom, portalTo });
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
      new THREE.Quaternion(cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w),
    );
    // Forward must point south (−Z), toward the arena at the origin.
    expect(fwd.z).toBeLessThan(-0.9);
    expect(Math.abs(fwd.x)).toBeLessThan(0.1);
  });

  it('identity destination yaw would look AWAY from the arena (regression guard)', () => {
    const cam = computePortalCamera({ viewer, portalFrom, portalTo: { ...portalTo, quaternion: { x: 0, y: 0, z: 0, w: 1 } } });
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
      new THREE.Quaternion(cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w),
    );
    // Identity yaw leaves the camera facing north (+Z) — the sea, not the arena.
    expect(fwd.z).toBeGreaterThan(0.9);
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
