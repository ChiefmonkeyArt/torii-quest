// src/engine/update/upgradeInPlace.js — client-side "install the latest version"
// primitive for the UPD-1 admin Upgrade Now button (v0.2.361-alpha).
//
// This module implements the ONE upgrade path a running browser client can honestly
// perform: purge the service worker + its caches and force-reload the page so the
// next network fetch pulls the newest deployed bundle from the CDN. It cannot
// deploy a fresh S3 bundle — that stays a maintainer step (see handoff §7 and the
// build+deploy invariant). What it CAN do is defeat a stale service-worker shell
// that's pinning the client on an old build: a common source of "I published, why
// don't players see it?" support pain.
//
// Safety boundary:
//   - PURE + node-safe at import: no THREE/Rapier/DOM, no top-level side effects,
//     no globals touched. Every I/O dependency (serviceWorker registry, caches
//     backend, location reloader) is INJECTED. Importing this touches nothing.
//   - The default browser adapter (`browserUpgradeAdapter`) is a small factory
//     that reads `navigator.serviceWorker`, `caches`, and `location` at CALL
//     time — never at module load. Tests substitute a mock adapter and never
//     hit the platform.
//   - NO signer touch, NO relay call, NO gate change, NO navigation to a
//     different origin. Same-origin reload only. SEC-1 / SEC-2 / SEC-3
//     invariants remain intact.
//   - NO auto-fire: this module exports functions, never runs one. Only an
//     explicit UI click (or a test) may invoke `runUpgradeInPlace`.
//   - Fails soft: individual step failures never throw. The return descriptor
//     records what worked, what didn't, and whether reload was attempted, so
//     the UI can render an honest result if reload were ever suppressed.

// Descriptor returned from runUpgradeInPlace(). Every field is set on both the
// success and the degraded paths so callers can key off shape, not existence.
// `ok` is a summary flag: true when reload actually fired (the only outcome
// that could matter to a real user — the page is now leaving anyway).
export const UPGRADE_STEP = Object.freeze({
  SW_UNREGISTER: 'sw-unregister',   // best-effort service worker cleanup
  CACHES_CLEAR:  'caches-clear',    // best-effort Cache Storage purge
  RELOAD:        'reload',          // hard reload — the terminating step
});

// _isFn(x) — narrow "callable" check that survives adapters with only a subset
// of the browser surface (a test can supply { reload: fn } and skip the others).
function _isFn(x) { return typeof x === 'function'; }

// runUpgradeInPlace({ adapter }) — the entry point the UI calls.
//   adapter: {
//     unregisterServiceWorkers?: async () => number   // returns count unregistered
//     clearCaches?:              async () => number   // returns count of cache keys purged
//     reload:                    () => void           // MUST be present; never returns
//   }
// Returns an object { ok, steps: [{ step, ok, detail }...] }. `reload` is called
// LAST and is the only step whose failure sets `ok=false` — the others are
// best-effort. If `adapter` is missing/malformed the call is a no-op that
// returns `ok:false` and an explanatory descriptor; nothing throws.
export async function runUpgradeInPlace({ adapter } = {}) {
  const steps = [];
  const safe = (adapter && typeof adapter === 'object') ? adapter : null;
  if (!safe || !_isFn(safe.reload)) {
    return {
      ok: false,
      steps: [{ step: UPGRADE_STEP.RELOAD, ok: false, detail: 'no adapter / no reload fn' }],
    };
  }

  // 1) Unregister service workers. A stale SW is the usual reason a client
  //    keeps seeing an old bundle even after a fresh CDN deploy.
  if (_isFn(safe.unregisterServiceWorkers)) {
    try {
      const n = await safe.unregisterServiceWorkers();
      steps.push({ step: UPGRADE_STEP.SW_UNREGISTER, ok: true, detail: Number.isFinite(n) ? n : 0 });
    } catch (e) {
      steps.push({ step: UPGRADE_STEP.SW_UNREGISTER, ok: false, detail: String(e && e.message || e) });
    }
  } else {
    steps.push({ step: UPGRADE_STEP.SW_UNREGISTER, ok: false, detail: 'not supported' });
  }

  // 2) Purge Cache Storage entries. Complements the SW unregister — an
  //    unregistered SW leaves its caches on disk unless we drop them.
  if (_isFn(safe.clearCaches)) {
    try {
      const n = await safe.clearCaches();
      steps.push({ step: UPGRADE_STEP.CACHES_CLEAR, ok: true, detail: Number.isFinite(n) ? n : 0 });
    } catch (e) {
      steps.push({ step: UPGRADE_STEP.CACHES_CLEAR, ok: false, detail: String(e && e.message || e) });
    }
  } else {
    steps.push({ step: UPGRADE_STEP.CACHES_CLEAR, ok: false, detail: 'not supported' });
  }

  // 3) Reload. This never returns in a live browser — the page is about to
  //    leave. In tests the mock returns synchronously so we can assert it.
  try {
    safe.reload();
    steps.push({ step: UPGRADE_STEP.RELOAD, ok: true, detail: 'requested' });
    return { ok: true, steps };
  } catch (e) {
    steps.push({ step: UPGRADE_STEP.RELOAD, ok: false, detail: String(e && e.message || e) });
    return { ok: false, steps };
  }
}

// browserUpgradeAdapter(win) — factory that reads the real platform surface at
// call time (not at import). Passing an explicit `win` lets tests substitute
// a mock global. Returns a shape usable by `runUpgradeInPlace`.
export function browserUpgradeAdapter(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  return {
    async unregisterServiceWorkers() {
      const sw = w && w.navigator && w.navigator.serviceWorker;
      if (!sw || !_isFn(sw.getRegistrations)) return 0;
      const regs = await sw.getRegistrations();
      let n = 0;
      for (const r of (regs || [])) {
        try { const ok = await r.unregister(); if (ok) n += 1; } catch { /* soft */ }
      }
      return n;
    },
    async clearCaches() {
      const c = w && w.caches;
      if (!c || !_isFn(c.keys) || !_isFn(c.delete)) return 0;
      const keys = await c.keys();
      let n = 0;
      for (const k of (keys || [])) {
        try { const ok = await c.delete(k); if (ok) n += 1; } catch { /* soft */ }
      }
      return n;
    },
    reload() {
      const loc = w && w.location;
      if (!loc || !_isFn(loc.reload)) throw new Error('location.reload unavailable');
      // Passing true is a legacy Firefox hint for "bypass cache"; modern
      // browsers ignore the argument but honour the SW-purge above.
      loc.reload();
    },
  };
}
