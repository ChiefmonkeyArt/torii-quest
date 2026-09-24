// tests/portal-mirror-full-arena.test.js — locks the v0.2.888 fix: the portal LIVE
// MIRROR (the wardrobe-door view through the travel gate) must render the DESTINATION
// world as the HOME scene itself, NOT a second procedural rebuild.
//
// Root cause (playtester): rebuilding a second arena for the mirror was slow (a full
// buildArena + buildFoliage + GLB pass every peek) and never matched the home scene's
// Sky.js atmosphere or animated sea/grass — it read as "rubbish, not even fake live".
// Bekka's world is a copy of the home world, so the mirror renders the HOME scene from
// a portal camera on the far side of the gate, hiding the NPC + the viewer's own body
// for the pass. This is a SOURCE contract (portalMirror.js is browser-only, imports
// THREE + WebGL, so it cannot be imported in a node test).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { computePortalCamera } from '../src/engine/world/portalCamera.js';
import { quatFromYaw } from '../src/engine/world/gateTransform.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = readFileSync(join(ROOT, 'src/engine/world/portalMirror.js'), 'utf8');

describe('v0.2.888 — portal mirror renders the HOME scene (no rebuild)', () => {
  it('renders the home scene, not a second arena rebuild', () => {
    expect(MIRROR).toContain("import { scene as defaultScene } from '../../scene.js';");
    expect(MIRROR).toContain('renderer.render(defaultScene, _camera)');
    expect(MIRROR).not.toContain('buildArena(_scene)');
    expect(MIRROR).not.toContain('buildMinimalWorld');
  });

  it('hides the NPC + first-person body for the pass', () => {
    expect(MIRROR).toContain("import { setNapNpcVisible } from '../../napNpc.js';");
    expect(MIRROR).toContain("import { setPortalMirrorHidden } from '../../firstPersonBody.js';");
    expect(MIRROR).toContain('setNapNpcVisible(false)');
    expect(MIRROR).toContain('setPortalMirrorHidden(true)');
  });

  it('maps the destination gate with yaw π (180° flip into the arena)', () => {
    // The viewer stands SOUTH of the gate looking NORTH, but the destination arena lies
    // SOUTH of the destination gate — so the destination gate carries yaw π to flip the
    // view 180° (M_to · M_from⁻¹ rotates north → south, into the arena). Identity yaw
    // would show the sea behind the gate; π/2 would split the view sideways.
    expect(MIRROR).toContain('quatFromYaw(Math.PI)');
  });
});

describe('v0.2.891 — mirror clears the RT + hides bot nameplates (overexposure fix)', () => {
  it('clears the render target before rendering (stale-buffer whiteout fix)', () => {
    // The renderer runs with autoClear=false, so the mirror RT is never cleared — the
    // Sky.js dome (depthWrite=false) reads stale depth and the sun sprite's semi-transparent
    // corona accumulates frame-over-frame into a blown-out white horizon. An explicit clear
    // before the pass fixes it.
    expect(MIRROR).toContain('renderer.clear()');
  });

  it('hides bot nameplates for the pass', () => {
    expect(MIRROR).toContain("import { setAllNameplatesVisible } from '../../bots.js';");
    expect(MIRROR).toContain('setAllNameplatesVisible(false)');
    expect(MIRROR).toContain('setAllNameplatesVisible(true)');
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

  it('the home sea is tracked; a non-home scene is not', () => {
    const ARENA = readFileSync(join(ROOT, 'src/arena.js'), 'utf8');
    const SEA = readFileSync(join(ROOT, 'src/terrain/sea.js'), 'utf8');
    // The HOME scene's sea is tracked (tick/dispose/getSeaMat); a non-home scene's is not.
    expect(ARENA).toContain('track: scene === defaultScene');
    expect(SEA).toContain('if (opts.track !== false)');
  });
});
