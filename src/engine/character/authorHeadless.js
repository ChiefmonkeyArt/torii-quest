// engine/character/authorHeadless.js — client-side wrapper around the
// POST /mp/character/headless endpoint (v0.2.767-alpha). The server authors a
// headless FP-body variant of an uploaded/AI-generated GLB in-memory and hands
// back the resulting bytes + sha256 so the browser can upload them to Blossom
// under its OWN NIP-98 auth as a normal second Blossom PUT.
//
// The server never signs, never stores the file, never keeps the token in a
// log — the token is only used to authenticate the authoring request itself.
//
// Pure at the edges (fetch, sessionStorage) but every edge is INJECTABLE so
// this stays unit-testable with fakes. Never throws.

import { resolveMpHttpBase, getStoredToken } from '../multiplayer/sessionAuth.js';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * requestHeadlessVariant(file, opts) → Promise<{ ok, blob, sha256, error, detail }>
 *
 * @param {Blob|File} file — the FULL player GLB (raw bytes are sent as the body).
 * @param {object} [opts]
 * @param {typeof fetch}  [opts.fetchImpl]   default globalThis.fetch
 * @param {string}        [opts.httpBase]    override the WS-derived base
 * @param {string}        [opts.token]       override the stored session bearer
 * @returns {Promise<{ok:boolean, blob:Blob|null, sha256:string|null, error:string|null, detail:string|null}>}
 */
export async function requestHeadlessVariant(file, opts = {}) {
  const out = { ok: false, blob: null, sha256: null, error: null, detail: null };
  const fetchImpl = typeof opts.fetchImpl === 'function'
    ? opts.fetchImpl
    : (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  if (typeof fetchImpl !== 'function') { out.error = 'fetch-unavailable'; return out; }
  if (!file || (typeof file.arrayBuffer !== 'function' && !(typeof Blob !== 'undefined' && file instanceof Blob))) {
    out.error = 'file-required'; return out;
  }
  const httpBase = typeof opts.httpBase === 'string' && opts.httpBase
    ? opts.httpBase
    : resolveMpHttpBase();
  if (typeof httpBase !== 'string' || !httpBase) { out.error = 'no-http-base'; return out; }
  const token = typeof opts.token === 'string' && opts.token ? opts.token : getStoredToken();
  if (typeof token !== 'string' || !token) { out.error = 'no-session-token'; return out; }

  let res;
  try {
    res = await fetchImpl(`${httpBase}/character/headless`, {
      method: 'POST',
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Authorization': `Bearer ${token}`,
      },
      body: file,
    });
  } catch { out.error = 'network-failed'; return out; }
  if (!res) { out.error = 'no-response'; return out; }

  if (!res.ok) {
    // JSON error body (server sends {ok:false, error, detail?}).
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON — leave null */ }
    out.error = (body && body.error) || `http-${res.status}`;
    out.detail = (body && body.detail) || null;
    return out;
  }

  // Binary GLB body + sha256 header.
  const sha = res.headers && res.headers.get ? res.headers.get('x-headless-sha256') : null;
  if (!sha || !HEX64.test(sha.toLowerCase())) { out.error = 'no-sha256-header'; return out; }
  let blob;
  try { blob = await res.blob(); } catch { out.error = 'blob-failed'; return out; }
  if (!blob || (typeof blob.size === 'number' && blob.size === 0)) { out.error = 'empty-body'; return out; }

  out.ok = true;
  out.blob = blob;
  out.sha256 = sha.toLowerCase();
  return out;
}
