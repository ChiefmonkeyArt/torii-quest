// tests/multiplayer/mp3-integration.test.js — MP-3 (v0.2.366-alpha)
// Server-side integration: ledger + SCORE frame + client-signed reporter,
// end-to-end but with signer/publisher injected. No websocket, no relay.
import { describe, it, expect, vi } from 'vitest';
import { createScoreLedger } from '../../server/combat/scoreLedger.js';
import { MSG, encode, decode } from '../../src/engine/multiplayer/wireProtocol.js';
import { createScoreReporter } from '../../src/engine/multiplayer/scoreReporter.js';
import { nostrEventId } from '../../src/engine/crypto/nostrSig.js';

const NPUB_A = 'a'.repeat(64);
const NPUB_B = 'b'.repeat(64);
const SESS   = '2'.repeat(16);

function memStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}
function fakeSigner(evt) {
  const id = nostrEventId(evt);
  return { ...evt, id, sig: 'sig-' + id };
}

describe('MP-3 integration — ledger → SCORE → sign+publish', () => {
  it('MOVE→SHOT→HIT→KILL populates ledger and yields a valid SCORE frame', async () => {
    // 1. Server-side accumulate
    const ledger = createScoreLedger();
    ledger.register('p1', NPUB_A);
    ledger.register('p2', NPUB_B);
    // p1 shoots p2 for 3 damage twice, then kills
    ledger.addDamage('p1', 3);
    ledger.addDamage('p1', 3);
    ledger.addKill('p1', 'p2');
    const tallies = ledger.snapshot();
    expect(tallies[0].id).toBe('p1');
    expect(tallies[0].kills).toBe(1);
    expect(tallies[0].damage).toBe(6);

    // 2. Wire encode/decode
    const frame = { t: MSG.SCORE, sessionId: SESS, endedAt: 999_999, tallies };
    const wire = encode(frame);
    const decoded = decode(wire);
    expect(decoded.ok).toBe(true);

    // 3. Client reporter (as if received by peer A)
    const publisher = vi.fn(async () => ({ published: 3, tried: 3 }));
    const signer    = vi.fn(async (evt) => fakeSigner(evt));
    const store = memStore();
    const reporter = createScoreReporter({
      signer, publisher, self: { selfPubkey: NPUB_A }, storage: store,
    });
    const r = await reporter.report(decoded.msg);
    expect(r.published).toBe(true);
    // signs addressable + history; publishes both
    expect(signer).toHaveBeenCalledTimes(2);
    expect(publisher).toHaveBeenCalledTimes(2);

    // 4. Peer A cannot re-publish the same frame (dedupe)
    const r2 = await reporter.report(decoded.msg);
    expect(r2.published).toBe(false);
    expect(r2.reason).toBe('dedupe');
  });

  it('peer with no ledger row gets no-self-row (not empty-row)', async () => {
    const ledger = createScoreLedger();
    ledger.register('p1', NPUB_A);
    ledger.addKill('p1', 'p1'); // no-op (self-kill guard)
    const tallies = ledger.snapshot();
    const frame = { t: MSG.SCORE, sessionId: SESS, endedAt: 111, tallies };
    const reporter = createScoreReporter({
      signer: vi.fn(),
      publisher: vi.fn(),
      self: { selfPubkey: 'c'.repeat(64) }, // not in tallies
      storage: memStore(),
    });
    const r = await reporter.report(frame);
    expect(r.published).toBe(false);
    expect(r.reason).toBe('no-self-row');
  });
});
