// engine/world/worldReference.js — the world-reference event contract (world-as-data).
//
// A world is addressed by its owner's npub, not a URL. Discovery is a NIP-78
// (kind:30078) addressable event under the `torii-world` topic carrying the
// content-address (Blossom sha256) of the world.json manifest + the arena-ws
// relay(s) to join. This module defines that contract and its pure parse/build/
// filter surface — it opens no socket, signs nothing, and touches no DOM, so it
// is importable in the node test env. The resolve half (fetch-by-hash + validate)
// lives in worldResolver.js; publishing (signing + relay put) is the host's job.
//
//   event = { kind:30078, created_at, content:'', tags:[
//     ['d', <worldId>],            // addressable id (defaults 'world')
//     ['t', 'torii-world'],        // discovery topic
//     ['manifest', <sha256(world.json)>],   // the content address of the manifest
//     ['relay', <wss url>],        // arena-ws relay to join (repeatable)
//     ['blossomServer', <https>],  // optional Blossom host (default primal)
//     ['v', <world version>],      // optional version string
//     ['p', <owner npub hex>],     // canonical owner marker when the reference is
//                                   // signed by a node beacon, not the owner (ADR-0122)
//   ] }  -- signed → adds pubkey (signer hex), id, sig

export const WORLD_REF_KIND   = 30078;  // NIP-78 application data
export const WORLD_REF_TOPIC  = 'torii-world';
export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

const HEX64 = /^[0-9a-f]{64}$/i;

/** Is `v` a 64-hex sha256? (CI because signers may uppercase.) */
export function isSha256(v) {
  return typeof v === 'string' && HEX64.test(v) && v.length === 64;
}

function _tagValue(tags, name) {
  if (!Array.isArray(tags)) return undefined;
  for (const t of tags) if (Array.isArray(t) && t[0] === name) return t[1];
  return undefined;
}
function _tagAll(tags, name) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => Array.isArray(t) && t[0] === name).map((t) => t[1]);
}

// A relay URL must be ws/wss, no credentials, with a host. Fail-closed.
function _safeRelay(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}
// A Blossom server must be https (dev http), no credentials.
function _safeHttps(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}

/**
 * Build the world-reference discovery filter (kind 30078 + topic). Mirrors
 * gatewayRead.buildGatewayFilter. Pure; drops malformed options.
 */
export function buildWorldFilter({ authors = null, since = null, until = null, limit = null } = {}) {
  const filter = { kinds: [WORLD_REF_KIND], '#t': [WORLD_REF_TOPIC] };
  if (Array.isArray(authors)) {
    const clean = authors.filter((a) => typeof a === 'string' && a !== '');
    if (clean.length > 0) filter.authors = clean;
  }
  if (Number.isInteger(since)) filter.since = since;
  if (Number.isInteger(until)) filter.until = until;
  if (Number.isInteger(limit) && limit >= 0) filter.limit = limit;
  return filter;
}

/**
 * Parse a signed world-reference event into a clean model, or null on any
 * failure (fail-closed). The caller still verifies the signature where it has
 * the relay's raw event; this maps shape → model and never trusts markup.
 */
export function parseWorldReference(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.kind !== WORLD_REF_KIND) return null;
  if (!isSha256(event.pubkey)) return null;
  if (!Array.isArray(event.tags)) return null;

  const manifestHash = _tagValue(event.tags, 'manifest');
  if (!isSha256(manifestHash)) return null;

  const worldId = _tagValue(event.tags, 'd');
  const relays = _tagAll(event.tags, 'relay').map(_safeRelay).filter(Boolean);
  const blossomServer = _safeHttps(_tagValue(event.tags, 'blossomServer'));
  const version = _tagValue(event.tags, 'v');

  // ADR-0122: owner attribution — a beacon-signed reference carries a canonical
  // `p` tag naming the owner; a client-signed reference is its own owner (the
  // signer pubkey). Either way, `owner` is the hex64 npub a directory row keys on.
  const pTag = _tagValue(event.tags, 'p');
  const owner = isSha256(pTag) && String(pTag).toLowerCase() !== String(event.pubkey).toLowerCase()
    ? String(pTag).toLowerCase()
    : String(event.pubkey).toLowerCase();

  // A reference without either a relay OR a Blossom server is unusable.
  if (relays.length === 0 && !blossomServer) return null;

  return {
    pubkey: event.pubkey,
    owner,
    worldId: typeof worldId === 'string' && worldId.trim() !== '' ? worldId.trim() : 'world',
    manifestHash: manifestHash.toLowerCase(),
    relays,
    blossomServer,
    version: typeof version === 'string' && version.trim() !== '' ? version.trim() : null,
    createdAt: Number.isInteger(event.created_at) ? event.created_at : 0,
  };
}

/**
 * Build the UNSIGNED world-reference event (publish side parallel to
 * buildTravelUnsigned). The host signs it (NIP-07) and publishes to relays.
 * Returns null when the manifestHash is missing/malformed. Pure.
 */
export function buildWorldReferenceUnsigned({
  worldId = 'world',
  manifestHash,
  relay,
  relays,
  blossomServer,
  version,
  owner,
  nowMs = Date.now(),
} = {}) {
  if (!isSha256(manifestHash)) return null;
  const tags = [
    ['d', worldId ? String(worldId) : 'world'],
    ['t', WORLD_REF_TOPIC],
    ['manifest', String(manifestHash).toLowerCase()],
  ];
  const list = (Array.isArray(relays) ? relays : (typeof relay === 'string' && relay ? [relay] : []))
    .map(_safeRelay).filter(Boolean);
  for (const r of list) tags.push(['relay', r]);
  const bs = _safeHttps(blossomServer);
  if (bs) tags.push(['blossomServer', bs]);
  if (typeof version === 'string' && version.trim() !== '') tags.push(['v', version.trim()]);
  // ADR-0122: a reference may be signed by a node beacon rather than the owner,
  // so stamp the canonical owner marker (mirrors presence's `["p", <admin>]`) so
  // npub-based discovery can still attribute it. Omitted when absent/unparseable.
  const ownerHex = isSha256(owner) ? String(owner).toLowerCase() : null;
  if (ownerHex) tags.push(['p', ownerHex]);
  return { kind: WORLD_REF_KIND, created_at: Math.floor(nowMs / 1000), content: '', tags };
}