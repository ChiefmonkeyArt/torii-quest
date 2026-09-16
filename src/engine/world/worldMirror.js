// engine/world/worldMirror.js — the escalation orchestration for the portal
// live-mirror (ADR-0118): look through the gate into another world before crossing.
//
// Three tiers on one seam:
//   peek  — resolve the manifest (ADR-0117) and render it through the gate (no socket)
//   live  — additionally open a read-only spectator stream of the destination's state
//   drop  — tear the mirror down on cross / leave (idempotent close)
//
// Pure: every side effect (resolve, renderPortal, openSpectator, disposePortal) is
// injected, so the escalation order + graceful-degradation behaviour are unit-testable
// in node. It mirrors worldTransition.js: this module opens the WINDOW, the transition
// module walks through it.

/**
 * Open the portal mirror for a target world.
 *
 * @param {{ target:any,
 *           resolve:(target)=>Promise<{ok:boolean,world?:any,relays?:string[],reason?:string}>,
 *           renderPortal:(world:any)=>Promise<void>,
 *           openSpectator?:(relays?:string[])=>Promise<{ok:boolean,close?:Function}|null>,
 *           disposePortal?:()=>Promise<void> }} args
 * @returns {Promise<{ok:boolean,phase:string,tier:'peek'|'live'|null,world?:any,relays?:string[],
 *                    reason?:string|null,close:()=>Promise<void>}>}
 *   Never rejects. `close` is idempotent and idempotently disposes the spectator + portal.
 */
export async function openMirror({
  target, resolve, renderPortal, openSpectator, disposePortal,
} = {}) {
  const noop = async () => {};
  const fail = (phase, reason) => ({ ok: false, phase, reason, world: null, relays: [], tier: null, close: noop });

  if (typeof resolve !== 'function' || typeof renderPortal !== 'function') {
    return fail('resolve', 'missing-hook');
  }

  // 1. resolve — the content-addressed world for the target npub.
  let resolved;
  try { resolved = await resolve(target); } catch { resolved = null; }
  if (!resolved || !resolved.ok || !resolved.world) {
    return fail('resolve', (resolved && resolved.reason) || 'resolve-failed');
  }
  const world = resolved.world;
  const relays = Array.isArray(resolved.relays) ? resolved.relays : [];

  // 2. peek — render the manifest-only world through the gate. Fails closed here
  // (there is no mirror without a rendered world).
  try { await renderPortal(world); } catch { return fail('peek', 'peek-failed'); }

  // 3. live — try to promote to a read-only spectator stream. Graceful: a failed or
  // absent spectator keeps a working peek (degradation, not failure).
  let tier = 'peek';
  let specClose = null;
  if (typeof openSpectator === 'function') {
    let s = null;
    try { s = await openSpectator(relays); } catch { s = null; }
    if (s && s.ok) {
      tier = 'live';
      if (typeof s.close === 'function') specClose = s.close;
    }
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { if (specClose) await specClose(); } catch { /* noop */ }
    if (typeof disposePortal === 'function') { try { await disposePortal(); } catch { /* noop */ } }
  };

  return { ok: true, phase: 'stream', tier, world, relays, reason: null, close };
}