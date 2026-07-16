// engine/gateway/gatewaySections.js — pure partitioning for the gateway card's
// two sections: "your friends" and "arenas" (v0.2.403-alpha).
//
// A world is a FRIEND when its owner is a MUTUAL follow of the logged-in user:
// the user follows the owner AND the owner follows the user back. Everything else
// — followed-but-not-mutual, strangers, and the logged-out case — is an ARENA.
// The user's own world is excluded from both (you cannot travel to yourself).
//
// Pure + node-safe: NO DOM, NO network, NO I/O of its own. The host (main.js)
// fetches the kind:3 contact lists over the injected nostr transport and feeds the
// parsed events in here; this module only classifies + sorts. Mirrors the existing
// pure-layer pattern (worldPresence.js / gatewayRead.js).

const HEX64 = /^[0-9a-f]{64}$/;
const isHex64 = (v) => typeof v === 'string' && HEX64.test(v);

// Max rows drawn per section before the "+N more" overflow summary.
export const SECTION_ROW_CAP = 12;

// contactSetFromEvent(event) → a Set of the hex64 pubkeys a kind:3 event follows
// (its `p` tags). Pure; tolerates malformed input and returns an empty Set.
export function contactSetFromEvent(event) {
  const set = new Set();
  if (!event || !Array.isArray(event.tags)) return set;
  for (const t of event.tags) {
    if (Array.isArray(t) && t[0] === 'p' && isHex64(t[1])) set.add(t[1]);
  }
  return set;
}

// newestContactEvent(events, author) → the newest (max created_at) kind:3 event
// authored by `author`, or null. kind:3 is a replaceable event, so only the newest
// counts. Pure; never throws.
export function newestContactEvent(events, author) {
  if (!Array.isArray(events) || !isHex64(author)) return null;
  let best = null;
  let bestTs = -1;
  for (const e of events) {
    if (!e || e.kind !== 3 || e.pubkey !== author) continue;
    const ts = Number.isFinite(e.created_at) ? e.created_at : -1;
    if (best === null || ts > bestTs) { best = e; bestTs = ts; }
  }
  return best;
}

// candidateFriendOwners({ worlds, userContacts, userPubkey }) → the online-world
// owner pubkeys the user already follows (intersection of world owners with the
// user's contact set), excluding the user's own pubkey and de-duplicated. These
// are the ONLY owners whose kind:3 needs a second fetch to confirm a mutual. Pure.
export function candidateFriendOwners({ worlds, userContacts, userPubkey } = {}) {
  const contacts = userContacts instanceof Set
    ? userContacts
    : new Set(Array.isArray(userContacts) ? userContacts : []);
  const self = isHex64(userPubkey) ? userPubkey : '';
  const out = [];
  const seen = new Set();
  for (const w of Array.isArray(worlds) ? worlds : []) {
    const owner = w && typeof w.pubkey === 'string' ? w.pubkey : '';
    if (!isHex64(owner) || owner === self || seen.has(owner)) continue;
    if (!contacts.has(owner)) continue;
    seen.add(owner);
    out.push(owner);
  }
  return out;
}

// partitionGatewaySections({ worlds, userPubkey, userContacts, ownerContacts })
//   → { friends, arenas }
//
//   worlds        — the sanitised online-world objects (from fetchOnlineWorlds).
//   userPubkey    — the logged-in user's hex64 pubkey ('' / absent when logged out).
//   userContacts  — Set|array of pubkeys the user follows (from their newest kind:3).
//   ownerContacts — Map<ownerPubkey, Set<followed pubkeys>> for candidate owners
//                   (each owner's newest kind:3, parsed via contactSetFromEvent).
//
// friends = mutual-follow worlds; arenas = everything else. Own world excluded from
// both. Both lists sorted by created_at DESC (latest signal first = liveness proxy).
// Pure — no DOM, no network. Relay failures upstream just yield empty contact
// inputs here, so friends degrades to empty and arenas still gets every world.
export function partitionGatewaySections({ worlds, userPubkey, userContacts, ownerContacts } = {}) {
  const self = isHex64(userPubkey) ? userPubkey : '';
  const contacts = userContacts instanceof Set
    ? userContacts
    : new Set(Array.isArray(userContacts) ? userContacts : []);
  const owners = ownerContacts instanceof Map ? ownerContacts : new Map();
  const friends = [];
  const arenas = [];
  for (const w of Array.isArray(worlds) ? worlds : []) {
    const owner = w && typeof w.pubkey === 'string' ? w.pubkey : '';
    if (self && isHex64(owner) && owner === self) continue; // own world: not travelable
    let isFriend = false;
    if (self && isHex64(owner) && contacts.has(owner)) {
      const back = owners.get(owner);
      if (back instanceof Set && back.has(self)) isFriend = true;
    }
    (isFriend ? friends : arenas).push(w);
  }
  const byCreatedDesc = (a, b) => (Number(b && b.created_at) || 0) - (Number(a && a.created_at) || 0);
  friends.sort(byCreatedDesc);
  arenas.sort(byCreatedDesc);
  return { friends, arenas };
}
