// tests/multiplayer/bot-wire-protocol.test.js — the four bot-milestone chunk-2
// wire messages (BOT_STATE/BOT_SHOT/BOT_HIT/BOT_KILL) round-trip through
// encode/decode, reject malformed payloads, and sanitize() strips unknown keys.
// All four are additive on PROTOCOL_VERSION=1 — unchanged from MP-1.
import { describe, it, expect } from 'vitest';
import { MSG, PROTOCOL_VERSION, encode, decode, sanitize } from '../../src/engine/multiplayer/wireProtocol.js';

const roundtrip = (msg) => decode(encode(msg));

describe('PROTOCOL_VERSION unchanged (additive messages)', () => {
  it('is still 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe('BOT_STATE', () => {
  const good = {
    t: MSG.BOT_STATE,
    bots: [
      { id: 0, x: 1.23, z: -4.56, rotY: 0.5, hp: 5, alive: true, animHint: 'walk' },
      { id: 1, x: 0, z: 0, rotY: -1.2, hp: 0, alive: false, animHint: 'die' },
    ],
  };

  it('round-trips a valid roster', () => {
    const r = roundtrip(good);
    expect(r.ok).toBe(true);
    expect(r.msg.bots).toHaveLength(2);
  });

  it('rejects a non-array bots field', () => {
    expect(decode({ t: MSG.BOT_STATE, bots: 'nope' }).ok).toBe(false);
  });

  it('rejects an unknown animHint', () => {
    const bad = { t: MSG.BOT_STATE, bots: [{ id: 0, x: 0, z: 0, rotY: 0, hp: 5, alive: true, animHint: 'boogie' }] };
    expect(decode(bad).ok).toBe(false);
  });

  it('rejects a non-integer id', () => {
    const bad = { t: MSG.BOT_STATE, bots: [{ id: 1.5, x: 0, z: 0, rotY: 0, hp: 5, alive: true, animHint: 'idle' }] };
    expect(decode(bad).ok).toBe(false);
  });

  it('rejects a non-boolean alive', () => {
    const bad = { t: MSG.BOT_STATE, bots: [{ id: 0, x: 0, z: 0, rotY: 0, hp: 5, alive: 1, animHint: 'idle' }] };
    expect(decode(bad).ok).toBe(false);
  });

  it('sanitize strips unknown top-level keys', () => {
    const dirty = { ...good, injected: 'evil' };
    expect(sanitize(dirty)).toEqual({ t: MSG.BOT_STATE, bots: good.bots });
  });
});

describe('BOT_SHOT', () => {
  const good = { t: MSG.BOT_SHOT, origin: [1, 2, 3], dir: [0, 0, 1], botId: 4 };

  it('round-trips a valid shot', () => {
    const r = roundtrip(good);
    expect(r.ok).toBe(true);
    expect(r.msg.origin).toEqual([1, 2, 3]);
  });

  it('accepts an omitted botId (optional)', () => {
    expect(decode({ t: MSG.BOT_SHOT, origin: [0, 0, 0], dir: [1, 0, 0] }).ok).toBe(true);
  });

  it('rejects a bad dir vector', () => {
    expect(decode({ t: MSG.BOT_SHOT, origin: [0, 0, 0], dir: [1, 2] }).ok).toBe(false);
  });

  it('sanitize keeps only origin/dir/botId', () => {
    expect(sanitize({ ...good, x: 9 })).toEqual({ t: MSG.BOT_SHOT, origin: [1, 2, 3], dir: [0, 0, 1], botId: 4 });
  });
});

describe('BOT_HIT', () => {
  const good = { t: MSG.BOT_HIT, botId: 2, dmg: 6, zone: 'body', hp: 3, shooterId: 'abc123' };

  it('round-trips a valid hit', () => {
    const r = roundtrip(good);
    expect(r.ok).toBe(true);
    expect(r.msg.zone).toBe('body');
  });

  it('rejects an out-of-set zone', () => {
    expect(decode({ ...good, zone: 'toe' }).ok).toBe(false);
  });

  it('rejects a non-positive dmg', () => {
    expect(decode({ ...good, dmg: 0 }).ok).toBe(false);
  });

  it('accepts an omitted shooterId', () => {
    const { shooterId, ...noShooter } = good;
    expect(decode(noShooter).ok).toBe(true);
  });
});

describe('BOT_KILL', () => {
  const good = { t: MSG.BOT_KILL, botId: 7, shooterId: 'deadbeef' };

  it('round-trips a valid kill', () => {
    const r = roundtrip(good);
    expect(r.ok).toBe(true);
    expect(r.msg.botId).toBe(7);
  });

  it('rejects a missing botId', () => {
    expect(decode({ t: MSG.BOT_KILL, shooterId: 'x' }).ok).toBe(false);
  });

  it('accepts an omitted shooterId (bot self-death)', () => {
    expect(decode({ t: MSG.BOT_KILL, botId: 3 }).ok).toBe(true);
  });
});
