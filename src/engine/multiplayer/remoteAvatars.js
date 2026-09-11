// remoteAvatars.js — scene bookkeeping for peer avatars.
//
// Impure by nature (touches THREE), but the roster/lifecycle orchestration is
// abstracted behind injected `avatarLoader` and `scene` interfaces so the pure
// bookkeeping logic can be unit-tested with fakes. See tests/multiplayer/
// remote-avatars.test.js.
//
// The idea: one RemoteAvatar per peer id. Each avatar owns its own
// snapshotBuffer (from positionSync.js) and a scene-side object (typically a
// Group with the peer's `.glb` character). Each frame, we sample the buffer
// and update the object's transform.
//
// Contract:
//   const roster = createRemoteAvatarRoster({ avatarLoader, scene });
//   roster.upsert(peer)     // peer = { id, npub, character, pos, rot }
//   roster.remove(peerId)
//   roster.applyMove(peerId, { pos, rot, vel, clientTs })
//   roster.tick(renderTime) // interpolate + push transforms into scene
//   roster.dispose()        // remove all avatars

import { createSnapshotBuffer, pushSnapshot, sample } from './positionSync.js';

/**
 * @param {object} deps
 * @param {(peer:object)=>Promise<object>|object} deps.avatarLoader
 *   Called with the peer descriptor; returns a scene-side object with
 *   `.position`, `.rotation`, `.visible`, and `.dispose()` (a THREE.Group in prod,
 *   a fake in tests).
 * @param {{ add:Function, remove:Function }} deps.scene
 *   Scene container; the loader-returned object is added on join, removed on left.
 * @param {(name:string, payload:object)=>void} [deps.emit]  Event sink for observability.
 */
export function createRemoteAvatarRoster({ avatarLoader, scene, emit = () => {} }) {
  if (typeof avatarLoader !== 'function') {
    throw new TypeError('remoteAvatars: avatarLoader must be a function');
  }
  if (!scene || typeof scene.add !== 'function' || typeof scene.remove !== 'function') {
    throw new TypeError('remoteAvatars: scene must expose add/remove');
  }

  /** @type {Map<string, { peer:object, obj:object|null, buf:object, loading:boolean }>} */
  const roster = new Map();

  async function upsert(peer) {
    if (!peer || typeof peer.id !== 'string') return;
    const existing = roster.get(peer.id);
    if (existing) {
      // Update descriptor; keep buffer + scene object.
      existing.peer = { ...existing.peer, ...peer };
      emit('avatar_update', { id: peer.id });
      return;
    }
    const entry = { peer, obj: null, buf: createSnapshotBuffer(), loading: true };
    roster.set(peer.id, entry);
    try {
      const obj = await avatarLoader(peer);
      // Peer may have left mid-load, or left and rejoined under the same id while
      // this load was pending. Only attach when THIS entry is still the one the
      // roster tracks for this id — otherwise dispose the stale result so it
      // cannot orphan a second scene object (audit F3).
      if (roster.get(peer.id) !== entry) {
        if (obj && typeof obj.dispose === 'function') obj.dispose();
        return;
      }
      entry.obj = obj;
      entry.loading = false;
      // Seed transform from the descriptor so first-frame doesn't snap to origin.
      if (Array.isArray(peer.pos) && obj.position && typeof obj.position.set === 'function') {
        obj.position.set(peer.pos[0], peer.pos[1], peer.pos[2]);
      }
      if (Array.isArray(peer.rot) && obj.rotation && typeof obj.rotation.set === 'function') {
        obj.rotation.set(0, peer.rot[0], 0); // y=yaw
      }
      scene.add(obj);
      emit('avatar_added', { id: peer.id });
    } catch (err) {
      // Load failed — only clear THIS slot if it is still current. A newer
      // leave+rejoin entry must not be deleted by a stale rejection (audit F3).
      if (roster.get(peer.id) === entry) {
        roster.delete(peer.id);
      }
      emit('avatar_load_error', { id: peer.id, error: String(err && err.message || err) });
    }
  }

  // reconcile(peers) — apply an authoritative roster snapshot (WELCOME/reconnect):
  // upsert every listed peer and remove any tracked peer absent from the snapshot.
  // A peer that left while we were disconnected can only be repaired here, since
  // its missed `peerLeft` frame never arrived (audit F2). Returns snapshot size.
  function reconcile(peers) {
    const snapshot = new Set();
    for (const p of peers || []) {
      if (p && typeof p.id === 'string') {
        snapshot.add(p.id);
        upsert(p); // async avatar load; fire-and-forget as with normal joins
      }
    }
    for (const id of Array.from(roster.keys())) {
      if (!snapshot.has(id)) remove(id);
    }
    return snapshot.size;
  }

  function remove(peerId) {
    const entry = roster.get(peerId);
    if (!entry) return;
    if (entry.obj) {
      try { scene.remove(entry.obj); } catch { /* noop */ }
      if (typeof entry.obj.dispose === 'function') {
        try { entry.obj.dispose(); } catch { /* noop */ }
      }
    }
    roster.delete(peerId);
    emit('avatar_removed', { id: peerId });
  }

  function applyMove(peerId, snap) {
    const entry = roster.get(peerId);
    if (!entry) return;
    pushSnapshot(entry.buf, snap);
  }

  // Wall-clock dt between ticks, seconds. Drives each avatar's animation mixer
  // (obj.update). Clamped so a tab-throttle gap doesn't fast-forward the clip, and
  // skipped on the very first tick (lastRenderTime unset → huge dt).
  let lastRenderTime = null;
  const MAX_DT = 0.1;

  function tick(renderTime) {
    let dt = 0;
    if (lastRenderTime !== null) {
      dt = Math.min(MAX_DT, Math.max(0, (renderTime - lastRenderTime) / 1000));
    }
    lastRenderTime = renderTime;
    for (const entry of roster.values()) {
      if (!entry.obj) continue;
      const s = sample(entry.buf, renderTime);
      if (s) {
        if (entry.obj.position && typeof entry.obj.position.set === 'function') {
          entry.obj.position.set(s.pos[0], s.pos[1], s.pos[2]);
        }
        if (entry.obj.rotation && typeof entry.obj.rotation.set === 'function') {
          entry.obj.rotation.set(0, s.rot[0], 0);
        }
      }
      if (dt > 0 && typeof entry.obj.update === 'function') entry.obj.update(dt, s);
    }
  }

  function dispose() {
    for (const id of Array.from(roster.keys())) remove(id);
  }

  return {
    upsert, remove, reconcile, applyMove, tick, dispose,
    // Test / debug seam — never depend on this in production wiring.
    _peek: (id) => roster.get(id) || null,
    get size() { return roster.size; },
    // v0.2.600: debug snapshot of all peers for ToriiDebug.mp()
    _debugPeers: () => Array.from(roster.entries()).map(([id, e]) => ({
      id,
      loading: e.loading,
      hasObj: !!e.obj,
      peer: e.peer ? { npub: e.peer.npub, character: e.peer.character, pos: e.peer.pos, rot: e.peer.rot } : null,
    })),
  };
}
