// characterSelection.js - pure SET_CHAR session update used by arena-ws.

export const SUPPORTED_CHARACTERS = Object.freeze(['chiefmonkey', 'nostrich']);
const SUPPORTED_CHARACTER_SET = new Set(SUPPORTED_CHARACTERS);

/**
 * Apply a validated SET_CHAR message to an authenticated session.
 * Returns the refreshed JOIN payload, or null for an unsupported character.
 */
export function applyCharacterSelection(sess, character) {
  if (!sess || !SUPPORTED_CHARACTER_SET.has(character)) return null;
  sess.character = character;
  return {
    id: sess.id,
    npub: sess.npub,
    pos: sess.pos,
    rot: sess.rot,
    character: sess.character,
  };
}
