// tests/gamezone/bot-awareness.test.js — ADR-0136: bots fight back.
// Behaviour only; the point system (damage per hit, HP, sats) is unchanged.
import { describe, it, expect } from 'vitest';
import { createGameZoneSim } from '../../src/gamezone/core/sim.js';
import {
  BOT_KINDS, PLAYER_EYE, REACT_S, ALERT_RADIUS, SETTLE_MS, TICK_DT, HEAD_DAMAGE, BODY_DAMAGE,
} from '../../src/gamezone/core/constants.js';
import { BOT_DAMAGE, BOSS_DAMAGE } from '../../src/config.js';
import { flatWorld } from './_flatWorld.js';

function sim(spots, opts = {}) {
  const world = flatWorld({ spawn: (k) => spots[k] || { x: 200 + k * 9, z: 200 }, ...(opts.world || {}) });
  const s = createGameZoneSim({ world, seed: opts.seed ?? 5, roster: { total: spots.length, bosses: 0 } });
  s.addPlayer('me', { pos: [0, PLAYER_EYE, 0] });
  s.players.get('me').protectMs = 0;
  return s;
}
function shoot(s, id) {
  const b = s.bots.get(id), p = s.players.get('me');
  const o = [p.x, p.y + PLAYER_EYE, p.z], t = [b.x - o[0], b.y + 1.0 - o[1], b.z - o[2]];
  const L = Math.hypot(...t);
  return s.fire('me', { seq: 1, origin: o, dir: t.map((v) => v / L), rt: s.tick, claim: { k: 'bot', id, zone: 'body', dist: L - b.spec.radius } });
}
function run(s, ticks, onEv) { for (let i = 0; i < ticks; i++) for (const e of s.step()) onEv && onEv(e, i); }

describe('bots fight back (ADR-0136)', () => {
  it('a bot shot from beyond its sight hunts the shooter and returns fire; neighbours join', () => {
    const far = BOT_KINDS.regular.sight + 10;
    const s = sim([{ x: far, z: 0 }, { x: far + 4, z: 3 }, { x: far + ALERT_RADIUS + 25, z: 0 }]);
    run(s, 10);
    expect(s.bots.get(0).target).toBe(null); // out of sight: unaware
    expect(shoot(s, 0).hit.dmg).toBe(BODY_DAMAGE);
    let returned = 0;
    run(s, 40, (e) => { if (e.type === 'shot' && e.sk === 'bot') returned++; });
    expect(s.bots.get(0).target).toBe('me');
    expect(s.bots.get(1).target).toBe('me');   // within the alert radius
    expect(s.bots.get(2).target).toBe(null);   // too far to hear it
    expect(returned).toBeGreaterThan(0);
  });

  it('gives a fair reaction beat before the first shot', () => {
    const s = sim([{ x: 8, z: 0 }]);
    s.bots.get(0).cd = 0;
    let first = -1;
    run(s, 40, (e, i) => { if (first < 0 && e.type === 'shot' && e.sk === 'bot') first = i; });
    expect(first).toBeGreaterThanOrEqual(Math.floor(REACT_S / TICK_DT) - 1);
  });

  it('fires short bursts with the normal cooldown between them; damage per hit unchanged', () => {
    const s = sim([{ x: 7, z: 0 }]);
    const shots = [], hits = [];
    run(s, 20 * 12, (e, i) => {
      if (e.type === 'shot' && e.sk === 'bot') shots.push(i);
      if (e.type === 'hit' && e.tk === 'player') hits.push(e.dmg);
    });
    expect(shots.length).toBeGreaterThanOrEqual(4);
    const gaps = shots.slice(1).map((t, i) => (t - shots[i]) * TICK_DT);
    const k = BOT_KINDS.regular;
    expect(gaps.some((g) => g <= k.burstGap + TICK_DT * 1.5)).toBe(true);     // inside a burst
    expect(gaps.some((g) => g >= k.shootCd * 0.8 - TICK_DT)).toBe(true);     // between bursts
    expect(new Set(hits)).toEqual(new Set(hits.length ? [BOT_DAMAGE] : []));
    expect([HEAD_DAMAGE, BODY_DAMAGE, BOT_DAMAGE, BOSS_DAMAGE]).toEqual([9, 3, 6, 14]); // frozen points
  });

  it('aim settles on a still target and resets when it moves', () => {
    const s = sim([{ x: 8, z: 0 }]);
    run(s, Math.ceil(SETTLE_MS / 50) + 10);
    expect(s.bots.get(0).settleMs).toBeGreaterThanOrEqual(SETTLE_MS);
    const p = s.players.get('me');
    for (let i = 0; i < 6; i++) { p.z += 0.25; run(s, 1); } // 5 m/s
    expect(s.bots.get(0).settleMs).toBe(0);
  });

  it('chases the last place it saw you when you break line of sight', () => {
    const s = sim([{ x: 9, z: 0 }], { world: { wallX: 4 } });
    const p = s.players.get('me');
    p.x = 6; p.px = 6; run(s, 10);               // same side of the wall: spotted
    expect(s.bots.get(0).target).toBe('me');
    p.x = 0; p.px = 0;                            // duck behind the wall
    const x0 = s.bots.get(0).x;
    run(s, 12);
    const b = s.bots.get(0);
    expect(b.target).toBe(null);
    expect(b.x).toBeLessThan(x0);                 // moving toward where it last saw you
  });

  it('forgets a dead or departed player', () => {
    const s = sim([{ x: 8, z: 0 }]);
    run(s, 10);
    expect(s.bots.get(0).target).toBe('me');
    s.removePlayer('me');
    const b = s.bots.get(0);
    expect([b.target, b.lastSeen, b.alertBy]).toEqual([null, null, null]);
  });
});
