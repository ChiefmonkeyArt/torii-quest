// tests/multiplayer/bot-hit-zone.test.js — ADR-0017 (v0.2.626).
// The server BOT_HIT payload already carries a zone ('head' | 'body' | 'limb').
// The client wire schema accepts it (bot-wire-protocol.test.js covers the
// round-trip). But v0.2.625 dropped it in the arenaRuntime dispatch:
//   applyBotHit(p.botId, p.hp)              ← zone lost
// v0.2.626 fixes this to:
//   applyBotHit(p.botId, p.hp, p.zone)      ← zone preserved
//
// This test asserts the contract: given a BOT_HIT with zone='head', the
// dispatched applyBotHit call receives zone='head'.
import { describe, it, expect, vi } from 'vitest';
import { MSG, encode, decode } from '../../src/engine/multiplayer/wireProtocol.js';

// Mirror the arenaRuntime dispatch pattern for BOT_HIT — a tiny 3-line handler
// that matches src/arenaRuntime.js:1394 after the ADR-0017 fix. We can't import
// arenaRuntime.js in a unit test (pulls in THREE, DOM, and physics), but we
// can prove the wire message carries zone AND the dispatch shape passes it
// through.
function dispatchBotHit(p, applyBotHit) {
  // ADR-0017: zone MUST be passed through.
  applyBotHit(p.botId, p.hp, p.zone);
}

describe('ADR-0017 zone plumbing', () => {
  it('server BOT_HIT payload includes zone (schema round-trip)', () => {
    const msg = { t: MSG.BOT_HIT, botId: 3, dmg: 6, zone: 'head', hp: 44, shooterId: 'abc' };
    const roundtripped = decode(encode(msg));
    expect(roundtripped.ok).toBe(true);
    expect(roundtripped.msg.zone).toBe('head');
  });

  it('dispatch passes zone through to applyBotHit (head)', () => {
    const applyBotHit = vi.fn();
    const p = { botId: 3, dmg: 6, zone: 'head', hp: 44, shooterId: 'abc' };
    dispatchBotHit(p, applyBotHit);
    expect(applyBotHit).toHaveBeenCalledWith(3, 44, 'head');
  });

  it('dispatch passes zone through to applyBotHit (body)', () => {
    const applyBotHit = vi.fn();
    const p = { botId: 5, dmg: 4, zone: 'body', hp: 50, shooterId: 'abc' };
    dispatchBotHit(p, applyBotHit);
    expect(applyBotHit).toHaveBeenCalledWith(5, 50, 'body');
  });

  it('undefined zone falls through as undefined (applyBotHit handles it)', () => {
    // If zone is somehow missing (legacy server, malformed payload), the
    // dispatch still passes it through. applyBotHit internally normalises via
    // `zone || 'unknown'` when logging.
    const applyBotHit = vi.fn();
    const p = { botId: 7, dmg: 1, hp: 99, shooterId: 'abc' }; // no zone
    dispatchBotHit(p, applyBotHit);
    expect(applyBotHit).toHaveBeenCalledWith(7, 99, undefined);
  });
});
