// hit-relay.test.js — locks the MP-1 advisory-hit contract.
//
// The contract:
//   1. Client → server HIT is REBROADCAST with only the shooter's `id` STAMPED on top.
//      Nothing else in the payload is mutated. Damage, zone, and shotTs are the
//      shooter's claim, untouched.
//   2. Any extra fields the shooter tacks on (e.g. `godMode`, `dmg: 9999`) are
//      dropped by sanitize() before rebroadcast.
//   3. When MP-2 lands, this test will be EDITED to expect the server-recomputed
//      dmg/zone — the wire is unchanged, only interpretation flips.
//
// Because arena-ws.js binds a real socket at import time we don't unit-test it
// here — instead we exercise the SAME contract by using the shared decode/sanitize
// helpers plus a mimic of the server's rebroadcast policy. The prod server MUST
// match this policy line-for-line; the code review guards that manually.

import { describe, it, expect } from 'vitest';
import { MSG, decode, sanitize, encode } from '../../src/engine/multiplayer/wireProtocol.js';

// Mirror of arena-ws.js's HIT case — kept minimal + identical to the production
// broadcast policy so this test defends the contract.
function relayHit(shooterId, rawFromShooter) {
  const parsed = decode(rawFromShooter);
  if (!parsed.ok) throw new Error(`server would drop: ${parsed.code}`);
  const clean = sanitize(parsed.msg);
  return { ...clean, id: shooterId };
}

describe('advisory hit relay', () => {
  it('rebroadcasts damage/zone verbatim (MP-1 contract)', () => {
    const shooter = { t: MSG.HIT, targetId: 'victim1', dmg: 30, zone: 'head', shotTs: 100 };
    const out = relayHit('shooterA', encode(shooter));
    expect(out).toEqual({
      t: MSG.HIT, id: 'shooterA',
      targetId: 'victim1', dmg: 30, zone: 'head', shotTs: 100,
    });
  });

  it('strips ANY extra fields the shooter tacks on', () => {
    const evil = JSON.stringify({
      t: MSG.HIT, targetId: 'victim1', dmg: 30, zone: 'body', shotTs: 200,
      godMode: true, adminOverride: 'yes', arbitraryPayload: { a: 'x'.repeat(10_000) },
    });
    const out = relayHit('shooterA', evil);
    expect(out.godMode).toBeUndefined();
    expect(out.adminOverride).toBeUndefined();
    expect(out.arbitraryPayload).toBeUndefined();
  });

  it('server DOES stamp the shooter id — clients cannot spoof another shooter', () => {
    // Client attempts to send with a fake `id` claiming they are shooterB.
    const spoofed = JSON.stringify({
      t: MSG.HIT, id: 'shooterB', targetId: 'victim1', dmg: 30, zone: 'head', shotTs: 300,
    });
    // Server's real socket knows the shooter is 'shooterA' — that's the id we pass in.
    const out = relayHit('shooterA', spoofed);
    expect(out.id).toBe('shooterA');
  });

  it('the wire is stable across MP-1 → MP-2 (dmg/zone fields keep their names)', () => {
    // Contract lock: if a MP-2 refactor renames or re-types these fields, this
    // test must be intentionally updated. Freeze the shape.
    const shooter = { t: MSG.HIT, targetId: 'v', dmg: 1, zone: 'limb', shotTs: 0 };
    const parsed = decode(encode(shooter));
    expect(parsed.ok).toBe(true);
    expect(Object.keys(parsed.msg).sort()).toEqual(['dmg', 'shotTs', 't', 'targetId', 'zone']);
  });
});
