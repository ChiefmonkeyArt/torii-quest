// world-mirror.test.js — locks the portal live-mirror escalation (ADR-0118):
// resolve → peek → (live spectator) → idempotent drop, with graceful degradation.
// Pure; every side effect is a spy (no renderer/socket touched).
import { describe, it, expect } from 'vitest';
import { computePortalCamera, identityTransform, relativeToPortal } from '../../src/engine/world/portalCamera.js';
import { openMirror } from '../../src/engine/world/worldMirror.js';

const WORLD = { id: 'bekka-world', name: 'Bekka World' };
const RELAYS = ['wss://bekka.world/mp'];

function hooks() {
  const order = [];
  return {
    order,
    args: {
      target: 'npub1…',
      resolve: async () => { order.push('resolve'); return { ok: true, world: WORLD, relays: RELAYS }; },
      renderPortal: async (w) => { order.push('peek'); expect(w).toBe(WORLD); },
      openSpectator: async (relays) => { order.push('live'); expect(relays).toBe(RELAYS); return { ok: true, close: async () => order.push('spec-close') }; },
      disposePortal: async () => { order.push('dispose'); },
    },
  };
}

describe('portalCamera — parallax-correct mirror math', () => {
  const near = (a, b, e = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(e);

  it('identity gate pair leaves the portal camera equal to the viewer', () => {
    const viewer = { position: { x: 1, y: 2, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    const id = identityTransform();
    const cam = computePortalCamera({ viewer, portalFrom: id, portalTo: id });
    near(cam.position.x, 1); near(cam.position.y, 2); near(cam.position.z, 3);
    near(cam.quaternion.x, 0); near(cam.quaternion.y, 0); near(cam.quaternion.z, 0); near(cam.quaternion.w, 1);
  });

  it('pure translation shifts the camera by the gate offset', () => {
    const viewer = { position: { x: 1, y: 2, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    const from = identityTransform();
    const to = { position: { x: 10, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    const cam = computePortalCamera({ viewer, portalFrom: from, portalTo: to });
    near(cam.position.x, 11); near(cam.position.y, 2); near(cam.position.z, 3);
  });

  it('a 180° Y-flip gate flips the camera orientation', () => {
    const viewer = identityTransform();
    const from = identityTransform();
    const to = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 1, z: 0, w: 0 } }; // Y 180°
    const cam = computePortalCamera({ viewer, portalFrom: from, portalTo: to });
    near(cam.position.x, 0); near(cam.position.y, 0); near(cam.position.z, 0);
    near(cam.quaternion.x, 0); near(cam.quaternion.y, 1); near(cam.quaternion.z, 0); near(cam.quaternion.w, 0);
  });

  it('preserves the fundamental invariant: camera-in-to-frame == viewer-in-from-frame', () => {
    const viewer = { position: { x: 2, y: 1, z: -3 }, quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 } };
    const from = { position: { x: 1, y: 0, z: 5 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    const to = { position: { x: -4, y: 2, z: 0 }, quaternion: { x: 0, y: 0, z: 0.7071068, w: 0.7071068 } }; // Z 90°
    const cam = computePortalCamera({ viewer, portalFrom: from, portalTo: to });

    const relViewer = relativeToPortal(viewer, from);   // viewer in FROM-gate frame
    const relCam = relativeToPortal(cam, to);           // camera in TO-gate frame
    for (const k of ['x', 'y', 'z']) near(relCam.position[k], relViewer.position[k], 1e-4);
    for (const k of ['x', 'y', 'z', 'w']) near(relCam.quaternion[k], relViewer.quaternion[k], 1e-4);
  });
});

describe('openMirror escalation', () => {
  it('promotes peek → live and closes idempotently', async () => {
    const h = hooks();
    const m = await openMirror(h.args);
    expect(m.ok).toBe(true);
    expect(m.tier).toBe('live');
    expect(m.world).toBe(WORLD);
    expect(h.order).toEqual(['resolve', 'peek', 'live']);

    await m.close();
    await m.close(); // idempotent
    expect(h.order).toEqual(['resolve', 'peek', 'live', 'spec-close', 'dispose']);
  });

  it('degrades to peek when the spectator fails', async () => {
    const h = hooks();
    h.args.openSpectator = async () => ({ ok: false });
    const m = await openMirror(h.args);
    expect(m.ok).toBe(true);
    expect(m.tier).toBe('peek');
  });

  it('degrades to peek when no spectator is provided', async () => {
    const h = hooks();
    delete h.args.openSpectator;
    const m = await openMirror(h.args);
    expect(m.tier).toBe('peek');
  });

  it('fails closed at resolve / peek', async () => {
    const h = hooks();
    h.args.resolve = async () => ({ ok: false, reason: 'no-reference' });
    expect((await openMirror(h.args)).phase).toBe('resolve');

    const h2 = hooks();
    h2.args.renderPortal = async () => { throw new Error('boom'); };
    expect((await openMirror(h2.args)).phase).toBe('peek');
  });

  it('rejects a missing required hook before any work', async () => {
    const m = await openMirror({ resolve: async () => ({}) });
    expect(m.ok).toBe(false);
    expect(m.reason).toBe('missing-hook');
  });
});