// src/gamezone/client/tickClock.js — map local time onto the authority's tick (ADR-0130).
//
// No clock sync, no ping maths: every GZ_SNAP names its tick, so
//   base ≈ arrivalTime − tick·TICK_MS
// The EARLIEST arrival seen is the least-delayed one, so `base` follows the
// minimum (instantly downward, slowly upward to absorb a lasting latency rise or
// clock drift). renderTick() sits INTERP_DELAY_TICKS behind, giving a jitter
// buffer of two snapshots; history.sample() never extrapolates past the newest.
// Node-pure.

import { TICK_MS, INTERP_DELAY_TICKS } from '../core/constants.js';

export function createTickClock({ now = () => performance.now(), delayTicks = INTERP_DELAY_TICKS, drift = 0.02 } = {}) {
  let base = null;
  return {
    observe(tick, at = now()) {
      const b = at - tick * TICK_MS;
      if (base === null || b < base) base = b;
      else base += (b - base) * drift;
    },
    get synced() { return base !== null; },
    serverTick(at = now()) { return base === null ? 0 : (at - base) / TICK_MS; },
    renderTick(at = now()) { return base === null ? 0 : (at - base) / TICK_MS - delayTicks; },
    reset() { base = null; },
  };
}
