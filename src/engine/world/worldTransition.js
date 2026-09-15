// engine/world/worldTransition.js — the seamless "torii threshold" orchestration.
//
// The order of operations that swaps world A for world B on ONE canvas — the
// resolve → iris → socket-handoff → rebuild → spawn sequence that replaces the
// today's top-level navigate. This module encodes the ORDER + fail-closed
// behaviour only; it holds no Three.js, Rapier, WebSocket, or transport of its
// own (every side effect is injected), so the sequence is unit-testable in node
// and the host wires the real renderer/socket behind each hook.
//
//   resolveWorldByNpub(target) ──► fade-out (gate irises full) ──► stopMultiplayer
//   ('travel') ──► renderWorld(world) on the live canvas ──► joinWorld(relays, token)
//   ──► spawnAt(destination gate) ──► fade-in (reveal world B)
//
// Fail-closed: any failing step aborts with the phase that failed; the host runs
// its existing recovery (re-render the gateway card / leaveToTitle).

export const TRANSITION_PHASES = Object.freeze([
  'resolve', 'fade-out', 'stop', 'render', 'join', 'spawn', 'fade-in',
]);

const REQUIRED_HOOKS = [
  'resolve', 'fadeOut', 'stopMultiplayer', 'renderWorld', 'joinWorld', 'spawnAt', 'fadeIn',
];

/**
 * Run the seamless world handoff. Every hook is injected; a missing hook or a
 * hook that throws fails closed at that phase.
 *
 * @param {{ target:any,
 *           resolve:(target)=>Promise<{ok:boolean,world?:any,relays?:string[],reason?:string}>,
 *           fadeOut?:()=>Promise<void>, stopMultiplayer?:(reason:string)=>Promise<void>,
 *           renderWorld?:(world:any)=>Promise<void>, joinWorld?:(relays?:string[],token?:any)=>Promise<{ok:boolean}>,
 *           spawnAt?:(gate?:any)=>Promise<void>, fadeIn?:()=>Promise<void> }} args
 * @returns {Promise<{ok:boolean, phase:string, world?:any, relays?:string[], reason?:string|null}>}
 *   Never rejects.
 */
export async function transitionToWorld(args = {}) {
  const a = args && typeof args === 'object' ? args : {};
  const fail = (phase, reason) => ({ ok: false, phase, reason, world: null, relays: [] });

  for (const name of REQUIRED_HOOKS) {
    if (typeof a[name] !== 'function') return fail('resolve', `missing-hook:${name}`);
  }

  // 1. resolve — the content-addressed world for the target.
  let resolved;
  try { resolved = await a.resolve(a.target); } catch { resolved = null; }
  if (!resolved || !resolved.ok || !resolved.world) {
    return fail('resolve', (resolved && resolved.reason) || 'resolve-failed');
  }
  const world = resolved.world;
  const relays = Array.isArray(resolved.relays) ? resolved.relays : [];

  // 2. fade-out — the torii gate irises full over world A.
  try { await a.fadeOut(); } catch { return fail('fade-out', 'fade-out-failed'); }

  // 3. stop — gracefully leave relay A (the server logs LEFT, not a ping timeout).
  try { await a.stopMultiplayer('travel'); } catch { return fail('stop', 'stop-failed'); }

  // 4. render — build world B into the same canvas.
  try { await a.renderWorld(world); } catch { return fail('render', 'render-failed'); }

  // 5. join — open relay B and consume the signed travel token (no NIP-07 re-sign).
  let joined = null;
  try { joined = await a.joinWorld(relays); } catch { joined = null; }
  if (!joined || joined.ok === false) return fail('join', 'join-failed');

  // 6. spawn — place the character at the destination gate, facing outward.
  try { await a.spawnAt(); } catch { return fail('spawn', 'spawn-failed'); }

  // 7. fade-in — reveal world B through the gate.
  try { await a.fadeIn(); } catch { return fail('fade-in', 'fade-in-failed'); }

  return { ok: true, phase: 'fade-in', world, relays, reason: null };
}