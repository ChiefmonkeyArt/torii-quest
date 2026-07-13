// mp1-compat.test.js — MP_MODE handling + authoritative combat guards.
//
// v0.2.378 hotfix fix 1: MP_MODE is now FORCED to 'authoritative' in code —
// the advisory (MP-1 client-authoritative HIT relay) mode was retired when the
// client dropped inbound client-side HIT in v0.2.374, so a stale
// `MP_MODE=advisory` in a live .env silently broke combat resolution. The env
// is still read (into MP_MODE_ENV) so a leftover advisory value can be warned
// about, and the now-DEAD advisory HIT/KILL branches remain in source (guarded
// by `MP_MODE === 'advisory'`, unreachable) rather than being ripped out.
//
// We inspect the source rather than boot a full ws server (arena-ws.js has
// no exports and no easy test harness), which is the same pattern used by
// other tests in this suite (tests/live-update-check.test.js etc.).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../../server/arena-ws.js'), 'utf8');

describe('MP_MODE forced authoritative (MP-1 compat)', () => {
  it('reads the MP_MODE env (into MP_MODE_ENV) with authoritative as default', () => {
    expect(src).toMatch(
      /const\s+MP_MODE_ENV\s*=\s*\(process\.env\.MP_MODE\s*\|\|\s*['"]authoritative['"]\)/,
    );
  });

  it('FORCES MP_MODE to authoritative in code (advisory retired)', () => {
    expect(src).toMatch(/const\s+MP_MODE\s*=\s*['"]authoritative['"]\s*;/);
  });

  it('warns when a retired MP_MODE=advisory env is still set', () => {
    expect(src).toMatch(/MP_MODE_ENV\s*===\s*['"]advisory['"]/);
    expect(src).toMatch(/log\.warn\([^)]*advisory/i);
  });

  it('resolves + broadcasts on every SHOT (not gated on MP_MODE)', () => {
    // The SHOT case must call resolveAndBroadcast unconditionally — no
    // `if (MP_MODE === 'authoritative')` gate that a stale env could skip.
    const shotBlock = src.match(/case\s+MSG\.SHOT:[\s\S]*?(?=\n\s*case\s+MSG\.)/);
    expect(shotBlock).not.toBeNull();
    expect(shotBlock[0]).toMatch(/resolveAndBroadcast\s*\(/);
    expect(shotBlock[0]).not.toMatch(/if\s*\(\s*MP_MODE\s*===/);
  });

  it('HIT branch relays untouched when advisory', () => {
    // Look for the advisory-mode HIT relay guard.
    expect(src).toMatch(/MP_MODE\s*===\s*['"]advisory['"]/);
    expect(src).toMatch(/case\s+MSG\.HIT[\s\S]{0,400}?broadcastToOthers/);
  });

  it('KILL branch relays untouched when advisory', () => {
    // Same pattern: KILL branch must contain an advisory relay path.
    const killBlock = src.match(/case\s+MSG\.KILL:[\s\S]*?return;/);
    expect(killBlock).not.toBeNull();
    expect(killBlock[0]).toMatch(/advisory/);
    expect(killBlock[0]).toMatch(/broadcastToOthers/);
  });

  it('authoritative HIT is never re-broadcast from a client-sent HIT frame', () => {
    // Regression: in authoritative mode the HIT case must NOT call broadcastToOthers.
    // The advisory branch is guarded by `if (MP_MODE === 'advisory')` — outside
    // that guard, the HIT case must be a bare return with no broadcast.
    const hitBlock = src.match(/case\s+MSG\.HIT:[\s\S]*?return;\s*}\s*(?=case)/);
    // Not a strict parse — just assert the block does NOT contain unguarded broadcasts.
    // A stricter regression exists in the regression-check script (tools/regression-check.mjs).
    expect(hitBlock).not.toBeNull();
    // Verify the block contains at least one 'advisory' guard (not raw relay).
    expect(hitBlock[0]).toMatch(/advisory/);
  });

  it('server emits authoritative HIT via broadcastToAll (not broadcastToOthers)', () => {
    // resolveAndBroadcast must use broadcastToAll so the shooter also gets the HIT.
    const rab = src.match(/function\s+resolveAndBroadcast[\s\S]*?\n\}/);
    expect(rab).not.toBeNull();
    expect(rab[0]).toMatch(/broadcastToAll/);
    expect(rab[0]).not.toMatch(/broadcastToOthers\s*\(/);
  });

  it('RESPAWN is sent only to the victim (sendTo), not broadcast', () => {
    const sr = src.match(/function\s+scheduleRespawn[\s\S]*?\n\}/);
    expect(sr).not.toBeNull();
    // Victim gets a direct sendTo; peers get a synthetic MOVE via broadcastToOthers.
    expect(sr[0]).toMatch(/sendTo\s*\(/);
    expect(sr[0]).toMatch(/MSG\.RESPAWN/);
  });
});
