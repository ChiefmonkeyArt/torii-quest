// serializedPoll.js — elapsed-time, serialized polling throttle (audit F11).
//
// The shell's title-screen ticker previously advanced frame counters under a
// rAF loop and fired network work with no per-operation in-flight guard: a
// slow request could be re-triggered on a later frame and settle out of order,
// and the wall-clock cadence varied with display refresh rate / background
// throttling.
//
// This helper fixes both:
//   * cadence is wall-clock (Date.now delta), not frame count;
//   * a poll for a given key never runs while the previous run for that key is
//     still in flight — slow requests serialize instead of overlapping.
//
// PURE: no DOM, no timers, no network — `run()` is whatever side effect the
// caller passes. Kept in its own module so the throttle is directly unit-tested
// without booting the arena.

export function createSerializedPoller(now = () => Date.now()) {
  const slots = new Map(); // key -> { lastRun, inFlight }

  return {
    /**
     * Run `run()` for `key` at most once per `intervalMs`, and never while the
     * previous run is still pending. Returns true when a run was scheduled,
     * false when throttled (not yet due) or already in flight.
     *
     * `run` may return a promise; while it is pending the slot stays
     * "in flight" so the next tick for the same key is skipped (serialization),
     * and any rejection is swallowed so a failed poll cannot collide the loop.
     */
    poll(key, intervalMs, run) {
      let s = slots.get(key);
      if (!s) {
        s = { lastRun: -Infinity, inFlight: false };
        slots.set(key, s);
      }
      if (s.inFlight) return false; // serialize: never overlap a slow request
      const t = now();
      if (t - s.lastRun < intervalMs) return false; // elapsed-time cadence
      s.lastRun = t;
      s.inFlight = true;
      Promise.resolve()
        .then(run)
        .catch(() => {})
        .finally(() => {
          s.inFlight = false;
        });
      return true;
    },

    /** True while a run for `key` is still pending (observability for tests). */
    isInFlight(key) {
      return !!(slots.get(key) && slots.get(key).inFlight);
    },
  };
}

// Cadences (wall-clock). These preserve the shell's original 60 fps frame
// counts: 120 frames ≈ 2 s, 600 frames ≈ 10 s.
export const POLL_MS = Object.freeze({
  handshake: 2000, // n2n handshake tick → gateway card
  heartbeat: 2000, // heartbeat republish check (inside isHeartbeatDue's own gate)
  presence: 10000, // online-worlds presence re-scan
  beaconSync: 10000, // server beacon state re-sync
});