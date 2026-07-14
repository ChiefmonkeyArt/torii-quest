// tests/multiplayer/bot-net-state.test.js — the PURE client-side interpolation
// buffer for server-authoritative bots (src/engine/entities/botNetState.js). In
// MP the client is render-only: it buffers BOT_STATE snapshots and lerps a pose
// rendered slightly in the past, SNAPPING on discontinuities (spawn, alive flip,
// teleport). Also covers animHintToFlags and shouldApplyLocalBotDamage.
import { describe, it, expect } from 'vitest';
import {
  createBotNetState,
  animHintToFlags,
  shouldApplyLocalBotDamage,
} from '../../src/engine/entities/botNetState.js';

const row = (id, x, z, rotY, extra = {}) => ({
  id, x, z, rotY, hp: 5, alive: true, animHint: 'walk', ...extra,
});

describe('ingest + sample', () => {
  it('SNAPs to the newest sample on the very first ingest (spawn)', () => {
    const net = createBotNetState();
    net.ingest([row(1, 4, 5, 1.2)], 1000);
    const [b] = net.sample(1000);
    expect(b.id).toBe(1);
    expect(b.snap).toBe(true);
    expect(b.x).toBe(4);
    expect(b.z).toBe(5);
    expect(b.rotY).toBe(1.2);
  });

  it('consumes the snap flag: the next read is no longer a snap', () => {
    const net = createBotNetState();
    net.ingest([row(1, 0, 0, 0)], 1000);
    expect(net.sample(1000)[0].snap).toBe(true);
    net.ingest([row(1, 1, 0, 0)], 1050);
    expect(net.sample(1100)[0].snap).toBe(false);
  });

  it('interpolates position between two samples at the delayed render time', () => {
    const net = createBotNetState({ interpDelayMs: 100, snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0)], 1000);
    net.sample(1000); // consume the spawn snap
    net.ingest([row(1, 10, 0, 0)], 1100);
    // renderT = 1150 - 100 = 1050 → halfway between the two samples.
    const [b] = net.sample(1150);
    expect(b.snap).toBe(false);
    expect(b.x).toBeCloseTo(5, 6);
  });

  it('SNAPs when alive flips true→false (kill: a corpse must not slide)', () => {
    const net = createBotNetState({ snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0)], 1000);
    net.sample(1000);
    net.ingest([row(1, 2, 0, 0, { alive: false })], 1050);
    const [b] = net.sample(1100);
    expect(b.alive).toBe(false);
    expect(b.snap).toBe(true);
    expect(b.x).toBe(2); // hard jump to newest, no lerp
  });

  it('SNAPs when a position jump exceeds snapDist (teleport / respawn)', () => {
    const net = createBotNetState({ snapDist: 3 });
    net.ingest([row(1, 0, 0, 0)], 1000);
    net.sample(1000);
    net.ingest([row(1, 50, 0, 0)], 1050); // 50m >> 3m
    const [b] = net.sample(1100);
    expect(b.snap).toBe(true);
    expect(b.x).toBe(50);
  });

  it('lerps rotY the short way around the circle', () => {
    const net = createBotNetState({ interpDelayMs: 100, snapDist: 1000 });
    // From +3.0 rad to -3.0 rad: short arc crosses ±π, not through 0.
    net.ingest([row(1, 0, 0, 3.0)], 1000);
    net.sample(1000);
    net.ingest([row(1, 0, 0, -3.0)], 1100);
    const [b] = net.sample(1150); // halfway
    // Midpoint of the short arc is just past ±π (~±3.14), not near 0.
    expect(Math.abs(b.rotY)).toBeGreaterThan(3.0);
  });

  it('ignores non-array ingests without throwing', () => {
    const net = createBotNetState();
    expect(() => net.ingest(null, 1000)).not.toThrow();
    expect(() => net.ingest(undefined, 1000)).not.toThrow();
    expect(net.sample(1000)).toHaveLength(0);
  });
});

describe('roster bookkeeping', () => {
  it('has/remove/clear manage the tracked bot set', () => {
    const net = createBotNetState();
    net.ingest([row(1, 0, 0, 0), row(2, 1, 1, 0)], 1000);
    expect(net.has(1)).toBe(true);
    expect(net.has(2)).toBe(true);
    net.remove(1);
    expect(net.has(1)).toBe(false);
    net.clear();
    expect(net.has(2)).toBe(false);
    expect(net.sample(1000)).toHaveLength(0);
  });

  it('forceSnap marks a bot to hard-jump on the next read', () => {
    const net = createBotNetState({ snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0)], 1000);
    net.sample(1000);           // consume spawn snap
    net.ingest([row(1, 1, 0, 0)], 1050);
    net.forceSnap(1);
    expect(net.sample(1100)[0].snap).toBe(true);
  });
});

// v0.2.383 combat fix — the event-vs-snapshot staleness race. BOT_HIT/BOT_KILL
// arrive out of band between ~15Hz BOT_STATE snapshots; hp/alive are the latest
// snapshot values (NOT interpolated), so an event applied before the next
// snapshot must NOT be reverted by re-reading the stale snapshot.
describe('applyHit / applyKill — out-of-band event authority (v0.2.383)', () => {
  it('applyHit drops the sampled hp immediately, before any new snapshot', () => {
    const net = createBotNetState({ snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0, { hp: 5 })], 1000);
    net.sample(1000); // consume spawn snap; latest snapshot hp = 5
    // A player shot lands: server BOT_HIT says hp is now 2.
    net.applyHit(1, 2);
    // The very next sample (no new BOT_STATE yet) reflects the event, not hp=5.
    expect(net.sample(1016)[0].hp).toBe(2);
  });

  it('the hit hp is NOT clobbered when the pre-hit snapshot is re-sampled', () => {
    const net = createBotNetState({ interpDelayMs: 100, snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0, { hp: 5 })], 1000);
    net.sample(1000);
    net.applyHit(1, 3);
    // Several render frames pass at ~60Hz while the ~67ms snapshot is still stale.
    expect(net.sample(1016)[0].hp).toBe(3);
    expect(net.sample(1033)[0].hp).toBe(3);
    expect(net.sample(1050)[0].hp).toBe(3);
  });

  it('a later snapshot carrying the reduced hp keeps it (no revert)', () => {
    const net = createBotNetState({ snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0, { hp: 5 })], 1000);
    net.sample(1000);
    net.applyHit(1, 2);
    // Next authoritative BOT_STATE reflects the server hp (2), not the old 5.
    net.ingest([row(1, 1, 0, 0, { hp: 2 })], 1067);
    expect(net.sample(1100)[0].hp).toBe(2);
  });

  it('applyKill marks the bot dead + snaps immediately, before any new snapshot', () => {
    const net = createBotNetState({ snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0, { alive: true })], 1000);
    net.sample(1000); // latest snapshot still says alive=true
    net.applyKill(1);
    const [b] = net.sample(1016);
    expect(b.alive).toBe(false);
    expect(b.snap).toBe(true); // corpse hard-jumps, no slide
  });

  it('a killed bot STAYS dead across frames even while the stale snapshot says alive', () => {
    const net = createBotNetState({ snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0, { alive: true })], 1000);
    net.sample(1000);
    net.applyKill(1);
    // The last snapshot before the kill said alive=true; re-sampling must NOT
    // un-kill the bot.
    expect(net.sample(1016)[0].alive).toBe(false);
    expect(net.sample(1033)[0].alive).toBe(false);
    expect(net.sample(1050)[0].alive).toBe(false);
  });

  it('a genuine respawn snapshot (alive false→true after the timer) still reappears', () => {
    const net = createBotNetState({ snapDist: 1000 });
    net.ingest([row(1, 0, 0, 0, { alive: true })], 1000);
    net.sample(1000);
    net.applyKill(1);
    expect(net.sample(1016)[0].alive).toBe(false);
    // Server BOT_STATE reflects the kill (alive=false) for the 8s timer...
    net.ingest([row(1, 0, 0, 0, { alive: false })], 2000);
    expect(net.sample(2000)[0].alive).toBe(false);
    // ...then the respawn: alive false→true must snap the bot back into view.
    net.ingest([row(1, 12, 3, 0, { alive: true, hp: 5 })], 9000);
    const [b] = net.sample(9000);
    expect(b.alive).toBe(true);
    expect(b.snap).toBe(true);
    expect(b.hp).toBe(5);
  });

  it('applyHit / applyKill on an unknown bot id are no-ops (no throw)', () => {
    const net = createBotNetState();
    expect(() => net.applyHit(99, 1)).not.toThrow();
    expect(() => net.applyKill(99)).not.toThrow();
    expect(net.sample(1000)).toHaveLength(0);
  });
});

describe('animHintToFlags', () => {
  it('maps each hint to the right BotModel flags', () => {
    expect(animHintToFlags('shoot')).toEqual({ isShooting: true, isDeath: false, isHit: false });
    expect(animHintToFlags('die')).toEqual({ isShooting: false, isDeath: true, isHit: false });
    expect(animHintToFlags('hit')).toEqual({ isShooting: false, isDeath: false, isHit: true });
    expect(animHintToFlags('walk')).toEqual({ isShooting: false, isDeath: false, isHit: false });
  });
});

describe('shouldApplyLocalBotDamage', () => {
  it('is false in net mode (server authoritative) and true single-player', () => {
    expect(shouldApplyLocalBotDamage(true)).toBe(false);
    expect(shouldApplyLocalBotDamage(false)).toBe(true);
  });
});
