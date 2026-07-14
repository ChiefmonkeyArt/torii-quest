// tests/multiplayer/live-score-broadcast.test.js — v0.2.380-alpha
// The server now broadcasts the SCORE frame DURING play (on every kill + a ~5s
// tick), not only on session close. arena-ws.js has import-time side effects
// (it binds the HTTP/WS server + intervals), so this asserts (1) the wiring is
// present in source and (2) a MID-MATCH ledger snapshot yields a valid, non-empty
// SCORE frame that round-trips the wire — the exact content those live broadcasts
// carry. Uses the real ledger + wire codec; no socket, no server boot.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScoreLedger } from '../../server/combat/scoreLedger.js';
import { MSG, encode, decode } from '../../src/engine/multiplayer/wireProtocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(resolve(HERE, '../../server/arena-ws.js'), 'utf8');

const NPUB_A = 'a'.repeat(64);
const NPUB_B = 'b'.repeat(64);

describe('server live SCORE broadcast — wiring', () => {
  it('broadcasts on every kill (call sits right after addKill)', () => {
    // addKill on a player kill is immediately followed by a live broadcast.
    expect(SERVER_SRC).toMatch(/addKill\(shooter\.id, result\.targetId\);[\s\S]*?broadcastScoreFrame\(\);/);
  });
  it('broadcasts periodically on a SCORE_TICK interval, gated on SCORE_ENABLED', () => {
    expect(SERVER_SRC).toMatch(/const SCORE_TICK_MS = Number\(process\.env\.SCORE_TICK_MS/);
    expect(SERVER_SRC).toMatch(/if \(SCORE_ENABLED\) \{\s*setInterval\(\(\) => \{ broadcastScoreFrame\(\); \}, SCORE_TICK_MS\);/);
  });
  it('keeps the on-close SCORE emit path (broadcastScoreFrame still called from close)', () => {
    // Two+ call sites: kill, periodic tick, and the pre-existing close path.
    const calls = SERVER_SRC.match(/broadcastScoreFrame\(\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
  it('does not bump the protocol version (SCORE frame is additive)', () => {
    expect(SERVER_SRC).not.toMatch(/PROTOCOL_VERSION\s*=\s*2/);
  });
});

describe('server live SCORE broadcast — mid-match frame content', () => {
  it('yields a valid, non-empty SCORE frame before any session close', () => {
    const ledger = createScoreLedger();
    ledger.register('p1', NPUB_A);
    ledger.register('p2', NPUB_B);
    ledger.addDamage('p1', 12);
    ledger.addKill('p1', 'p2'); // a live kill — this is when the server broadcasts
    const tallies = ledger.snapshot();
    expect(tallies.length).toBeGreaterThan(0);

    const frame = { t: MSG.SCORE, sessionId: '3'.repeat(16), endedAt: Date.now(), tallies };
    const decoded = decode(encode(frame));
    expect(decoded.ok).toBe(true);
    expect(decoded.msg.t).toBe(MSG.SCORE);
    expect(decoded.msg.tallies[0].npub).toBe(NPUB_A);
    expect(decoded.msg.tallies[0].kills).toBe(1);
  });

  it('empty ledger produces no tallies (broadcastScoreFrame early-returns)', () => {
    const ledger = createScoreLedger();
    expect(ledger.snapshot()).toHaveLength(0);
  });
});
