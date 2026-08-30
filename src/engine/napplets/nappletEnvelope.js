// engine/napplets/nappletEnvelope.js — NIP-5D-style postMessage envelope helpers for
// the Torii Quest napplet shell (ADR-0057). PURE + node-safe: no DOM, no Three, no
// network, no signing. Every napplet ↔ shell message is a typed JSON envelope:
//
//   request : { type: "<ns>.<action>", id: <opaque>, data?: { ... } }
//   result  : { type: "<ns>.<action>.result",  id: <same-id>, result: { ... } }
//   error   : { type: "<ns>.<action>.error",   id: <same-id>, error: { code, message } }
//
// `type` is a non-empty string with a namespace prefix (e.g. "world.attach.get").
// `id` is opaque to the shell but MUST be present so request/result pairing works.
// Unknown `type` values are silently ignored (forward-compat, per NIP-5D §capability).

// NAP namespaces this shell understands. `world` = nap-torii-world (in-world surface
// napplets, ADR-0057). `game` = nap-torii-game (napplets that own their scene,
// ADR-0082). `avatar` = nap-torii-avatar (character read/write, ADR-0083).
export const WORLD_NAMESPACE = 'world';
export const GAME_NAMESPACE = 'game';
export const AVATAR_NAMESPACE = 'avatar';
export const NAPPLET_NAMESPACES = Object.freeze([
  WORLD_NAMESPACE, GAME_NAMESPACE, AVATAR_NAMESPACE,
]);

// splitType("world.attach.get") → { ns: "world", action: "attach.get" }
// Returns { ns, action } or null if `type` is not a dotted namespace string.
export function splitType(type) {
  if (typeof type !== 'string' || type.length === 0) return null;
  const dot = type.indexOf('.');
  if (dot <= 0) return null;
  const ns = type.slice(0, dot);
  const action = type.slice(dot + 1);
  if (action.length === 0) return null;
  return { ns, action };
}

// validateEnvelope(msg) → { ok, type, id, data } | { ok: false, reason }
// Checks shape only — does NOT check whether the action is implemented.
// `data` defaults to a frozen empty object when omitted.
export function validateEnvelope(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, reason: 'not-object' };
  const { type, id, data } = msg;
  if (typeof type !== 'string' || type.length === 0) return { ok: false, reason: 'missing-type' };
  if (!splitType(type)) return { ok: false, reason: 'malformed-type' };
  if (id === null || id === undefined) return { ok: false, reason: 'missing-id' };
  if (typeof id !== 'string' && typeof id !== 'number') return { ok: false, reason: 'bad-id' };
  const d = data === undefined ? {} : data;
  if (typeof d !== 'object' || d === null) return { ok: false, reason: 'bad-data' };
  return { ok: true, type, id, data: d };
}

// resultEnvelope("world.attach.get", id, { ... }) → outbound result envelope.
export function resultEnvelope(type, id, result) {
  return { type: `${type}.result`, id, result: result === undefined ? {} : result };
}

// errorEnvelope("world.attach.get", id, "wrong-surface", "...") → outbound error.
export function errorEnvelope(type, id, code, message) {
  return { type: `${type}.error`, id, error: { code, message } };
}

// isResultType("world.attach.get.result") → true iff the type ends with ".result".
export function isResultType(type) {
  return typeof type === 'string' && type.endsWith('.result') && type.length > 7;
}

// isErrorType("world.attach.get.error") → true iff the type ends with ".error".
export function isErrorType(type) {
  return typeof type === 'string' && type.endsWith('.error') && type.length > 6;
}
