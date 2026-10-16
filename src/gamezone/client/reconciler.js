// src/gamezone/client/reconciler.js — the no-ghost rule (ADR-0130).
//
// The authority's snapshot is the COMPLETE roster. After every reconcile the set
// of live views equals the snapshot's id set exactly: missing ids are created,
// ids the snapshot no longer lists are disposed at once. There is no other path
// that creates or keeps a bot view, so a view without an authoritative bot (a
// "ghost") cannot exist. Node-pure — the factory/disposer are injected.

/**
 * @param {Map<any, any>} views
 * @param {Array<{id:any}>} roster
 * @param {(entry:any)=>any} create
 * @param {(view:any)=>void} dispose
 * @returns {{created:number, disposed:number}}
 */
export function reconcileViews(views, roster, create, dispose) {
  const want = new Map();
  for (const r of roster) want.set(r.id, r);
  let disposed = 0, created = 0;
  for (const [id, v] of views) {
    const r = want.get(id);
    // Same id but a different kind (roster reshuffle) is a different bot.
    if (!r || (v && v.kind !== undefined && r.kind !== undefined && v.kind !== r.kind)) {
      // A failing disposer must never abort the pass — that would leave ghosts.
      try { dispose(v); } catch { /* view is dropped regardless */ }
      views.delete(id); disposed++;
    }
  }
  for (const [id, r] of want) {
    if (!views.has(id)) { views.set(id, create(r)); created++; }
  }
  return { created, disposed };
}

/** Dispose every view (zone unmount / world swap). */
export function clearViews(views, dispose) {
  for (const v of views.values()) { try { dispose(v); } catch { /* keep clearing */ } }
  views.clear();
}
