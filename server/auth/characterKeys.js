// server/auth/characterKeys.js — single source of truth for the character keys
// the server accepts in AUTH / AUTH_TOKEN (v0.2.759). Kept separate from
// arena-ws.js so the whitelist is unit-testable without importing the WebSocket
// server (which pulls in ws, http, crypto, redis, …).
//
// v0.2.760-alpha: 'guest' is the new anonymous default (guest-first title screen).

export const VALID_CHARACTERS = new Set(['guest', 'chiefmonkey', 'nostrich']);

// A 64-lowercase-hex string is a Character-Forge mesh hash (kind-35100), which
// is a valid peer-resolvable character identity even though it isn't a preset.
const MESH_HASH_RE = /^[0-9a-f]{64}$/;

export function isValidCharacterKey(key) {
  if (typeof key !== 'string' || !key) return false;
  return VALID_CHARACTERS.has(key) || MESH_HASH_RE.test(key);
}