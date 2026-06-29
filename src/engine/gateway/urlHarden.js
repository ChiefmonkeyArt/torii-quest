// engine/gateway/urlHarden.js — SEC-3 product URL hardening (v0.2.253, P2).
// THE gate that must clear BEFORE any armed spawn URL becomes navigable in the
// n2n hop. Pure + node-safe: NO DOM, NO navigation, NO network. It only
// structurally validates + re-emits a canonical safe URL string. The host
// (main.js) performs the actual navigation, and ONLY when hardenSpawnUrl returns
// ok:true — and only after SEC-2 (signed accept from a matched host) already did.
//
// Threat model this closes:
//   - javascript: / data: / http: schemes (only https: survives)
//   - credential exfil via https://user:pass@host/ (rejected)
//   - redirects to localhost / loopback / RFC1918 private ranges (rejected by
//     default; allowPrivate:true opts back in for local dev)
//   - oversized / unparseable URLs (rejected)
//   - optional host allowlist for strict deployments that know their peers
//
// Constrained by construction: returns a plain {ok,url,errors} object. Never
// throws. A failure never yields a url. The caller treats !ok as "do not jump".

const MAX_URL_LEN = 2048;

// Private / loopback host detection — reject by default so a crafted spawn URL
// can't redirect a traveller to 127.0.0.1 / localhost / internal ranges. Covers
// IPv4 loopback + RFC1918 + link-local + IPv6 loopback + ULA + link-local v6.
const _PRIVATE_HOST =
  /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fe80:|fc00:|fd)/i;

// hardenSpawnUrl(raw, opts?) → { ok, url, errors }. Pure; never throws.
//   opts.allowHosts   — string[]; if present, hostname must match one (case-insensitive)
//   opts.allowPrivate — boolean; if true, private/loopback hosts are permitted (dev only)
export function hardenSpawnUrl(raw, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const out = { ok: false, url: null, errors: [] };
  if (typeof raw !== 'string' || raw.length === 0) { out.errors.push('url-required'); return out; }
  if (raw.length > MAX_URL_LEN) { out.errors.push('url-too-long'); return out; }
  let u;
  try { u = new URL(raw); } catch { out.errors.push('url-unparseable'); return out; }
  if (u.protocol !== 'https:') { out.errors.push('scheme-must-be-https'); return out; }
  if (!u.hostname) { out.errors.push('hostname-required'); return out; }
  if (u.username || u.password) { out.errors.push('no-credentials-in-url'); return out; }
  // Optional explicit allowlist — strict deployments list their peer hosts.
  const allow = Array.isArray(o.allowHosts)
    ? o.allowHosts.filter((h) => typeof h === 'string').map((h) => h.toLowerCase())
    : null;
  if (allow) {
    const host = u.hostname.toLowerCase();
    if (!allow.includes(host)) { out.errors.push('host-not-allowlisted'); return out; }
  } else if (o.allowPrivate !== true && _PRIVATE_HOST.test(u.hostname)) {
    out.errors.push('private-host-rejected'); return out;
  }
  // Re-emit the canonical https URL (drops any stray credentials, normalises).
  out.url = u.href;
  out.ok = true;
  return out;
}

// appendTraveller(url, pubkey) → appends the traveller's hex pubkey as a query
// param so the destination host can identify the arriving player. Pure; rejects
// a non-hex64 pubkey (returns ok:false with an error). Never throws.
export function appendTraveller(url, pubkey) {
  const out = { ok: false, url: null, error: null };
  if (typeof url !== 'string' || url.length === 0) { out.error = 'url-required'; return out; }
  if (!/^[0-9a-f]{64}$/.test(pubkey || '')) { out.error = 'bad-pubkey'; return out; }
  let u;
  try { u = new URL(url); } catch { out.error = 'url-unparseable'; return out; }
  u.searchParams.set('torii-traveller', pubkey);
  out.url = u.href;
  out.ok = true;
  return out;
}
