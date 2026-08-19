// engine/presence/heartbeat.js — Phase 0d node presence heartbeat timing +
// status helpers. PURE + node-safe: NO DOM, NO WebSocket, NO setTimeout, NO
// fetch, NO Date.now() reach. The host (main.js) injects `now` (epoch ms) on
// every call so this leaf is fully deterministic + unit-testable with fakes.
//
// Constrained by construction:
//   - isHeartbeatDue / nextHeartbeatInMs are pure arithmetic over injected
//     timestamps. They never read a clock, never schedule anything.
//   - heartbeatStatus is a pure function of the injected inputs → a single
//     status string the menu renders. It never side-effects.
//   - The republish scheduler itself lives in main.js and rides the existing
//     requestAnimationFrame _shellTick loop (no new timers anywhere). These
//     helpers only ANSWER "is it due?" / "what's the status?".

// Default republish interval: 10 min. The NIP-40 expiration (20 min default,
// see worldPresence.buildPresenceEvent) is deliberately longer than the
// republish interval so a healthy node refreshes its presence well before the
// old event would auto-drop — a missed republish never leaves a gap.
export const HEARTBEAT_INTERVAL_MS = 600000;

// isHeartbeatDue({ lastPublishedAt, now, intervalMs }) → bool. True when the
// interval has elapsed since the last publish. When `lastPublishedAt` is
// null/undefined (never published) this returns FALSE — the caller decides
// whether a first publish is due (explicit consent via the menu toggle), not
// this helper. `intervalMs` defaults to HEARTBEAT_INTERVAL_MS. Pure.
export function isHeartbeatDue(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const last = typeof o.lastPublishedAt === 'number' && Number.isFinite(o.lastPublishedAt)
    ? o.lastPublishedAt : null;
  const now = typeof o.now === 'number' && Number.isFinite(o.now) ? o.now : 0;
  const intervalMs = typeof o.intervalMs === 'number' && Number.isFinite(o.intervalMs) && o.intervalMs > 0
    ? o.intervalMs : HEARTBEAT_INTERVAL_MS;
  if (last === null) return false;
  return (now - last) >= intervalMs;
}

// nextHeartbeatInMs({ lastPublishedAt, now, intervalMs }) → ms until the next
// republish is due (>=0). 0 when already due / never published (the caller
// treats never-published as "due now only on explicit consent", but the
// countdown itself is 0). Pure.
export function nextHeartbeatInMs(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const last = typeof o.lastPublishedAt === 'number' && Number.isFinite(o.lastPublishedAt)
    ? o.lastPublishedAt : null;
  const now = typeof o.now === 'number' && Number.isFinite(o.now) ? o.now : 0;
  const intervalMs = typeof o.intervalMs === 'number' && Number.isFinite(o.intervalMs) && o.intervalMs > 0
    ? o.intervalMs : HEARTBEAT_INTERVAL_MS;
  if (last === null) return 0;
  const remaining = intervalMs - (now - last);
  return remaining > 0 ? remaining : 0;
}

// heartbeatStatus({ intent, isOwner, hasSigner, nodeRelays, lastPublishedAt,
//   now, lastError, republishPaused, expirationTtlSec }) → a single status
// string for the menu. Precedence (most-blocking first):
//   off                       — intent off (the operator disabled the heartbeat)
//   blocked:not-owner         — not the node operator
//   blocked:no-signer        — no NIP-07 signer available
//   blocked:no-node-relay     — no node relay configured (NEVER falls back to
//                              public RELAYS — the public-relay regression this
//                              slice forbids)
//   paused:wallet-requires-approval — a republish sign was rejected/threw;
//                              auto-republish stops until the operator re-toggles
//   failed:<lastError>        — last publish failed for a non-sign reason
//   idle                      — intent on, awaiting the first publish
//   publishing                — (caller sets this transiently during a publish)
//   live                      — published, next republish due in the future
//   stale                     — published but past the NIP-40 expiration window
//                              (republish overdue)
// Pure; never throws.
export function heartbeatStatus(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const intent = o.intent === 'on' ? 'on' : 'off';
  const isOwner = o.isOwner === true;
  const hasSigner = o.hasSigner === true;
  const nodeRelays = Array.isArray(o.nodeRelays) ? o.nodeRelays : [];
  const last = typeof o.lastPublishedAt === 'number' && Number.isFinite(o.lastPublishedAt)
    ? o.lastPublishedAt : null;
  const now = typeof o.now === 'number' && Number.isFinite(o.now) ? o.now : 0;
  const lastError = typeof o.lastError === 'string' && o.lastError !== '' ? o.lastError : null;
  const republishPaused = o.republishPaused === true;
  // The expiration window mirrors buildPresenceEvent's default (1200s). A node
  // is "stale" once its last publish is older than the expiration ttl — the
  // republish is overdue even if the interval hasn't formally elapsed.
  const expirationTtlSec = typeof o.expirationTtlSec === 'number' && Number.isFinite(o.expirationTtlSec) && o.expirationTtlSec > 0
    ? o.expirationTtlSec : 1200;

  if (intent !== 'on') return 'off';
  if (!isOwner) return 'blocked:not-owner';
  if (!hasSigner) return 'blocked:no-signer';
  if (!nodeRelays.length) return 'blocked:no-node-relay';
  if (republishPaused) return 'paused:wallet-requires-approval';
  if (lastError) return `failed:${lastError}`;
  if (last === null) return 'idle';
  // Published: distinguish live (next republish still in the future) from
  // stale (past the expiration window — the directory would have dropped us).
  const ageMs = now - last;
  const expirationMs = expirationTtlSec * 1000;
  if (ageMs >= expirationMs) return 'stale';
  return 'live';
}
