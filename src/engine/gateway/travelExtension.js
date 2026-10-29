// travelExtension.js — Gate v1 §8 extension "world + travel" (v0.2.937, ADR-0147 M3).
//
// A heartbeat MAY say which world description it serves and which travel modes it
// supports, so a reader knows how to travel without guessing:
//
//   ["world",  "<worldId>"]                 0..4 tags; the owner's `torii-world`
//                                           reference `d` value (content.worlds mirrors)
//   ["travel", "enter", "visit"]            one tag; modes it supports (content.travel mirrors)
//
//   enter  build the world in place from its signed, hash-checked description (Torii)
//   visit  open the heartbeat's `website` (the Gate v1 hand-off; §3.7 still applies)
//
// Tags win over content (content is unsigned-by-structure JSON, like `ws`). Unknown
// modes are ignored. The extension is a HINT: `enter` still needs the reference's
// signature + manifest hash to verify, and `visit` still needs a travellable website.
// No extension → `travel: null` (unknown): the reader may look the world up, as before.
// Pure, never throws.

export const TRAVEL_MODES = Object.freeze(['enter', 'visit']);
const WORLD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_WORLDS = 4;

function _ids(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (typeof v === 'string' && WORLD_ID.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_WORLDS) break;
  }
  return out;
}
function _modes(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (TRAVEL_MODES.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

// readTravelExtension(tags, content) → { worlds: string[], travel: string[] | null }
export function readTravelExtension(tags, content) {
  const t = Array.isArray(tags) ? tags : [];
  const c = content && typeof content === 'object' ? content : {};
  const worldTags = t.filter((x) => Array.isArray(x) && x[0] === 'world').map((x) => x[1]);
  const worlds = worldTags.length ? _ids(worldTags) : _ids(c.worlds);
  const travelTag = t.find((x) => Array.isArray(x) && x[0] === 'travel');
  const travel = travelTag ? _modes(travelTag.slice(1)) : (Array.isArray(c.travel) ? _modes(c.travel) : null);
  return { worlds, travel };
}

// effectiveTravelModes(record) → modes a reader can actually use, or null (unknown).
// `visit` needs a travellable website (Gate v1 §3.7).
export function effectiveTravelModes(g) {
  if (!g || !Array.isArray(g.travel)) return null;
  return g.travel.filter((m) => m !== 'visit' || !!g.website);
}

// travelExtensionFor({ worlds, travel, website }) → { tags, content } for a writer.
// Drops `visit` without a website; returns empty when nothing is known.
export function travelExtensionFor({ worlds = [], travel = null, website = '' } = {}) {
  const ids = _ids(worlds);
  if (!Array.isArray(travel)) return { tags: ids.map((id) => ['world', id]), content: ids.length ? { worlds: ids } : {} };
  const modes = _modes(travel).filter((m) => m !== 'visit' || !!website);
  return {
    tags: [...ids.map((id) => ['world', id]), ['travel', ...modes]],
    content: { ...(ids.length ? { worlds: ids } : {}), travel: modes },
  };
}
