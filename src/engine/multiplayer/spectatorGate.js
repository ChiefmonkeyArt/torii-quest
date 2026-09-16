// engine/multiplayer/spectatorGate.js — the read-only SPECTATE trust tier (ADR-0118
// Decision 4): a spectator receives the world-state broadcast (the same frames seated
// peers see) but can never join, mutate, publish, or carry identity. PURE decision
// logic + a read-only fan-out registry the server wires next; node-pure and unit-testable
// (a `ws` is an injected object exposing send/terminate + bufferedAmount).

import { MSG } from './wireProtocol.js';

// The ONLY message types a spectator may SEND — keepalive transport noise. Everything
// else (AUTH/JOIN/MOVE/SHOT/HIT/KILL/CHAT/KAMI_STATE/…) is refused: a spectator cannot
// be seated, cannot be granted identity, cannot mutate the world.
export const SPECTATOR_SEND_ALLOWED = Object.freeze([MSG.PING, MSG.PONG]);

/** Can a spectator SEND this message type? (hardening gate for the inbound path.) */
export function canSpectatorSend(type) {
  return SPECTATOR_SEND_ALLOWED.includes(type);
}

/** Is anything listening for the periodic world-state broadcast (authed or spectator)? */
export function hasWorldListeners(authedCount, spectatorCount) {
  return (Number.isFinite(authedCount) ? authedCount : 0) > 0
      || (Number.isFinite(spectatorCount) ? spectatorCount : 0) > 0;
}

/**
 * A read-only fan-out set for spectators. Mirrors the server's broadcast loop:
 * slow readers (bufferedAmount > maxBuffered) are terminated + dropped rather than
 * buffered unbounded; per-socket send failures are swallowed. `add/remove/send` take
 * plain ws objects so it is testable with mocks.
 *
 * @returns {{ add:(ws)=>number, remove:(ws)=>boolean, send:(wire:any)=>number,
 *             size:()=>number, has:(ws)=>boolean, forEach:(fn)=>void }}
 */
export function createSpectatorRegistry({ maxBuffered = 0 } = {}) {
  const set = new Set();
  const tooSlow = (ws) => maxBuffered > 0 && Number.isFinite(ws.bufferedAmount) && ws.bufferedAmount > maxBuffered;

  function add(ws) {
    if (ws && typeof ws.send === 'function') set.add(ws);
    return set.size;
  }
  function remove(ws) { return set.delete(ws); }
  function size() { return set.size; }
  function has(ws) { return set.has(ws); }
  function send(wire) {
    for (const ws of set) {
      if (tooSlow(ws)) {
        try { if (typeof ws.terminate === 'function') ws.terminate(); } catch { /* noop */ }
        set.delete(ws);
        continue;
      }
      try { ws.send(wire); } catch { /* ignore individual failures */ }
    }
    return set.size;
  }
  function forEach(fn) { set.forEach(fn); }

  return { add, remove, send, size, has, forEach };
}