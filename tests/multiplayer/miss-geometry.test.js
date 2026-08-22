// ADR-0023 — miss-geometry diagnostics for player→bot shots.
//
// `decision=miss` in [SHOT-RESOLVE] recorded THAT a shot missed but never HOW
// FAR, and hits never recorded their ZONE. So a missed headshot was
// indistinguishable from a body hit, and a 4cm graze (lag-comp / aim precision)
// was indistinguishable from a metre-wide shot (framing or occlusion) — which
// need completely different fixes. These tests pin the reported geometry.
//
// DESIGN INTENT covered below: the head sphere reaches foot+1.90 on a 1.70m
// model. The bots wear hats and the hat is INTENTIONALLY inside the headshot
// zone — they are small characters and their size would otherwise be an unfair
// advantage in a shooter. The "hat counts as a headshot" test guards that rule
// against a future well-meaning attempt to shrink the sphere to the mesh.
import { describe, it, expect, beforeEach } from 'vitest';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { sampleArenaHeight } from '../../src/terrain/heightmap.js';
import { BOT_HEAD_CENTRE_Y, BOT_HEAD_RADIUS, BOT_BODY_CENTRE_Y } from '../../server/bots/botColliders.js';

// Deterministic layout: bot 0 (regular) parked at a known spot, the boss shoved
// far away so `nearestBotDiag` always resolves to bot 0. Spawn positions are
// randomised, so tests must never rely on them.
const BX = 4;
const BZ = -6;
const NOW = 1_000_000;

function makeSim() {
  const sim = createArenaBotSim({});
  sim.spawn(2);                     // regularN=1 (id 0) + bossN=1 (id 1)
  const bot = sim.bots.find((b) => b.kind !== 'boss');
  const boss = sim.bots.find((b) => b.kind === 'boss');
  bot.pos.x = BX; bot.pos.z = BZ; bot.alive = true;
  if (boss) { boss.pos.x = 300; boss.pos.z = 300; }
  sim.recordSnapshot(NOW);
  return { sim, bot };
}

const footY = () => sampleArenaHeight(BX, BZ);
const headY = () => footY() + BOT_HEAD_CENTRE_Y;

// A horizontal shot from `dist` away along -X, at world height `y`, offset
// laterally by `lat` metres in Z.
function ray(y, lat = 0, dist = 3) {
  return { origin: [BX + dist, y, BZ + lat], dir: [-1, 0, 0] };
}

function diag(sim, r) {
  return sim.missGeomDiag(r.origin, r.dir, NOW, NOW, 300);
}

describe('ADR-0023 miss geometry diagnostics', () => {
  let sim, bot;
  beforeEach(() => { ({ sim, bot } = makeSim()); });

  it('reports the nearest bot and a NEGATIVE head gap for a dead-centre head shot', () => {
    const g = diag(sim, ray(headY()));
    expect(g).not.toBeNull();
    expect(g.botId).toBe(bot.id);
    expect(g.headGap).toBeLessThan(0);              // inside the sphere
    expect(Math.abs(g.headVert)).toBeLessThan(1e-6);
    expect(Math.abs(g.headHorz)).toBeLessThan(1e-6);
  });

  it('quantifies a shot that sails OVER the head as a positive vertical miss', () => {
    const over = 0.5;
    const g = diag(sim, ray(headY() + over));
    expect(g.headVert).toBeCloseTo(over, 5);        // signed: above centre
    expect(g.headHorz).toBeCloseTo(0, 5);
    expect(g.headGap).toBeCloseTo(over - BOT_HEAD_RADIUS, 5);
    expect(g.headGap).toBeGreaterThan(0);
  });

  it('quantifies a shot that passes BESIDE the head as a horizontal miss', () => {
    const lat = 0.6;
    const g = diag(sim, ray(headY(), lat));
    expect(g.headHorz).toBeCloseTo(lat, 5);
    expect(Math.abs(g.headVert)).toBeLessThan(1e-6);
    expect(g.headGap).toBeCloseTo(lat - BOT_HEAD_RADIUS, 5);
  });

  it('separates a near-graze from a wide miss by margin, not just hit/miss', () => {
    const graze = diag(sim, ray(headY() + BOT_HEAD_RADIUS + 0.04));
    const wide  = diag(sim, ray(headY() + BOT_HEAD_RADIUS + 1.00));
    expect(graze.headGap).toBeGreaterThan(0);
    expect(graze.headGap).toBeLessThan(0.10);
    expect(wide.headGap).toBeGreaterThan(0.90);
    // This is the whole point of the ADR: both were previously just "miss".
    expect(wide.headGap).toBeGreaterThan(graze.headGap);
  });

  it('reports a negative body gap for a chest shot', () => {
    const g = diag(sim, ray(footY() + BOT_BODY_CENTRE_Y));
    expect(g.bodyGap).toBeLessThan(0);
  });

  it('reports range to closest approach', () => {
    const g = diag(sim, ray(headY(), 0, 5));
    expect(g.rng).toBeCloseTo(5, 2);
  });

  it('returns null when origin or dir is missing', () => {
    expect(sim.missGeomDiag(null, [-1, 0, 0], NOW, NOW, 300)).toBeNull();
    expect(sim.missGeomDiag([0, 1, 0], null, NOW, NOW, 300)).toBeNull();
  });

  it('tolerates a non-unit direction vector', () => {
    const g = sim.missGeomDiag([BX + 3, headY(), BZ], [-10, 0, 0], NOW, NOW, 300);
    expect(g.headGap).toBeLessThan(0);
    expect(g.rng).toBeCloseTo(3, 2);
  });

  // ── Design intent: the hat is part of the headshot zone ──────────────────
  it('counts a HAT shot as a headshot (hat is deliberately in the head zone)', () => {
    // The banker GLB is ~1.70m tall including its top hat, so foot+1.62 is hat,
    // not skull. It must still resolve as 'head'.
    const hatY = footY() + 1.62;
    const g = diag(sim, ray(hatY));
    expect(g.headGap).toBeLessThan(0);

    const res = sim.resolvePlayerShot([BX + 3, hatY, BZ], [-1, 0, 0], NOW, NOW, 300);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(bot.id);
    expect(res.zone).toBe('head');
  });

  it('keeps the head zone generous ABOVE the mesh top on purpose', () => {
    // foot+1.80 is above the 1.70m model entirely. Intentional: these are small
    // characters, so the headshot zone is deliberately forgiving. Do NOT shrink.
    const g = diag(sim, ray(footY() + 1.80));
    expect(g.headGap).toBeLessThan(0);
  });

  it('exposes the zone on a resolved hit so headshots are greppable in logs', () => {
    const head = sim.resolvePlayerShot([BX + 3, headY(), BZ], [-1, 0, 0], NOW, NOW, 300);
    const body = sim.resolvePlayerShot(
      [BX + 3, footY() + BOT_BODY_CENTRE_Y, BZ], [-1, 0, 0], NOW, NOW, 300);
    expect(head.zone).toBe('head');
    expect(body.zone).toBe('body');
  });
});
