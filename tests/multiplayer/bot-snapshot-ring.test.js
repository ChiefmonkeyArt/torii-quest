// tests/multiplayer/bot-snapshot-ring.test.js — the pure bot position history
// ring (server/bots/botSnapshotRing.js) used for lag-compensated player→bot
// shots (v0.2.385-alpha). Mirrors the peer snapshotRing's window/clamp semantics.
import { describe, it, expect } from 'vitest';
import {
  createBotSnapshotRing, pushBotSnap, newestBotSnap, oldestBotSnap, sampleBotsAt,
  BOT_RING_CAPACITY,
} from '../../server/bots/botSnapshotRing.js';

function frame(ts, bots) { return { ts, bots }; }
function bot(id, x, z, { footY = 0, radius = 0.4, alive = true } = {}) {
  return { id, x, z, footY, radius, alive };
}

describe('botSnapshotRing — push / newest / oldest', () => {
  it('empty ring samples null', () => {
    const r = createBotSnapshotRing();
    expect(sampleBotsAt(r, 100)).toBeNull();
    expect(newestBotSnap(r)).toBeNull();
    expect(oldestBotSnap(r)).toBeNull();
  });

  it('tracks newest/oldest and never grows past capacity', () => {
    const r = createBotSnapshotRing(4);
    for (let i = 0; i < 10; i++) pushBotSnap(r, frame(i * 100, [bot(1, i, 0)]));
    expect(r.size).toBe(4);
    expect(newestBotSnap(r).ts).toBe(900);
    expect(oldestBotSnap(r).ts).toBe(600); // oldest four kept: 600,700,800,900
    expect(BOT_RING_CAPACITY).toBe(30);
  });

  it('ignores malformed pushes', () => {
    const r = createBotSnapshotRing();
    pushBotSnap(r, null);
    pushBotSnap(r, { ts: 'x', bots: [] });
    pushBotSnap(r, { ts: 1 }); // no bots array
    expect(r.size).toBe(0);
  });
});

describe('botSnapshotRing — sampleBotsAt', () => {
  it('clamps to newest when t is at/after the newest frame', () => {
    const r = createBotSnapshotRing();
    pushBotSnap(r, frame(1000, [bot(1, 0, 0)]));
    pushBotSnap(r, frame(1100, [bot(1, 0, 5)]));
    const rows = sampleBotsAt(r, 999999);
    expect(rows).toHaveLength(1);
    expect(rows[0].z).toBe(5); // newest
  });

  it('clamps to oldest when t precedes the oldest frame (no NaN)', () => {
    const r = createBotSnapshotRing();
    pushBotSnap(r, frame(1000, [bot(1, 0, 0)]));
    pushBotSnap(r, frame(1100, [bot(1, 0, 5)]));
    const rows = sampleBotsAt(r, 0);
    expect(rows[0].z).toBe(0); // oldest
    expect(Number.isNaN(rows[0].z)).toBe(false);
  });

  it('linearly interpolates a bot position between two frames', () => {
    const r = createBotSnapshotRing();
    pushBotSnap(r, frame(1000, [bot(1, 0, 0, { footY: 2 })]));
    pushBotSnap(r, frame(1100, [bot(1, 0, 10, { footY: 4 })]));
    const rows = sampleBotsAt(r, 1050); // halfway
    expect(rows[0].z).toBeCloseTo(5, 6);
    expect(rows[0].footY).toBeCloseTo(3, 6);
  });

  it('returns an exact frame when t matches a stored ts', () => {
    const r = createBotSnapshotRing();
    pushBotSnap(r, frame(1000, [bot(1, 0, 0)]));
    pushBotSnap(r, frame(1050, [bot(1, 0, 3)]));
    pushBotSnap(r, frame(1100, [bot(1, 0, 9)]));
    const rows = sampleBotsAt(r, 1050);
    expect(rows[0].z).toBe(3);
  });

  it('carries radius + alive from the older bound; passes through a bot missing in the newer frame', () => {
    const r = createBotSnapshotRing();
    pushBotSnap(r, frame(1000, [bot(1, 0, 0, { radius: 0.8, alive: true }), bot(2, 5, 5)]));
    pushBotSnap(r, frame(1100, [bot(1, 0, 4, { radius: 0.8, alive: false })])); // bot 2 gone
    const rows = sampleBotsAt(r, 1050);
    const b1 = rows.find((b) => b.id === 1);
    const b2 = rows.find((b) => b.id === 2);
    expect(b1.z).toBeCloseTo(2, 6); // interpolated
    expect(b1.radius).toBe(0.8);    // from older bound
    expect(b1.alive).toBe(true);    // from older bound
    expect(b2).toBeTruthy();        // still present (existed at rewind instant)
    expect(b2.z).toBe(5);
  });
});
