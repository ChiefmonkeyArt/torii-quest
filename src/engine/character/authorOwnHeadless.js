// engine/character/authorOwnHeadless.js — author the LOCAL player's own headless
// FP-body variant ON DEMAND when their kind-35100 manifest has a mesh but no
// `mesh.headlessHash` (a legacy manifest that predates v0.2.767 headless authoring).
//
// This is the fix for "a second real player sees chiefmonkey's feet": the
// v0.2.803 login fix forced `_pendingGuestChar = 'chiefmonkey'` for EVERY logged-in
// player, so a player whose manifest lacks a headlessHash fell back to
// FP_BODIES['chiefmonkey'] = chiefmonkey's own headless GLB. That assumed every
// logged-in player IS chiefmonkey — wrong for multiplayer.
//
// Instead, when a logged-in player has their own mesh but no headlessHash, we:
//   1. fetch their own full mesh GLB from its Blossom URL,
//   2. author a headless variant of THAT mesh via the session-gated
//      POST /mp/character/headless endpoint (reuses the login session token — no
//      new NIP-07 signer prompt),
//   3. hand the result back as a session-local object URL for the FP body.
//
// This is deliberately SESSION-LOCAL (no Blossom upload, no manifest republish):
// persisting the variant would need two further NIP-07 signer prompts (Blossom
// BUD-11 auth + kind-35100 event sign), which violates the "1 sign at login, 0
// signs in-game" invariant. The authoring re-runs per login and is bounded by the
// server's per-pubkey concurrency gate. See ADR-0120 for the session-token model.
//
// Pure at the edges (fetch, requestHeadlessVariant, URL.createObjectURL are all
// injectable) so this stays unit-testable with fakes. Never throws.

import { requestHeadlessVariant } from './authorHeadless.js';

/**
 * authorOwnHeadless({ meshUrl, ...deps }) → Promise<{ ok, url, error, detail }>
 *
 * Fetch the player's own full mesh GLB, author its headless variant, and return a
 * session-local object URL for it. `url` is `blob:` — it must be revoked by the
 * caller when it is replaced (see revokeHeadlessUrl) to avoid leaking object URLs
 * across hot-swaps.
 *
 * @param {object} args
 * @param {string} args.meshUrl       full mesh GLB URL (a Blossom sha256 URL)
 * @param {typeof fetch} [args.fetchImpl]      default globalThis.fetch
 * @param {Function} [args.requestHeadless]    default requestHeadlessVariant
 * @param {(b:Blob)=>string} [args.createObjectUrl]  default URL.createObjectURL
 * @returns {Promise<{ok:boolean, url:string|null, error:string|null, detail:string|null}>}
 */
export async function authorOwnHeadless({ meshUrl, fetchImpl, requestHeadless, createObjectUrl } = {}) {
  const out = { ok: false, url: null, error: null, detail: null };
  const fetchFn = typeof fetchImpl === 'function'
    ? fetchImpl
    : (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  const author = typeof requestHeadless === 'function' ? requestHeadless : requestHeadlessVariant;
  const makeUrl = typeof createObjectUrl === 'function'
    ? createObjectUrl
    : (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? (b) => URL.createObjectURL(b) : undefined);

  if (typeof fetchFn !== 'function') { out.error = 'fetch-unavailable'; return out; }
  if (typeof author !== 'function') { out.error = 'author-unavailable'; return out; }
  if (typeof makeUrl !== 'function') { out.error = 'object-url-unavailable'; return out; }
  if (typeof meshUrl !== 'string' || !meshUrl) { out.error = 'no-mesh-url'; return out; }

  // 1. Fetch the player's own full mesh GLB.
  let meshBlob = null;
  try {
    const res = await fetchFn(meshUrl);
    if (!res || !res.ok) { out.error = 'mesh-fetch-http-' + (res ? res.status : 'err'); return out; }
    meshBlob = await res.blob();
  } catch { out.error = 'mesh-fetch-failed'; return out; }
  if (!meshBlob || (typeof meshBlob.size === 'number' && meshBlob.size === 0)) {
    out.error = 'mesh-empty'; return out;
  }

  // 2. Author the headless variant (session token lives in sessionStorage).
  const headless = await author(meshBlob);
  if (!headless || !headless.ok || !headless.blob) {
    out.error = (headless && headless.error) || 'author-failed';
    out.detail = (headless && headless.detail) || null;
    return out;
  }

  // 3. Session-local object URL.
  let url = null;
  try { url = makeUrl(headless.blob); } catch { url = null; }
  if (typeof url !== 'string' || !url) { out.error = 'object-url-failed'; return out; }

  out.ok = true;
  out.url = url;
  return out;
}

/**
 * revokeHeadlessUrl(url) → void. Release a previously-created headless object URL.
 * Idempotent + safe for null/undefined/non-blob URLs (Blossom https URLs and
 * repo-relative asset paths are never revoked — only `blob:` URLs).
 */
export function revokeHeadlessUrl(url) {
  if (typeof url !== 'string' || !url || url.indexOf('blob:') !== 0) return;
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try { URL.revokeObjectURL(url); } catch { /* noop */ }
}