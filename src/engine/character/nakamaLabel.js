// engine/character/nakamaLabel.js — v0.2.813 Nakama identity composer.
// Pure, node-safe, dependency-free. Extracted from napNpc.js so unit tests
// can exercise the label rules without pulling in three/scene.
//
// A Nakama is an instance owner's in-world greeter: on the OWNER's Torii,
// the NAP-zone NPC's nameplate reads '<OwnerName> Nakama' (e.g. 'Chiefmonkey
// Nakama', 'BitcoinBekka Nakama'). Before the owner's kind:0 resolves — or
// on an ownerless (guest-only) install — the label is just 'Nakama' so the
// NPC always has a printable identity.
//
// The owner's Nostr display name is attacker-controlled (any kind:0 can carry
// any `name`), so the composer bounds length and strips control characters
// before the label ever reaches a sprite canvas.

export const NAKAMA_SUFFIX = 'Nakama';
export const NAKAMA_DEFAULT_LABEL = 'Nakama';
export const NAKAMA_NAME_MAX = 32;

/**
 * composeNakamaLabel(ownerName) → string
 *
 * @param {unknown} ownerName — the owner's kind:0 display name (any input).
 * @returns {string} — '<clean> Nakama' when a printable name survives sanitisation,
 *                     'Nakama' otherwise. Never throws. Always ≤ 32+7 chars.
 */
export function composeNakamaLabel(ownerName) {
  const raw = typeof ownerName === 'string' ? ownerName : '';
  // Strip control chars (0x00-0x1F, 0x7F) that would render as tofu boxes.
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, NAKAMA_NAME_MAX);
  return clean ? `${clean} ${NAKAMA_SUFFIX}` : NAKAMA_DEFAULT_LABEL;
}
