// server/character/concurrencyGate.js — bounded concurrent GLB work (audit F08b).
//
// A tiny synchronous admission gate shared by the two heavy GLB paths so
// unlimited simultaneous requests can't exhaust the event loop (headless
// Draco decode/re-encode) or the operator's vendor spend (paid Meshy runs).
// Both a global cap and a per-key cap are enforced.
//
// `tryEnter(key)` is synchronous and, in the single-threaded Node event loop,
// the caller's following `await` may not interleave another request between
// `tryEnter` and the matching `leave` — so an admitted request is a hard
// reservation with no re-entrancy window and no timer/Guidance lock needed.

export function createConcurrencyGate({ maxGlobal = 2, maxPerKey = 1 } = {}) {
  let global = 0;
  const perKey = new Map();

  /** Admit one unit of work for `key`, or return false when a cap is reached. */
  function tryEnter(key) {
    if (global >= maxGlobal) return false;
    const n = perKey.get(key) || 0;
    if (n >= maxPerKey) return false;
    global += 1;
    perKey.set(key, n + 1);
    return true;
  }

  /** Release the reservation for `key`. Must be called exactly once per admit. */
  function leave(key) {
    if (global > 0) global -= 1;
    const n = perKey.get(key) || 0;
    if (n > 1) perKey.set(key, n - 1);
    else perKey.delete(key);
  }

  return {
    tryEnter,
    leave,
    // Observability/tests only.
    _inFlight: () => global,
    _perKey: (key) => perKey.get(key) || 0,
  };
}