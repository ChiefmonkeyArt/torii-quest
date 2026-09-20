// engine/world/worldResolver.js — the RESOLVE half of world-as-data.
//
// Given a SIGNED world-reference event (see worldReference.js), verify its
// signature, fetch the world.json by its content address (Blossom
// `<server>/<sha256>`), verify the bytes hash to the claimed address, and validate
// them into a renderable world. Given a world's npub, discover that reference from
// relays first. This is the portal-client seam: the host renders the returned
// `world` with the existing worldRenderer and joins the returned `relays` — no
// navigation, no iframe, address bar unchanged.
//
// PURE + node-safe CORE: every transport is injected (fetchBlob, relayReqFn), no
// DOM, no window, no WebSocket, no NIP-07. Fully unit-testable in node.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { npubToHex } from '../crypto/npub.js';
import { verifyNostrEventSig } from '../crypto/nostrSig.js';
import { validateWorld } from './worldSchema.js';
import {
  parseWorldReference, buildWorldFilter, DEFAULT_BLOSSOM_SERVER,
} from './worldReference.js';

const HEX64 = /^[0-9a-f]{64}$/i;
const _enc = new TextEncoder();

/** sha256 of a UTF-8 string → lowercase hex. Exported for the publish side. */
export function sha256Hex(text) {
  return bytesToHex(sha256(_enc.encode(String(text))));
}

/**
 * Resolve a SIGNED world-reference event into a validated world. Transport injected.
 *
 * @param {{ referenceEvent:object, fetchBlob?:(url:string)=>Promise<string|null>,
 *           blossomServer?:string }} args
 *   fetchBlob(url) → raw body text, or null on failure (injected; default fetch-text).
 * @returns {Promise<{ok:boolean, world?:object, manifestHash?:string, relays?:string[],
 *                    source?:string, version?:string|null, reason?:string|null}>}
 *   Never rejects.
 */
export async function resolveWorldReference({ referenceEvent, fetchBlob, blossomServer } = {}) {
  const fail = (reason) => ({ ok: false, reason });
  if (!referenceEvent || typeof referenceEvent !== 'object') return fail('bad-reference');
  // Trust boundary: the reference must carry a valid signature (rejecting relay
  // forgery/tampering). Ownership (author vs beacon) is attributed by the caller
  // at discovery (ADR-0122): a client-signed reference is its own owner; a
  // beacon-signed reference names its owner via the `p` tag. Fail-closed here
  // before touching any network.
  if (!verifyNostrEventSig(referenceEvent)) return fail('bad-sig');

  const ref = parseWorldReference(referenceEvent);
  if (!ref) return fail('bad-reference');

  const server = (ref.blossomServer
    || (typeof blossomServer === 'string' && blossomServer.trim() !== '' ? blossomServer.trim() : null)
    || DEFAULT_BLOSSOM_SERVER).replace(/\/+$/, '');
  const url = `${server}/${ref.manifestHash}`;

  const fetchFn = typeof fetchBlob === 'function' ? fetchBlob : _defaultFetchBlob;
  let text;
  try { text = await fetchFn(url); } catch { text = null; }
  if (typeof text !== 'string') return fail('fetch-failed');

  // Content-integrity: the bytes must hash to the claimed address, or reject.
  if (sha256Hex(text) !== ref.manifestHash.toLowerCase()) return fail('hash-mismatch');

  let json;
  try { json = JSON.parse(text); } catch { return fail('bad-json'); }
  if (json == null || typeof json !== 'object' || Array.isArray(json)) return fail('bad-json');

  const v = validateWorld(json);
  if (!v.ok) return fail('invalid-world');

  return {
    ok: true,
    world: v.world,
    manifestHash: ref.manifestHash,
    relays: ref.relays,
    source: ref.worldId,
    version: ref.version,
    reason: null,
  };
}

/**
 * Discover the newest valid (signature-verified + parseable) world-reference RAW
 * event for a hex pubkey across relays. Returns the raw signed event, or null.
 *
 * ADR-0122: the reference may be signed by a node beacon rather than the owner,
 * so the topic filter is NOT scoped to `authors:[pubkeyHex]`. Every candidate is
 * signature-verified + parsed, then attributed to `pubkeyHex` when its signer
 * (`event.pubkey`) OR one of its `p` tags matches. Newest attributed event wins.
 *
 * @param {{ pubkeyHex:string, relays?:string[],
 *           relayReqFn?:(url:string,filters:object,opts?:object)=>Promise<{ok:boolean,events:any[]}> }} args
 */
export async function discoverWorldReference({ pubkeyHex, relays = [], relayReqFn } = {}) {
  if (!HEX64.test(pubkeyHex || '')) return null;
  if (typeof relayReqFn !== 'function') return null;
  const hex = pubkeyHex.toLowerCase();
  // Topic-only filter (no authors) so beacon-signed references are not missed.
  const filter = buildWorldFilter({ limit: 200 });

  const tasks = (Array.isArray(relays) && relays.length ? relays : [''])
    .map((url) => Promise.resolve().then(() => relayReqFn(url, filter)).catch(() => ({ ok: false, events: [] })));
  const results = await Promise.all(tasks);

  const _attributed = (evt) => {
    if (!evt || typeof evt !== 'object') return false;
    if (typeof evt.pubkey === 'string' && evt.pubkey.toLowerCase() === hex) return true;
    if (Array.isArray(evt.tags)) {
      for (const t of evt.tags) {
        if (Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string' && t[1].toLowerCase() === hex) return true;
      }
    }
    return false;
  };

  let best = null;
  for (const r of results) {
    const events = r && Array.isArray(r.events) ? r.events : [];
    for (const evt of events) {
      if (!evt || evt.kind !== 30078) continue;
      if (!verifyNostrEventSig(evt)) continue;           // reject relay garbage/forgery
      if (!parseWorldReference(evt)) continue;           // reject malformed
      if (!_attributed(evt)) continue;                   // must be owned by hex (author or p-tag)
      if (!best || (evt.created_at || 0) > (best.created_at || 0)) best = evt;
    }
  }
  return best;
}

/**
 * Resolve a world by npub end-to-end: discover its signed reference from relays
 * (or use a supplied referenceEvent), then fetch + validate. The host entry point.
 *
 * @param {{ npub?:string, pubkeyHex?:string, referenceEvent?:object, relays?:string[],
 *           fetchBlob?:Function, relayReqFn?:Function, blossomServer?:string }} args
 */
export async function resolveWorldByNpub({
  npub, pubkeyHex, referenceEvent, relays = [], fetchBlob, relayReqFn, blossomServer,
} = {}) {
  const fail = (reason) => ({ ok: false, reason });
  let evt = referenceEvent;

  if (!evt) {
    let hex = (typeof pubkeyHex === 'string' && pubkeyHex) ? pubkeyHex : '';
    if (!HEX64.test(hex) && typeof npub === 'string' && npub) {
      try { hex = npubToHex(npub); } catch { hex = ''; }
    }
    if (!HEX64.test(hex)) return fail('bad-npub');
    evt = await discoverWorldReference({ pubkeyHex: hex, relays, relayReqFn });
    if (!evt) return fail('no-reference');
  }

  return resolveWorldReference({ referenceEvent: evt, fetchBlob, blossomServer });
}

// Default fetchBlob: fetch → text, or null. Browser/global fetch only; injected in
// tests and by the host so the pure core never imports a transport.
function _defaultFetchBlob(url) {
  return Promise.resolve().then(() => fetch(url)).then((r) => {
    if (!r || !r.ok) return null;
    return typeof r.text === 'function' ? r.text() : null;
  }).catch(() => null);
}