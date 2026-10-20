// tests/gamezone/bot-aim-agility.test.js — ADR-0138: human aim + agile bots.
// Behaviour only; damage per hit / HP / sats are unchanged.
import { describe, it, expect } from 'vitest';
import { createGameZoneSim } from '../../src/gamezone/core/sim.js';
import { BOT_KINDS, PLAYER_EYE, LEAD_MAX, NEAR_MISS_M } from '../../src/gamezone/core/constants.js';
import { nearMiss, WHIZ_M } from '../../src/gamezone/client/feel.js';
import { flatWorld } from './_flatWorld.js';

function sim(spots, seed = 9) {
  const world = flatWorld({ spawn: (k) => spots[k] || { x: 300 + k * 9, z: 300 } });
  const s = createGameZoneSim({ world, seed, roster: { total: spots.length, bosses: 0 } });
  s.addPlayer('me', { pos: [0, PLAYER_EYE, 0] });
  s.players.get('me').protectMs = 0;
  return s;
}
const seg = (a, b, p) => {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / L2));
  return Math.hypot(a[0] + d[0] * t - p[0], a[1] + d[1] * t - p[1], a[2] + d[2] * t - p[2]);
};

// Run N seeds of a player standing / running in front of one bot; collect shots.
function duel(move, { ticks = 20 * 40, seeds = 8 } = {}) {
  let shots = 0, hits = 0; const miss = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const s = sim([{ x: 0, z: 9 }], seed);
    const p = s.players.get('me');
    p.hp = 1e9; // keep the player alive so we sample many shots
    let dir = 1, flip = 0;
    for (let i = 0; i < ticks; i++) {
      if (move) { if (move === 'juke' && ++flip > 12) { flip = 0; dir = -dir; } p.x += dir * 4.5 / 20; if (Math.abs(p.x) > 6) dir = -dir; }
      const ev = s.step();
      const hitNow = ev.some((e) => e.type === 'hit' && e.tk === 'player');
      for (const e of ev) if (e.type === 'shot' && e.sk === 'bot') {
        shots++;
        if (hitNow) hits++; else miss.push(seg(e.from, e.to, [p.x, p.y + 1.25, p.z]));
      }
    }
  }
  return { shots, rate: hits / Math.max(1, shots), miss };
}

describe('human aim (ADR-0138)', () => {
  it('is never a laser: a still player is hit some of the time, not every time', () => {
    const r = duel(null);
    expect(r.shots).toBeGreaterThan(40);
    expect(r.rate).toBeGreaterThan(0.2);
    expect(r.rate).toBeLessThan(0.75);
  });

  it('misses are mostly close: the median miss passes within ~1 m', () => {
    const { miss } = duel(null);
    miss.sort((a, b) => a - b);
    expect(miss.length).toBeGreaterThan(10);
    expect(miss[Math.floor(miss.length / 2)]).toBeLessThan(1.0);
    expect(miss.filter((m) => m < 2).length / miss.length).toBeGreaterThan(0.75);
  });

  it('moving is harder to hit than standing still', () => {
    expect(duel('run').rate).toBeLessThan(duel(null).rate);
  });

  it('learns your lead while you run one way; a direction change resets it', () => {
    const s = sim([{ x: 0, z: 9 }]);
    const p = s.players.get('me'); p.hp = 1e9;
    for (let i = 0; i < 40; i++) { p.x += 4 / 20; s.step(); }
    const b = s.bots.get(0);
    expect(b.target).toBe('me');
    expect(b.lead).toBeGreaterThan(0.5);
    expect(b.lead).toBeLessThanOrEqual(LEAD_MAX);
    for (let i = 0; i < 3; i++) { p.x -= 4 / 20; s.step(); }
    expect(b.lead).toBeLessThan(0.2);
  });
});

describe('agile bots (ADR-0138)', () => {
  it('a round that just misses a bot can make it side-step at run speed', () => {
    let dodged = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = sim([{ x: 0, z: 10 }], seed);
      for (let i = 0; i < 10; i++) s.step();
      const b = s.bots.get(0);
      const o = [0, PLAYER_EYE, 0];
      const aimX = b.x + NEAR_MISS_M * 0.6; // passes beside it
      const d = [aimX - o[0], b.y + 1.0 - o[1], b.z - o[2]]; const L = Math.hypot(...d);
      s.fire('me', { seq: 1, origin: o, dir: d.map((v) => v / L), rt: s.tick, claim: null });
      const x0 = b.x;
      if (b.dodgeMs > 0) { dodged++; s.step(); s.step(); expect(Math.abs(b.x - x0)).toBeGreaterThan(BOT_KINDS.regular.speed * 0.1 * 0.9); }
    }
    expect(dodged).toBeGreaterThan(2);   // it happens…
    expect(dodged).toBeLessThan(12);     // …but not every time
  });

  it('jukes at irregular intervals and varied pace', () => {
    const s = sim([{ x: 0, z: 8 }]);
    const p = s.players.get('me'); p.hp = 1e9;
    const flips = []; let last = s.bots.get(0).strafe, at = 0;
    const speeds = new Set();
    for (let i = 0; i < 20 * 30; i++) {
      s.step();
      const b = s.bots.get(0);
      speeds.add(Math.round(b.jukeSpd * 10));
      if (b.strafe !== last) { flips.push(i - at); at = i; last = b.strafe; }
    }
    expect(flips.length).toBeGreaterThan(8);
    expect(new Set(flips).size).toBeGreaterThan(4);
    expect(speeds.size).toBeGreaterThan(3);
  });

  it('a wounded bot backs off while still fighting', () => {
    const s = sim([{ x: 0, z: 9 }]);
    for (let i = 0; i < 10; i++) s.step();
    const b = s.bots.get(0);
    b.hp = 1; b.dodgeCd = 1e9; // wounded, no dodges in the way
    const d0 = Math.hypot(b.x, b.z);
    for (let i = 0; i < 30; i++) s.step();
    expect(Math.hypot(b.x, b.z)).toBeGreaterThan(d0 + 0.5);
  });
});

describe('near-miss whizz (ADR-0138)', () => {
  it('whizzes for a close pass, not for a hit or a wide miss', () => {
    const eye = [0, 1.7, 0];
    expect(nearMiss([10, 1.7, 0.8], [-20, 1.7, 0.8], ...eye, 0)).not.toBe(null);
    expect(nearMiss([10, 1.7, WHIZ_M + 0.2], [-20, 1.7, WHIZ_M + 0.2], ...eye, 0)).toBe(null);
    expect(nearMiss([10, 1.4, 0], [0.3, 1.3, 0], ...eye, 0)).toBe(null); // ended on you: a hit
    const r = nearMiss([10, 1.7, 0.3], [-20, 1.7, 0.3], ...eye, 0);
    expect(r.level).toBeGreaterThan(nearMiss([10, 1.7, 1.2], [-20, 1.7, 1.2], ...eye, 0).level);
    // pan follows the side it passed (yaw 0 faces −z; +x is to the right)
    expect(nearMiss([0.8, 1.7, 10], [0.8, 1.7, -20], ...eye, 0).pan).toBeGreaterThan(0);
    expect(nearMiss([-0.8, 1.7, 10], [-0.8, 1.7, -20], ...eye, 0).pan).toBeLessThan(0);
  });
});

describe('whizz wiring (ADR-0138)', () => {
  it('the arena passes the cue in; the audio shares one noise buffer', async () => {
    const fs = await import('node:fs');
    const R = fs.readFileSync(new URL('../../src/arenaRuntime.js', import.meta.url), 'utf8');
    const A = fs.readFileSync(new URL('../../src/audio.js', import.meta.url), 'utf8');
    const G = fs.readFileSync(new URL('../../src/gamezone/client/gameZone.js', import.meta.url), 'utf8');
    expect(R).toMatch(/state, emit, EV, playBotShoot, playNearMiss,/);
    expect(A).toMatch(/export function playNearMiss\(level = 1, pan = 0\) \{\n  if \(isClientSuspended\(\)\) return;/);
    expect((A.match(/_whizNoise = ctx\.createBuffer/g) || []).length).toBe(1);
    expect(G).toMatch(/nearMiss\(e\.from, e\.to, _o\.x, _o\.y, _o\.z, d\.playerObj\.rotation\.y, _whiz\)/);
    expect(G).toMatch(/now\(\) - lastWhiz >= WHIZ_GAP_MS/); // throttled
  });
});
