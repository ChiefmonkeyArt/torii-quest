// tests/gamezone/server.test.js — the VPS host for the shared sim (ADR-0130).
// Drives server/gamezone/gameZoneServer.js with fake sessions: routing, respawn,
// spectators and the (unchanged) score ledger hooks.
import { describe, it, expect } from 'vitest';
import { createGameZoneServer, rosterFromEnv } from '../../server/gamezone/gameZoneServer.js';
import { createScoreLedger } from '../../server/combat/scoreLedger.js';
import { MSG, encode, decode } from '../../src/engine/multiplayer/wireProtocol.js';
import { BOT_KINDS, PLAYER_EYE, PLAYER_HP } from '../../src/gamezone/core/constants.js';
import { flatWorld } from './_flatWorld.js';

const HEX = (c) => c.repeat(64);

function harness({ roster = { total: 2, bosses: 0 }, score = false, spectators = 0, world } = {}) {
  const sessions = new Map();
  const inbox = new Map(); // id → decoded messages
  const spect = [];
  const others = [];
  const ledger = createScoreLedger();
  let broadcasts = 0;
  const push = (id, m) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(m); };
  const gz = createGameZoneServer({
    sessions,
    isKamiActive: (s) => !!s.kami,
    sendTo: (s, m) => push(s.id, JSON.parse(encode(m))),
    broadcastToOthers: (from, m) => others.push({ from, m }),
    sendToSpectators: (w) => spect.push(JSON.parse(w)),
    spectatorCount: () => spectators,
    encode,
    roster,
    world: world || flatWorld(),
    seed: 5,
    score: { enabled: score, ledger, broadcast: () => { broadcasts++; } },
  });
  function join(id, pos = [0, PLAYER_EYE, 0], extra = {}) {
    const s = { id, authed: true, pos, rot: [0, 0], ws: { send: (w) => push(id, JSON.parse(w)) }, ...extra };
    sessions.set(id, s);
    if (score) ledger.register(id, HEX(id[id.length - 1]));
    gz.onAuth(s);
    return s;
  }
  const got = (id, t) => (inbox.get(id) || []).filter((m) => m.t === t);
  const events = (id) => got(id, MSG.GZ_EVENT).flatMap((m) => m.ev);
  return { gz, sessions, join, got, events, spect, others, ledger, get broadcasts() { return broadcasts; } };
}

function headshot(gz, s, botId) {
  const b = gz.sim.bots.get(botId);
  const o = s.pos;
  const d = [b.x - o[0], b.y + 1.6 - o[1], b.z - o[2]];
  const L = Math.hypot(...d);
  return { seq: 1, origin: o, dir: d.map((v) => v / L), rt: gz.sim.tick, claim: { k: 'bot', id: botId, zone: 'head', dist: L - BOT_KINDS.regular.radius } };
}

describe('gameZoneServer — snapshots', () => {
  it('a new session gets the full roster at once, then every tick; every frame decodes', () => {
    const h = harness();
    h.join('a');
    expect(h.got('a', MSG.GZ_SNAP)).toHaveLength(1);
    for (let i = 0; i < 5; i++) h.gz.tick();
    const snaps = h.got('a', MSG.GZ_SNAP);
    expect(snaps).toHaveLength(6);
    for (const s of snaps) expect(decode({ t: MSG.GZ_SNAP, ...s }).ok).toBe(true);
    expect(snaps.at(-1).b).toHaveLength(2);
  });
  it('no seated players → no snapshot broadcast', () => {
    const h = harness();
    const s = h.join('a');
    s.authed = false;
    const before = (h.got('a', MSG.GZ_SNAP)).length;
    h.gz.tick();
    expect(h.got('a', MSG.GZ_SNAP)).toHaveLength(before);
  });
  it('spectators receive legacy BOT_STATE every third tick', () => {
    const h = harness({ spectators: 1 });
    h.join('a');
    for (let i = 0; i < 9; i++) h.gz.tick();
    expect(h.spect).toHaveLength(3);
    expect(h.spect[0].t).toBe(MSG.BOT_STATE);
    expect(h.spect[0].bots[0]).toHaveProperty('alive');
  });
});

describe('gameZoneServer — shots', () => {
  it('the result goes ONLY to the shooter; hit/kill/shot go to everyone', () => {
    const h = harness();
    const a = h.join('a');
    h.join('b', [0, PLAYER_EYE, 30]);
    h.gz.onFire(a, headshot(h.gz, a, 0));
    expect(h.events('a').filter((e) => e.type === 'result')).toHaveLength(1);
    expect(h.events('b').filter((e) => e.type === 'result')).toHaveLength(0);
    for (const id of ['a', 'b']) {
      const types = h.events(id).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['shot', 'hit', 'kill']));
    }
    expect(h.gz.sim.bots.get(0).st).toBe(1);
  });
  it('score hooks: bot kills feed the existing ledger and trigger a SCORE broadcast', () => {
    const h = harness({ score: true });
    const a = h.join('a');
    h.gz.onFire(a, headshot(h.gz, a, 0));
    const row = h.ledger.snapshot(8).find((r) => r.id === 'a' || r.npub === HEX('a'));
    expect(row).toBeTruthy();
    expect(row.kills).toBe(1);
    expect(row.damage).toBe(9);
    expect(h.broadcasts).toBe(1);
  });
  it('score disabled → ledger untouched', () => {
    const h = harness({ score: false });
    const a = h.join('a');
    h.gz.onFire(a, headshot(h.gz, a, 0));
    expect(h.ledger.snapshot(8)).toHaveLength(0);
    expect(h.broadcasts).toBe(0);
  });
});

describe('gameZoneServer — lifecycle', () => {
  it('a killed player gets RESPAWN (full hp); everyone else gets their MOVE', () => {
    const h = harness({ roster: { total: 0, bosses: 0 } });
    const a = h.join('a');
    h.join('b', [10, PLAYER_EYE, 0]);
    for (let i = 0; i < 40; i++) h.gz.tick(); // past spawn protection
    h.gz.sim.players.get('b').hp = 5;
    h.gz.onFire(a, { seq: 9, origin: a.pos, dir: [1, 0, 0], rt: h.gz.sim.tick });
    expect(h.events('a').some((e) => e.type === 'kill' && e.tid === 'b')).toBe(true);
    for (let i = 0; i < 120; i++) h.gz.tick();
    const rs = h.got('b', MSG.RESPAWN);
    expect(rs).toHaveLength(1);
    expect(rs[0].hp).toBe(PLAYER_HP);
    expect(h.others.some((o) => o.from === 'b' && o.m.t === MSG.MOVE)).toBe(true);
    expect(h.got('a', MSG.RESPAWN)).toHaveLength(0);
  });
  it('onMove tracks the session; onLeave removes the player; onKami toggles targetability', () => {
    const h = harness();
    const a = h.join('a');
    a.pos = [3, PLAYER_EYE, 4]; a.rot = [1.2, 0];
    h.gz.onMove(a);
    expect(h.gz.sim.players.get('a')).toMatchObject({ x: 3, z: 4, yaw: 1.2 });
    a.kami = true; h.gz.onKami(a);
    expect(h.gz.sim.players.get('a').targetable).toBe(false);
    h.gz.onLeave(a);
    expect(h.gz.sim.players.has('a')).toBe(false);
  });
  it('a Kami session that authenticates starts untargetable', () => {
    const h = harness();
    h.join('k', [0, PLAYER_EYE, 0], { kami: true });
    expect(h.gz.sim.players.get('k').targetable).toBe(false);
  });
  it('start/stop drive a wall-clock pump without throwing', async () => {
    const h = harness();
    h.join('a');
    h.gz.start(); h.gz.start();
    await new Promise((r) => setTimeout(r, 140));
    h.gz.stop(); h.gz.stop();
    expect(h.gz.sim.tick).toBeGreaterThanOrEqual(1);
  });
  it('rosterFromEnv is exported for arena-ws boot', () => {
    expect(rosterFromEnv({ BOT_COUNT_OVERRIDE: '2' }).total).toBe(2);
  });
});
