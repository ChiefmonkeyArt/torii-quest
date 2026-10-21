// v0.2.907-alpha: `?nuked=1` is the loop guard pinned by the stale-cache
// self-heal reload (it stops the heal from looping). It used to stay in the
// address forever, so the heal stayed disarmed in that tab (and in bookmarks)
// even when a later deploy really did leave a stale cache. Once the arena has
// booted, the fresh code is proven, so the pin is dropped via replaceState
// (no reload, no history entry). Pure helper + a guarded applier.

/** Returns `search` without the nuked=1 pair (other params and order kept). */
export function stripNukedParam(search) {
  const s = String(search || '');
  if (!/[?&]nuked=1(?:&|$)/.test(s)) return s;
  const kept = s.replace(/^\?/, '').split('&').filter((p) => p && p !== 'nuked=1');
  return kept.length ? '?' + kept.join('&') : '';
}

/** Drops the pin from the live URL. Returns true if the URL changed. */
export function clearNukedPin({ loc = globalThis.location, hist = globalThis.history } = {}) {
  try {
    if (!loc || !hist || typeof hist.replaceState !== 'function') return false;
    const next = stripNukedParam(loc.search);
    if (next === loc.search) return false;
    hist.replaceState(hist.state, '', loc.pathname + next + loc.hash);
    return true;
  } catch { return false; }
}
