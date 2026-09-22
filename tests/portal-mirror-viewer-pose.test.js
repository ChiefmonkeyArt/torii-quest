// tests/portal-mirror-viewer-pose.test.js — locks the P0.1 root cause of the
// "blue screen" peek: the mirror's setViewer() MUST receive the camera's WORLD
// pose, not its LOCAL pose.
//
// The main camera is a CHILD of playerObj (player.js `playerObj.add(camera)`),
// so `camera.position` / `camera.quaternion` are LOCAL — an eye-offset sitting
// near the origin with pitch-only rotation. `computePortalCamera` treats the
// viewer as POSITIONED IN THE SOURCE WORLD, so a near-origin local pose maps the
// destination camera ~32m behind the destination island, where it stares at
// empty sky instead of the terrain (exactly the bug). Resolving the world pose
// through the parent (getWorldPosition / getWorldQuaternion) places the
// destination camera in front of the island where terrain fills the iris.
//
// Pure + node-safe: THREE + the world resolver leaves only (no WebGL/DOM).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { gateTransform } from '../src/engine/world/gateTransform.js';
import { liftTransformToTerrain } from '../src/engine/world/terrainSample.js';
import { computePortalCamera } from '../src/engine/world/portalCamera.js';

// A tiny inline-terrain world whose only gate sits at the origin of a small
// island. Terrain is a 2x2 zone (one cell) centred near the origin so the
// camera's forward/backward relationship to the island is unambiguous.
const island = {
  version: 1,
  id: 'pose-regression',
  name: 'Pose Regression',
  sky: { type: 'clear', color: '#87ceeb' },
  spawn: { x: 0, y: 2, z: 0, yaw: 0 },
  objects: [
    { type: 'torii-gate', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  ],
  terrain: {
    zones: [{
      rows: 2, cols: 2,
      // A 10x10 island of height 1, centred on the origin.
      scale: [10, 1, 10],
      offset: [0, 0, 0],
      heights: [1, 1, 1, 1],
    }],
  },
};

// The source gate the player stands in front of (mirrors arenaRuntime's
// _portalPos + identity quaternion).
const portalFrom = { position: { x: 0, y: 0.9, z: 32 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

function fwdVector(quat) {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(
    new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w),
  );
}

describe('portal mirror viewer pose (world vs local)', () => {
  const world = validateWorld(island).world;
  const portalTo = liftTransformToTerrain(world, gateTransform(world));

  it('maps a WORLD-space viewer (player at the gate, facing it) to a camera in front of the island', () => {
    // Player stands south of the gate, eye ~1.7 up, yaw = π (facing +Z toward
    // the gate). This is what getWorldPosition/getWorldQuaternion produce once
    // the parent (playerObj) transform is composed.
    const cam = computePortalCamera({
      viewer: { position: { x: 0, y: 1.7, z: 26 }, quaternion: { x: 0, y: 1, z: 0, w: 0 } },
      portalFrom,
      portalTo,
    });
    const fwd = fwdVector(cam.quaternion);
    // The destination camera must sit NEAR the island (small |z|), not behind it.
    expect(Math.abs(cam.position.z)).toBeLessThan(12);
    // And it must look TOWARD the island (forward has a positive-z component
    // when the island is centred at the origin ahead of the gate), never away.
    expect(fwd.z).toBeGreaterThan(0.2);
  });

  it('maps a LOCAL viewer pose (eye-offset only, pitch-only) to a camera far BEHIND the island — the blue-screen bug', () => {
    // The pre-fix code fed `camera.position` ≈ (0, -0.06, 0) and
    // `camera.quaternion` = pitch-only (identity at level look). This is what
    // made the frame sky-only.
    const cam = computePortalCamera({
      viewer: { position: { x: 0, y: -0.06, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
      portalFrom,
      portalTo,
    });
    const fwd = fwdVector(cam.quaternion);
    // The destination camera lands ~32m behind the island (the source gate's
    // z offset leaks through because the viewer never left the origin).
    expect(cam.position.z).toBeLessThan(-20);
    // And it looks away (negative z), never toward the island.
    expect(fwd.z).toBeLessThan(-0.2);
  });

  it('a real parented camera resolves to a WORLD pose, not its local one', () => {
    // Reproduce the actual scene graph: playerObj holds the yaw + world position,
    // the camera is a child with a local eye offset + pitch. This locks that the
    // caller must use getWorldPosition/getWorldQuaternion — local reads are wrong.
    const playerObj = new THREE.Object3D();
    playerObj.position.set(0, 1.7, 26);
    playerObj.rotation.y = Math.PI; // facing +Z (the gate)

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(0, -0.06, 0); // local eye offset (CAM_BASE_Y ≈ -0.06)
    camera.rotation.x = 0;            // level pitch (no yaw — yaw is on the parent)
    playerObj.add(camera);
    playerObj.updateMatrixWorld(true);

    const wPos = new THREE.Vector3();
    const wQuat = new THREE.Quaternion();
    camera.getWorldPosition(wPos);
    camera.getWorldQuaternion(wQuat);

    // World position is the player's position (z=26), NOT (0,-0.06,0).
    expect(wPos.x).toBeCloseTo(0);
    expect(wPos.y).toBeCloseTo(1.64); // 1.7 - 0.06
    expect(wPos.z).toBeCloseTo(26);

    // Local position/quaternion (what the bug fed) stay near the origin.
    expect(camera.position.z).toBeCloseTo(0);
    // World yaw (about Y) is applied via the parent — the local quaternion alone
    // lacks it. The world forward must point +Z (toward the gate), while a
    // level-pitch local quaternion still points -Z (THREE camera default).
    const worldFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(wQuat);
    expect(worldFwd.z).toBeGreaterThan(0.9);
    const localFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(localFwd.z).toBeLessThan(-0.9);
  });
});