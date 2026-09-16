// server/world/blossomUpload.js — node-safe Blossom (BUD-11) manifest upload for
// the beacon's world-reference publish (ADR-0119 slice 4).
//
// The twin of the browser `uploadBlossom` in src/nostr.js, but text-based and
// transport-injected: it signs a scoped upload auth (kind 24242, `x` = the blob's
// sha256) with the CALLER's signEvent, PUTs the manifest to `<server>/upload`, and
// verifies the returned address. No NIP-07, no Blob, no window — pure + node-safe,
// fully unit-testable with a fake signer + fetch.
//
// BUD-11: the auth token's `x` tag MUST scope the upload to the exact blob's
// sha256, so the token and the uploaded bytes are provably the same content.

export const BLOSSOM_AUTH_KIND = 24242;
export const BLOSSOM_AUTH_TTL_S = 300;

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * buildBlossomAuthEvent — the UNSIGNED Blossom upload auth event. Pure; mirrors
 * the browser buildBlossomAuthEvent in src/nostr.js. `sha256` is the lowercase
 * hex of the blob being uploaded (REQUIRED so the token is scoped to that blob).
 */
export function buildBlossomAuthEvent({ server, method = 'PUT', sha256, createdAt, expiration } = {}) {
  const base = typeof server === 'string' ? server.replace(/\/+$/, '') : '';
  const now = Number.isInteger(createdAt) ? createdAt : Math.floor(Date.now() / 1000);
  const exp = Number.isInteger(expiration) ? expiration : now + BLOSSOM_AUTH_TTL_S;
  const tags = [['t', 'upload']];
  if (typeof sha256 === 'string' && HEX64.test(sha256)) tags.push(['x', sha256.toLowerCase()]);
  tags.push(['expiration', String(exp)]);
  tags.push(['u', `${base}/upload`], ['method', String(method || 'PUT').toUpperCase()]);
  return { kind: BLOSSOM_AUTH_KIND, created_at: now, tags, content: 'Upload Blob' };
}

function _b64(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  if (typeof btoa === 'function') return btoa(str);
  return '';
}

/**
 * uploadBlossomText({ text, server, expectedHex, signEvent, fetchImpl, nowMs }) →
 *   Promise<{ ok, sha256, url, error }>. Uploads `text` to `<server>/upload` with a
 * `Nostr <b64(signed auth)>` Authorization header scoped to `expectedHex`. Never
 * throws. `signEvent` must return a fully-signed event {kind, pubkey, id, sig, …}.
 */
export async function uploadBlossomText({ text, server, expectedHex, signEvent, fetchImpl, nowMs } = {}) {
  const out = { ok: false, sha256: null, url: null, error: null };
  const s = (typeof server === 'string' && server.trim() ? server.trim() : '').replace(/\/+$/, '');
  if (!s) { out.error = 'server-required'; return out; }
  if (typeof text !== 'string') { out.error = 'text-required'; return out; }
  if (typeof signEvent !== 'function') { out.error = 'sign-required'; return out; }
  if (typeof fetchImpl !== 'function') { out.error = 'fetch-required'; return out; }
  if (!HEX64.test(expectedHex || '')) { out.error = 'bad-expected-hex'; return out; }

  const created = Number.isFinite(nowMs) ? Math.floor(nowMs / 1000) : Math.floor(Date.now() / 1000);
  let signed;
  try { signed = await signEvent(buildBlossomAuthEvent({ server: s, sha256: expectedHex, createdAt: created })); }
  catch { out.error = 'sign-threw'; return out; }
  if (!signed || typeof signed.id !== 'string' || typeof signed.sig !== 'string') { out.error = 'sign-failed'; return out; }

  const authHeader = 'Nostr ' + _b64(JSON.stringify(signed));
  let res;
  try {
    res = await fetchImpl(`${s}/upload`, {
      method: 'PUT',
      headers: { Authorization: authHeader, 'X-SHA-256': expectedHex.toLowerCase() },
      body: text,
    });
  } catch { out.error = 'upload-threw'; return out; }
  if (!res || !res.ok) { out.error = 'upload-http-' + (res && res.status ? res.status : 'err'); return out; }

  let data;
  try { data = await res.json(); } catch { out.error = 'bad-response'; return out; }
  const sha = data && (data.sha256 || (data.url && String(data.url).split('/').pop()));
  if (!sha || !HEX64.test(sha)) { out.error = 'no-sha256'; return out; }
  out.sha256 = String(sha).toLowerCase();
  out.url = data.url || `${s}/${out.sha256}`;
  out.ok = true;
  return out;
}