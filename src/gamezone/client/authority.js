// src/gamezone/client/authority.js — where combat outcomes come from (ADR-0130).
//
// The client presentation layer talks to ONE interface, whichever authority is
// behind it:
//   LocalAuthority — single-player / offline: runs the shared core sim in the
//                    browser (same module the VPS runs), stepping it on a fixed
//                    20 Hz accumulator. The sim starts on the first frame (the
//                    arena grid fills lazily); the grid is then warmed in small
//                    time slices so later first-time queries never hitch.
//   NetAuthority   — multiplayer: the VPS runs the sim; this side buffers
//                    GZ_SNAP into the same tick history and forwards GZ_EVENT.
//
// Interface:
//   kind, ready, selfId
//   history         tick-indexed pose history (core/history.js)
//   latest          newest snapshot {tick, b:[rows]} (lifecycle/hp/anim source)
//   renderTick()    the fractional tick the client should draw (and report on fire)
//   fire(shot)      submit a shot {seq, origin, dir, rt, claim}
//   frame(dt, ctx)  per-frame pump (local: build/step; net: nothing)
//   dispose()

import { createArenaWorld } from '../core/arenaWorld.js';
import { createGameZoneSim } from '../core/sim.js';
import { createHistory } from '../core/history.js';
import { TICK_MS, ROSTER } from '../core/constants.js';
import { createTickClock } from './tickClock.js';

export const LOCAL_ID = 'local';
const MAX_STEPS_PER_FRAME = 4;
const WARM_MS = 3; // per-frame grid warm-up budget (≈1.1 s of work total)

export function createLocalAuthority({ onEvents, seed = (Date.now() >>> 0), roster = ROSTER, world = null } = {}) {
  const w = world || createArenaWorld();
  let sim = null, acc = 0, latest = null, disposed = false;
  const api = {
    kind: 'local', selfId: LOCAL_ID,
    get ready() { return !!sim; },
    get history() { return sim ? sim.botHist : null; },
    get latest() { return latest; },
    get sim() { return sim; },
    renderTick() { return sim ? Math.max(0, sim.tick - 1 + acc / TICK_MS) : 0; },
    fire(shot) {
      if (!sim) return;
      sim.fire(LOCAL_ID, shot);
      const ev = sim.drainEvents();
      if (ev.length) onEvents(ev);
    },
    /**
     * @param {number} dtMs
     * @param {{pos:number[], yaw:number, targetable:boolean}} player
     */
    frame(dtMs, player) {
      if (disposed) return;
      if (!w.complete) w.build(WARM_MS);
      if (!sim) {
        sim = createGameZoneSim({ world: w, seed, roster });
        sim.addPlayer(LOCAL_ID, { pos: player.pos, yaw: player.yaw });
        latest = sim.snapshot();
        return;
      }
      sim.updatePlayer(LOCAL_ID, player.pos, player.yaw);
      sim.setTargetable(LOCAL_ID, player.targetable);
      acc += Math.min(dtMs, 250);
      let n = 0;
      while (acc >= TICK_MS && n < MAX_STEPS_PER_FRAME) {
        acc -= TICK_MS; n++;
        const ev = sim.step();
        if (ev.length) onEvents(ev);
      }
      if (acc >= TICK_MS) acc = 0; // drop a backlog after a long stall instead of spiralling
      if (n) latest = sim.snapshot();
    },
    dispose() { disposed = true; sim = null; latest = null; },
  };
  return api;
}

/**
 * @param {object} deps
 * @param {()=>string|null} deps.getSelfId
 * @param {(msg:object)=>boolean} deps.send       mp.sendGzFire
 * @param {(events:Array)=>void} deps.onEvents
 */
export function createNetAuthority({ getSelfId, send, onEvents, now = () => performance.now() }) {
  const history = createHistory();
  const clock = createTickClock({ now });
  let latest = null, disposed = false;
  return {
    kind: 'net',
    get selfId() { return getSelfId(); },
    get ready() { return !!latest; },
    get history() { return history; },
    get latest() { return latest; },
    clock,
    renderTick() { return clock.renderTick(); },
    ingestSnapshot(m) {
      if (disposed || !m || !Array.isArray(m.b)) return;
      if (latest && m.tick < latest.tick) return; // stale (reordered)
      clock.observe(m.tick);
      const rows = new Map();
      for (const r of m.b) rows.set(r[0], { x: r[2], y: r[3], z: r[4], yaw: r[5], st: r[7], sp: r[9] });
      history.record(m.tick, rows);
      latest = m;
    },
    ingestEvents(m) {
      if (disposed || !m || !Array.isArray(m.ev)) return;
      onEvents(m.ev);
    },
    fire(shot) { if (!disposed) send(shot); },
    frame() {},
    dispose() { disposed = true; latest = null; },
  };
}
