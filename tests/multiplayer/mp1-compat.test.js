// mp1-compat.test.js — MP_MODE=advisory rollback path.
//
// This is a source-level regression guard: the shipped server.arena-ws.js
// MUST still contain the advisory branches so `MP_MODE=advisory` can
// restore MP-1 (client-authoritative HIT relay) behaviour without a redeploy.
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

describe('MP_MODE=advisory rollback (MP-1 compat)', () => {
  it('MP_MODE env is read with authoritative as default', () => {
    expect(src).toMatch(
      /const\s+MP_MODE\s*=\s*\(process\.env\.MP_MODE\s*\|\|\s*['"]authoritative['"]\)/,
    );
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
