// tests/multiplayer/bot-state-gate.test.js — ADR-0050 v0.2.672.
//
// Locks the server's BOT_STATE broadcast decision (server/bots/botStateGate.js).
// The bug: the gate was `players.length > 0`, where `players` EXCLUDES Kami Mode
// sessions (ADR-0032 "bots ignore the admin"). A sole player in Kami Mode dropped
// `players.length` to 0, silencing BOT_STATE for the whole Kami Mode session and
// freezing every bot on the client — the ~12m desync behind "bots won't die".
import { describe, it, expect } from 'vitest';
import { buildBotTickRoster, shouldBroadcastBotState } from '../../server/bots/botStateGate.js';

const sess = (overrides = {}) => ({
  id: 's1',
  authed: true,
  pos: [1, 2, 3],
  kamiActive: false,
  ...overrides,
});

const deps = {
  isKamiActive: (s) => !!s.kamiActive,
  pointInCoastline: (x, z) => x >= 0 && z >= 0, // simple fence: inside when both >= 0
};

function mapOf(...items) {
  const m = new Map();
  for (const s of items) m.set(s.id, s);
  return m;
}

describe('buildBotTickRoster — authedCount vs players (ADR-0050)', () => {
  it('counts a Kami Mode session in authedCount but EXCLUDES it from the bot-brain roster', () => {
    const sessions = mapOf(sess({ id: 'admin', kamiActive: true }));
    const { players, authedCount } = buildBotTickRoster(sessions, deps);

    expect(authedCount).toBe(1);           // still counted → BOT_STATE keeps flowing
    expect(players.length).toBe(0);        // excluded from the roster → bots ignore admin
  });

  it('includes a normal authed session in both authedCount and the roster', () => {
    const sessions = mapOf(sess({ id: 'p1' }));
    const { players, authedCount } = buildBotTickRoster(sessions, deps);

    expect(authedCount).toBe(1);
    expect(players.length).toBe(1);
    expect(players[0].id).toBe('p1');
  });

  it('excludes an unauthed session from both', () => {
    const sessions = mapOf(sess({ id: 'ghost', authed: false }));
    const { players, authedCount } = buildBotTickRoster(sessions, deps);

    expect(authedCount).toBe(0);
    expect(players.length).toBe(0);
  });

  it('mixes Kami + normal + unauthed correctly', () => {
    const sessions = mapOf(
      sess({ id: 'admin', kamiActive: true }),
      sess({ id: 'p1' }),
      sess({ id: 'ghost', authed: false }),
    );
    const { players, authedCount } = buildBotTickRoster(sessions, deps);

    expect(authedCount).toBe(2);           // admin + p1 (ghost excluded)
    expect(players.map((p) => p.id).sort()).toEqual(['p1']); // only p1 in the roster
  });

  it('marks outsideFence from pointInCoastline', () => {
    const sessions = mapOf(
      sess({ id: 'in', pos: [1, 2, 3] }),       // x>=0,z>=0 → inside
      sess({ id: 'out', pos: [-1, 2, -3] }),     // outside
    );
    const { players } = buildBotTickRoster(sessions, deps);
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    expect(byId.in.outsideFence).toBe(false);
    expect(byId.out.outsideFence).toBe(true);
  });
});

describe('shouldBroadcastBotState — the gate (ADR-0050)', () => {
  it('broadcasts when a Kami-Mode-only player is present (the fix)', () => {
    // authedCount=1 (Kami Mode), players=0 → the OLD gate (players.length>0) would
    // return false and silence BOT_STATE. The new gate must return true.
    expect(shouldBroadcastBotState({ authedCount: 1, now: 100, lastAt: 0, botStateMs: 66 })).toBe(true);
  });

  it('does not broadcast when there are no authed sessions', () => {
    expect(shouldBroadcastBotState({ authedCount: 0, now: 100, lastAt: 0, botStateMs: 66 })).toBe(false);
  });

  it('does not broadcast inside the throttle window', () => {
    expect(shouldBroadcastBotState({ authedCount: 1, now: 100, lastAt: 90, botStateMs: 66 })).toBe(false);
  });

  it('broadcasts once the throttle window has elapsed', () => {
    expect(shouldBroadcastBotState({ authedCount: 1, now: 156, lastAt: 90, botStateMs: 66 })).toBe(true);
  });

  it('broadcasts on the first tick once the throttle window has elapsed since epoch (lastAt=0)', () => {
    // lastAt=0 means "never broadcast yet", so the gate is now >= botStateMs.
    expect(shouldBroadcastBotState({ authedCount: 1, now: 50, lastAt: 0, botStateMs: 66 })).toBe(false);
    expect(shouldBroadcastBotState({ authedCount: 1, now: 100, lastAt: 0, botStateMs: 66 })).toBe(true);
  });
});
