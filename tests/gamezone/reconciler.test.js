// tests/gamezone/reconciler.test.js — the no-ghost rule + client time base (ADR-0130).
//
// "There should never be ghosts": after every reconcile the set of bot views
// equals the authority's roster exactly. This is checked against thousands of
// random roster sequences, including kind reshuffles and throwing disposers.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { reconcileViews, clearViews } from '../../src/gamezone/client/reconciler.js';
import { createTickClock } from '../../src/gamezone/client/tickClock.js';
import { createLocalAuthority, createNetAuthority, LOCAL_ID } from '../../src/gamezone/client/authority.js';
import { createGzFx, TRACER_BOT } from '../../src/gamezone/client/fx.js';
import { createRng } from '../../src/gamezone/core/geom.js';
import { TICK_MS, INTERP_DELAY_TICKS, PLAYER_EYE } from '../../src/gamezone/core/constants.js';
import { flatWorld } from './_flatWorld.js';

describe('reconcileViews — never a ghost', () => {
  it('views == roster after every reconcile (randomised, 5 000 rounds)', () => {
    const rng = createRng(99);
    const views = new Map();
    const live = new Set();
    let made = 0;
    const create = (r) => { const v = { id: r.id, kind: r.kind, n: made++ }; live.add(v); return v; };
    const dispose = (v) => { live.delete(v); if (rng() < 0.05) throw new Error('dispose blew up'); };
    for (let round = 0; round < 5000; round++) {
      const roster = [];
      for (let id = 0; id < 12; id++) if (rng() < 0.6) roster.push({ id, kind: rng() < 0.15 ? 'boss' : 'regular' });
      // A throwing disposer must neither escape nor leave a ghost behind.
      expect(() => reconcileViews(views, roster, create, dispose)).not.toThrow();
      expect([...views.keys()].sort((a, b) => a - b)).toEqual(roster.map((r) => r.id));
      for (const r of roster) expect(views.get(r.id).kind).toBe(r.kind);
      // Every live view object is in the map — nothing leaked outside it.
      expect(live.size).toBe(views.size);
    }
  });
  it('reports created/disposed counts and keeps stable views', () => {
    const views = new Map();
    const c = (r) => ({ ...r });
    expect(reconcileViews(views, [{ id: 1, kind: 'regular' }, { id: 2, kind: 'boss' }], c, () => {})).toEqual({ created: 2, disposed: 0 });
    const keep = views.get(1);
    expect(reconcileViews(views, [{ id: 1, kind: 'regular' }], c, () => {})).toEqual({ created: 0, disposed: 1 });
    expect(views.get(1)).toBe(keep);
    expect(reconcileViews(views, [{ id: 1, kind: 'boss' }], c, () => {})).toEqual({ created: 1, disposed: 1 });
  });
  it('clearViews disposes everything even when a disposer throws', () => {
    const views = new Map([[1, {}], [2, {}], [3, {}]]);
    let n = 0;
    clearViews(views, () => { n++; if (n === 2) throw new Error('x'); });
    expect(n).toBe(3);
    expect(views.size).toBe(0);
  });
});

describe('tickClock', () => {
  it('locks to the least-delayed arrival and renders INTERP_DELAY ticks behind', () => {
    let t = 1000;
    const clock = createTickClock({ now: () => t });
    expect(clock.synced).toBe(false);
    expect(clock.renderTick()).toBe(0);
    clock.observe(10, 1000 + 10 * TICK_MS + 30); // 30 ms late
    clock.observe(11, 1000 + 11 * TICK_MS + 5);  // 5 ms late → becomes the base
    t = 1000 + 12 * TICK_MS + 5;
    expect(clock.serverTick()).toBeCloseTo(12, 6);
    expect(clock.renderTick()).toBeCloseTo(12 - INTERP_DELAY_TICKS, 6);
  });
  it('a lasting latency rise is absorbed slowly (no jumps), reset clears', () => {
    let t = 0;
    const clock = createTickClock({ now: () => t, drift: 0.5 });
    clock.observe(0, 0);
    clock.observe(1, TICK_MS + 40);
    t = 2 * TICK_MS;
    expect(clock.serverTick()).toBeCloseTo(2 - 20 / TICK_MS, 6);
    clock.reset();
    expect(clock.synced).toBe(false);
  });
});

describe('authorities', () => {
  it('local: builds, seats the player, steps at 20 Hz and forwards events', () => {
    const events = [];
    const a = createLocalAuthority({ onEvents: (ev) => events.push(...ev), seed: 1, roster: { total: 2, bosses: 0 }, world: flatWorld() });
    const player = { pos: [0, PLAYER_EYE, 0], yaw: 0, targetable: true };
    expect(a.ready).toBe(false);
    a.frame(16, player);
    expect(a.ready).toBe(true);
    expect(a.sim.players.has(LOCAL_ID)).toBe(true);
    for (let i = 0; i < 60; i++) a.frame(1000 / 60, player);
    expect(a.sim.tick).toBeGreaterThanOrEqual(19);
    expect(a.sim.tick).toBeLessThanOrEqual(21);
    expect(a.latest.b).toHaveLength(2);
    expect(a.renderTick()).toBeLessThanOrEqual(a.sim.tick);
    a.fire({ seq: 1, origin: [0, PLAYER_EYE, 0], dir: [0, 0, 1], rt: a.renderTick() });
    expect(events.some((e) => e.type === 'result' && e.seq === 1)).toBe(true);
  });
  it('local: a long stall never spirals (max 4 steps per frame)', () => {
    const a = createLocalAuthority({ onEvents: () => {}, roster: { total: 1, bosses: 0 }, world: flatWorld() });
    const player = { pos: [0, PLAYER_EYE, 0], yaw: 0, targetable: true };
    a.frame(16, player);
    const t0 = a.sim.tick;
    a.frame(5000, player);
    expect(a.sim.tick - t0).toBeLessThanOrEqual(4);
  });
  it('net: ingests snapshots into history, drops stale ones, forwards events and fires through send', () => {
    const sent = [], evs = [];
    let t = 0;
    const a = createNetAuthority({ getSelfId: () => 'me', send: (m) => sent.push(m), onEvents: (e) => evs.push(...e), now: () => t });
    expect(a.ready).toBe(false);
    a.ingestSnapshot({ tick: 5, b: [[0, 0, 1, 0, 1, 0, 5, 0, 1, 0]] });
    a.ingestSnapshot({ tick: 6, b: [[0, 0, 3, 0, 1, 0, 5, 0, 1, 0]] });
    a.ingestSnapshot({ tick: 4, b: [[0, 0, 99, 0, 1, 0, 5, 0, 1, 0]] }); // reordered → dropped
    expect(a.ready).toBe(true);
    expect(a.latest.tick).toBe(6);
    expect(a.history.sample(0, 5.5).x).toBeCloseTo(2, 6);
    a.ingestEvents({ tick: 6, ev: [{ type: 'kill', tk: 'bot', tid: 0 }] });
    expect(evs).toHaveLength(1);
    a.fire({ seq: 1 });
    expect(sent).toEqual([{ seq: 1 }]);
    a.dispose();
    a.fire({ seq: 2 });
    expect(sent).toHaveLength(1);
  });
});

describe('fx — fixed pools, two draw calls', () => {
  it('tracers and sparks recycle a fixed pool and fade out', () => {
    const parent = new THREE.Group();
    const fx = createGzFx(parent);
    const objects = parent.children.length;
    expect(objects).toBe(2);
    for (let i = 0; i < 500; i++) { fx.tracer(0, 1, 0, 10, 1, 0, TRACER_BOT); fx.impact(10, 1, 0, i % 2 === 0); }
    expect(parent.children.length).toBe(objects); // nothing allocated per shot
    expect(fx.active).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) fx.tick(1 / 30);
    expect(fx.active).toBe(0);
    fx.tracer(0, 1, 0, 1, 1, 0);
    fx.clear();
    expect(fx.active).toBe(0);
    fx.dispose();
    expect(parent.children.length).toBe(0);
  });
});
