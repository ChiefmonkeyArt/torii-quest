// remote-avatars.test.js — locks the roster lifecycle for MP-1 remote peers.
// Pure — fakes stand in for scene + avatarLoader.
import { describe, it, expect, vi } from 'vitest';
import { createRemoteAvatarRoster } from '../../src/engine/multiplayer/remoteAvatars.js';

function makeFakeObj(id) {
  const pos = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  const rot = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  const obj = { id, position: pos, rotation: rot, disposed: false, dispose() { this.disposed = true; } };
  return obj;
}
function makeFakeScene() {
  const added = new Set(); const removed = [];
  return {
    add: (o) => added.add(o),
    remove: (o) => { added.delete(o); removed.push(o); },
    _added: added, _removed: removed,
  };
}

const peer = (id, pos = [0, 0, 0], rot = [0, 0]) => ({
  id, npub: 'npub1' + 'a'.repeat(58), character: 'chiefmonkey', pos, rot,
});

describe('remoteAvatarRoster', () => {
  it('adds an avatar on upsert and seeds its transform from the descriptor', async () => {
    const scene = makeFakeScene();
    const loader = vi.fn(async (p) => makeFakeObj(p.id));
    const roster = createRemoteAvatarRoster({ avatarLoader: loader, scene });
    await roster.upsert(peer('p1', [5, 0, -3], [Math.PI / 2, 0]));
    expect(roster.size).toBe(1);
    expect(scene._added.size).toBe(1);
    const entry = roster._peek('p1');
    expect(entry.obj.position.x).toBe(5);
    expect(entry.obj.position.z).toBe(-3);
    expect(entry.obj.rotation.y).toBeCloseTo(Math.PI / 2, 6);
  });

  it('remove() disposes the scene object and clears the entry', async () => {
    const scene = makeFakeScene();
    const roster = createRemoteAvatarRoster({
      avatarLoader: async (p) => makeFakeObj(p.id),
      scene,
    });
    await roster.upsert(peer('p1'));
    const obj = roster._peek('p1').obj;
    roster.remove('p1');
    expect(roster.size).toBe(0);
    expect(obj.disposed).toBe(true);
    expect(scene._removed[0]).toBe(obj);
  });

  it('applyMove + tick interpolates the transform across snapshots', async () => {
    const scene = makeFakeScene();
    const roster = createRemoteAvatarRoster({
      avatarLoader: async (p) => makeFakeObj(p.id),
      scene,
    });
    await roster.upsert(peer('p1'));
    roster.applyMove('p1', { pos: [0, 0, 0],  rot: [0, 0], vel: [0, 0, 0], clientTs: 0 });
    roster.applyMove('p1', { pos: [10, 0, 0], rot: [0, 0], vel: [0, 0, 0], clientTs: 1000 });
    // With INTERP_DELAY_MS=100, renderTime=500 → target=400 → 40% between snaps.
    roster.tick(500);
    expect(roster._peek('p1').obj.position.x).toBeCloseTo(4, 6);
  });

  it('handles a peer leaving mid-load by disposing the loaded object', async () => {
    const scene = makeFakeScene();
    let resolveLoad;
    const loader = () => new Promise((res) => { resolveLoad = res; });
    const roster = createRemoteAvatarRoster({ avatarLoader: loader, scene });
    const loadPromise = roster.upsert(peer('p1'));
    // Simulate LEFT arriving before the async load finishes.
    roster.remove('p1');
    const obj = makeFakeObj('p1');
    resolveLoad(obj);
    await loadPromise;
    // The late-arriving object was disposed and never added to the scene.
    expect(scene._added.size).toBe(0);
    expect(obj.disposed).toBe(true);
  });

  it('dispose() clears all avatars', async () => {
    const scene = makeFakeScene();
    const roster = createRemoteAvatarRoster({
      avatarLoader: async (p) => makeFakeObj(p.id),
      scene,
    });
    await Promise.all([
      roster.upsert(peer('p1')),
      roster.upsert(peer('p2')),
      roster.upsert(peer('p3')),
    ]);
    expect(roster.size).toBe(3);
    roster.dispose();
    expect(roster.size).toBe(0);
    expect(scene._removed.length).toBe(3);
  });

  it('upsert on an existing peer is idempotent (does not reload)', async () => {
    const scene = makeFakeScene();
    const loader = vi.fn(async (p) => makeFakeObj(p.id));
    const roster = createRemoteAvatarRoster({ avatarLoader: loader, scene });
    await roster.upsert(peer('p1', [1, 0, 1]));
    await roster.upsert(peer('p1', [2, 0, 2]));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(roster.size).toBe(1);
  });
});
