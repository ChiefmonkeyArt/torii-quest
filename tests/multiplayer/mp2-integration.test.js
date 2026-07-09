// mp2-integration.test.js — MP-2 pure end-to-end: MOVE → SHOT → HIT → KILL → respawn.
//
// This exercises the server-side pipeline without spinning up the ws layer
// (arena-ws.js has no exports). It composes the pure modules the same way
// resolveAndBroadcast does, and asserts the observable output.
import { describe, it, expect } from 'vitest';
import { createSnapshotRing, push } from '../../server/combat/snapshotRing.js';
import { resolveShot } from '../../server/combat/hitResolver.js';
import { damageFor } from '../../server/combat/damageTable.js';
import { createHpLedger, applyDamage, respawn, register } from '../../server/combat/hpLedger.js';

function mkPeerRing(id, snap) {
  const ring = createSnapshotRing();
  push(ring, snap);
  return { id, ring };
}

describe('MP-2 integration (pure pipeline)', () => {
  it('MOVE → SHOT resolves to HIT, damage lands, KILL follows on lethal dose', () => {
    const now = 10_000;
    const led = createHpLedger();
    register(led, 'shooter');
    register(led, 'victim');
    // Victim has been at (0, 1.7, 5) for 100ms.
    const peerRings = [mkPeerRing('victim', {
      ts: now, pos: [0, 1.7, 5], rot: [0, 0], vel: [0, 0, 0],
    })];

    // Shooter fires a headshot along +z from origin.
    const shot = { origin: [0, 1.7, 0], dir: [0, 0, 1], ts: now };
    const hit = resolveShot({ shooterId: 'shooter', shot, peerRings, now });
    expect(hit).not.toBeNull();
    expect(hit.targetId).toBe('victim');
    expect(hit.zone).toBe('head');

    // Apply damage server-side using the parity table.
    const dmg = damageFor(hit.zone);
    expect(dmg).toBe(9);
    // With HP=100, one headshot does not kill.
    const step1 = applyDamage(led, hit.targetId, dmg);
    expect(step1.killed).toBe(false);
    expect(step1.hpAfter).toBe(91);

    // A large chained damage kills.
    const step2 = applyDamage(led, hit.targetId, 999);
    expect(step2.killed).toBe(true);
    expect(step2.hpAfter).toBe(0);

    // Respawn: victim returns to full HP at a corner far from shooter (origin).
    const r = respawn(led, 'victim', [0, 1.7, 0]);
    expect(r.hp).toBe(100);
    // Any of the 4 corners at magnitude 14 in x AND z.
    expect(Math.abs(r.pos[0])).toBe(14);
    expect(Math.abs(r.pos[2])).toBe(14);
  });

  it('shooter never hits themselves even with intersecting ring history', () => {
    const now = 5000;
    const peerRings = [
      mkPeerRing('shooter', { ts: now, pos: [0, 1.7, 5], rot: [0, 0], vel: [0, 0, 0] }),
    ];
    const shot = { origin: [0, 1.7, 0], dir: [0, 0, 1], ts: now };
    const hit = resolveShot({ shooterId: 'shooter', shot, peerRings, now });
    expect(hit).toBeNull();
  });

  it('shot missing all peer capsules returns null (no HIT broadcast)', () => {
    const now = 5000;
    const peerRings = [mkPeerRing('p1', {
      ts: now, pos: [50, 1.7, 50], rot: [0, 0], vel: [0, 0, 0],
    })];
    const shot = { origin: [0, 1.7, 0], dir: [0, 0, 1], ts: now };
    const hit = resolveShot({ shooterId: 'shooter', shot, peerRings, now });
    expect(hit).toBeNull();
  });
});
