// engine/menu/menuSections.js — pure sub-partitioning for the persistent Torii
// menu's four world sections (Phase 0c). Builds on top of the existing
// partitionGatewaySections ({ friends, arenas }) and further splits `arenas`
// into: following / games / all — so the menu can show a richer, browsable
// directory than the two-section gateway card.
//
//   friends   — mutual-follow worlds (unchanged from partitionGatewaySections).
//   following — arenas whose owner the logged-in user follows but is NOT a
//               mutual (followed-but-not-followed-back). Empty when logged out.
//   games     — arenas whose zoneType is 'arena' OR whose topics include a
//               game/experience keyword ('game','arena','experience'). These are
//               the curated "experiences to visit."
//   all       — the remaining arenas not already placed in friends/following/
//               games, de-duplicated, as a fallback browse list.
//
// PURE + node-safe: NO DOM, NO network, NO I/O. It only re-uses the existing
// pure partitionGatewaySections leaf + a couple of small classification rules.
// Never throws — garbage input degrades to four empty arrays. Mirrors the
// existing pure-layer pattern (gatewaySections.js / worldPresence.js).

import { partitionGatewaySections } from '../gateway/gatewaySections.js';

// Topics that mark a world as a "game / experience" worth surfacing in the
// curated games section. Lowercase, matched against the world's `topics` array
// (already sanitised + lowercased by gatewayRead.extractGatewayFromEvent).
const GAME_TOPIC_RE = /\b(game|arena|experience)\b/;
const GAME_ZONE_TYPES = new Set(['arena']);

// _isGame(w) → true when a world should appear in the Games & experiences
// section: zoneType 'arena' OR a topic matching the game/experience keyword.
function _isGame(w) {
  if (!w || typeof w !== 'object') return false;
  if (GAME_ZONE_TYPES.has(typeof w.zoneType === 'string' ? w.zoneType : '')) return true;
  const topics = Array.isArray(w.topics) ? w.topics : [];
  for (const t of topics) {
    if (typeof t === 'string' && GAME_TOPIC_RE.test(t.toLowerCase())) return true;
  }
  return false;
}

// classifySections({ worlds, userPubkey, userContacts, ownerContacts })
//   → { friends, following, games, all }
//
//   worlds        — the sanitised online-world objects (from fetchOnlineWorlds).
//   userPubkey    — the logged-in user's hex64 pubkey ('' / absent when logged out).
//   userContacts  — Set|array of pubkeys the user follows (from their newest kind:3).
//   ownerContacts — Map<ownerPubkey, Set<followed pubkeys>> for candidate owners
//                   (each owner's newest kind:3, parsed via contactSetFromEvent).
//
// friends comes straight from partitionGatewaySections; the `arenas` half is then
// sub-partitioned into following / games / all. A world placed in `following` or
// `games` is NOT repeated in `all` (deduped by reference identity). Pure — no DOM,
// no network. Relay failures upstream just yield empty contact inputs here, so
// following degrades to empty and games/all still classify every arena.
export function classifySections({ worlds, userPubkey, userContacts, ownerContacts } = {}) {
  const base = partitionGatewaySections({ worlds, userPubkey, userContacts, ownerContacts });
  const friends = base.friends;
  const arenas = base.arenas;

  const contacts = userContacts instanceof Set
    ? userContacts
    : new Set(Array.isArray(userContacts) ? userContacts : []);
  const self = typeof userPubkey === 'string' && /^[0-9a-f]{64}$/.test(userPubkey) ? userPubkey : '';

  const following = [];
  const games = [];
  const placed = new Set(); // ref-identity dedup so a world appears in ONE of the three
  for (const w of arenas) {
    // following = arenas where the user follows the owner but it's NOT a mutual
    // (partitionGatewaySections already put mutuals in `friends`, so anything in
    // arenas that the user follows is followed-but-not-mutual by construction).
    const owner = w && typeof w.pubkey === 'string' ? w.pubkey : '';
    if (self && /^[0-9a-f]{64}$/.test(owner) && contacts.has(owner)) {
      following.push(w);
      placed.add(w);
      continue;
    }
    if (_isGame(w)) {
      games.push(w);
      placed.add(w);
    }
  }
  // all = remaining arenas not already placed in following/games.
  const all = [];
  for (const w of arenas) {
    if (!placed.has(w)) all.push(w);
  }
  return { friends, following, games, all };
}
