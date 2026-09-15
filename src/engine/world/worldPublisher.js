// engine/world/worldPublisher.js — the PUBLISH half of world-as-data.
//
// The twin of worldResolver.js: content-hash a world.json → mint the unsigned
// world-reference event (the manifest's sha256 IS its address) → then, via
// injected transports, upload the manifest to Blossom, sign the reference, and
// publish it to relays. Pure + node-safe: upload/sign/publish are injected, so
// the core is fully unit-testable and the host adapts the real uploadBlossom /
// NIP-07 signEvent / publishEvent primitives from src/nostr.js.

import { sha256Hex } from './worldResolver.js';
import { buildWorldReferenceUnsigned } from './worldReference.js';

/**
 * prepareWorldReference — the pure "mint" step. Hash the world.json and build its
 * UNSIGNED reference event. The host then signs (NIP-07) + publishes. Returns
 * { manifestHash, unsigned } or null on a non-string/empty manifest.
 */
export function prepareWorldReference({ worldJson, worldId, relays, blossomServer, version } = {}) {
  if (typeof worldJson !== 'string' || worldJson.length === 0) return null;
  const manifestHash = sha256Hex(worldJson);
  const unsigned = buildWorldReferenceUnsigned({ worldId, manifestHash, relays, blossomServer, version });
  if (!unsigned) return null;
  return { manifestHash, unsigned };
}

/**
 * publishWorldReference — end-to-end publish with injected transports, in order:
 *   1. content-hash → address
 *   2. uploadBlob(worldJson, expectedHash) → verify the returned sha256 matches ours
 *   3. signEvent(unsigned) → the reference is signed by the WORLD OWNER's key
 *   4. relayPub(signed) → publish to relays
 * Returns { ok, manifestHash, referenceEvent } and never rejects.
 *
 * @param {{ worldJson:string, worldId?:string, relays?:string[], blossomServer?:string,
 *           version?:string,
 *           uploadBlob?:(text,expectedHex)=>Promise<{ok:boolean,sha256?:string}>,
 *           signEvent?:(unsigned)=>Promise<{id?:string,sig?:string}&object>,
 *           relayPub?:(signed,relays?:string[])=>Promise<{ok:boolean}> }} args
 */
export async function publishWorldReference({
  worldJson, worldId, relays, blossomServer, version,
  uploadBlob, signEvent, relayPub,
} = {}) {
  const fail = (reason) => ({ ok: false, reason });

  const prep = prepareWorldReference({ worldJson, worldId, relays, blossomServer, version });
  if (!prep) return fail('bad-manifest');

  if (typeof uploadBlob !== 'function' || typeof signEvent !== 'function' || typeof relayPub !== 'function') {
    return fail('missing-transport');
  }

  let up = null;
  try { up = await uploadBlob(worldJson, prep.manifestHash); } catch { up = null; }
  if (!up || !up.ok) return fail('upload-failed');
  if (up.sha256 !== undefined && String(up.sha256).toLowerCase() !== prep.manifestHash) {
    return fail('hash-mismatch'); // the server stored different bytes than we addressed
  }

  let signed = null;
  try { signed = await signEvent(prep.unsigned); } catch { signed = null; }
  if (!signed || typeof signed.id !== 'string' || typeof signed.sig !== 'string') {
    return fail('sign-failed');
  }

  const pub = await Promise.resolve().then(() => relayPub(signed, relays)).catch(() => null);
  if (!pub || !pub.ok) return fail('publish-failed');

  return { ok: true, manifestHash: prep.manifestHash, referenceEvent: signed, reason: null };
}