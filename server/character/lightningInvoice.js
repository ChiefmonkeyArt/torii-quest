// server/character/lightningInvoice.js — a pure, injectable LNURL-pay client
// for the paid character-creation flow (milestone: hosted Lightning address +
// NIP-57 zaps; P0 uses raw LNURL-pay invoice + verify). SERVER-SIDE ONLY: it
// mints BOLT11 invoices from the OPERATOR's hosted lightning address (`lud16`)
// and confirms settlement, so the operator's Meshy credits are only spent once
// a visitor has actually paid. Node-safe: every network call crosses an
// injected `fetchFn` (default globalThis.fetch) and the whole surface is
// unit-testable with zero network. Never throws.
//
// LNURL-pay (LUD-06) grounding:
//   resolve  GET  https://{domain}/.well-known/lnurlp/{user}
//            →  { callback, minSendable, maxSendable, tag:"payRequest", ... }  (millisats)
//   mint     GET  {callback}?amount={msats}
//            →  { pr, ... }   (a BOLT11 invoice; some servers also return `verify`)
//
//   verify   LUD-06 does NOT define a universal payee-side settle check. The
//            de-facto lnurlpay/lnbits convention is to re-query the callback
//            with the invoice:  GET {callback}?pr={pr}  →  { settled, preimage }.
//            A `verify` URL returned by the mint (`verifyUrl`) takes precedence.
//            This path is operator-tunable and FAIL-CLOSED: anything that is not
//            an explicit `{ settled: true }` is treated as unpaid (so a flaky
//            verify can never yield a free generation — it can only block one).
//
// Amounts are millisats on the wire; the public API is integer sats.

export const LIGHTNING_INVOICE_VERSION = 1;

// _msats(sats) → a non-negative integer millisat amount.
function _msats(sats) {
  const s = Math.max(0, Math.round(Number(sats) || 0));
  if (!Number.isFinite(s)) return 0;
  return s * 1000;
}

// _parts(lud16) → { user, domain } | null. Accepts `user@domain` only.
function _parts(lud16) {
  if (typeof lud16 !== 'string') return null;
  const at = lud16.lastIndexOf('@');
  if (at <= 0 || at === lud16.length - 1) return null;
  const user = lud16.slice(0, at).trim();
  const domain = lud16.slice(at + 1).trim();
  if (!user || !domain) return null;
  return { user, domain };
}

// _json(res) / _text(res) — safe response readers (never throw).
async function _json(res) { try { return await res.json(); } catch { return {}; } }
async function _text(res) { try { return await res.text(); } catch { return ''; } }

// _buildVerifyUrl(callback, pr, hint) → the verify URL to attempt, or null.
// Prefers an explicit `hint` (a `verify` field from the mint); else the lnurlpay
// fallback `${callback}?pr=${pr}`.
function _buildVerifyUrl(callback, pr, hint) {
  if (typeof hint === 'string' && hint) return hint;
  if (typeof callback !== 'string' || !callback) return null;
  const sep = callback.indexOf('?') === -1 ? '?' : '&';
  return `${callback}${sep}pr=${encodeURIComponent(pr)}`;
}

/**
 * createLightningInvoice({ fetchFn }) → {
 *   resolveLightningAddress(lud16),
 *   mintInvoice({ lud16, amountSats }),
 *   verifySettled({ lud16, pr, verifyUrl }),
 * }
 */
export function createLightningInvoice({ fetchFn = (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined) } = {}) {
  const fetch = (typeof fetchFn === 'function') ? fetchFn : undefined;

  async function resolveLightningAddress(lud16) {
    const out = { ok: false, callback: null, minSendable: null, maxSendable: null, error: null };
    const parts = _parts(lud16);
    if (!parts) { out.error = 'invalid-lud16'; return out; }
    if (!fetch) { out.error = 'fetch-unavailable'; return out; }
    let res;
    try {
      res = await fetch(`https://${parts.domain}/.well-known/lnurlp/${parts.user}`);
    } catch { out.error = 'resolve-failed'; return out; }
    if (!res || !res.ok) { out.error = `resolve-${res ? res.status : 'n/a'}`; return out; }
    const data = await _json(res);
    if (!data || data.tag !== 'payRequest' || typeof data.callback !== 'string' || !data.callback) {
      out.error = 'not-a-payRequest'; return out;
    }
    out.ok = true;
    out.callback = data.callback;
    out.minSendable = (typeof data.minSendable === 'number') ? data.minSendable : null;
    out.maxSendable = (typeof data.maxSendable === 'number') ? data.maxSendable : null;
    return out;
  }

  async function mintInvoice({ lud16, amountSats } = {}) {
    const out = { ok: false, pr: null, verifyUrl: null, error: null, detail: null };
    const parts = _parts(lud16);
    if (!parts) { out.error = 'invalid-lud16'; return out; }
    if (!fetch) { out.error = 'fetch-unavailable'; return out; }
    const amountSatsInt = Math.max(0, Math.round(Number(amountSats) || 0));
    if (!amountSatsInt) { out.error = 'zero-amount'; return out; }

    const resolved = await resolveLightningAddress(lud16);
    if (!resolved.ok) { out.error = resolved.error; return out; }

    // Respect the server's min/max sendable bounds (millisats) when advertised.
    const msats = _msats(amountSatsInt);
    if (resolved.minSendable != null && msats < resolved.minSendable) { out.error = 'below-min-sendable'; return out; }
    if (resolved.maxSendable != null && msats > resolved.maxSendable) { out.error = 'above-max-sendable'; return out; }

    const sep = resolved.callback.indexOf('?') === -1 ? '?' : '&';
    let res;
    try {
      res = await fetch(`${resolved.callback}${sep}amount=${msats}`);
    } catch { out.error = 'mint-failed'; return out; }
    if (!res || !res.ok) {
      const body = res ? await _text(res) : '';
      out.error = `mint-${res ? res.status : 'n/a'}`;
      out.detail = body.slice(0, 200) || null;
      return out;
    }
    const data = await _json(res);
    if (!data || typeof data.pr !== 'string' || !data.pr) {
      out.error = 'no-invoice'; return out;
    }
    out.ok = true;
    out.pr = data.pr;
    out.verifyUrl = (typeof data.verify === 'string' && data.verify) ? data.verify : null;
    return out;
  }

  async function verifySettled({ lud16, pr, verifyUrl } = {}) {
    const out = { settled: false, preimage: null, error: null };
    const parts = _parts(lud16);
    if (!parts) { out.error = 'invalid-lud16'; return out; }
    if (typeof pr !== 'string' || !pr) { out.error = 'missing-invoice'; return out; }
    if (!fetch) { out.error = 'fetch-unavailable'; return out; }

    // Prefer a mint-provided `verify` URL; else resolve the address for the callback.
    let url = (typeof verifyUrl === 'string' && verifyUrl) ? verifyUrl : null;
    if (!url) {
      const resolved = await resolveLightningAddress(lud16);
      if (!resolved.ok) { out.error = resolved.error; return out; }
      url = _buildVerifyUrl(resolved.callback, pr, null);
    }
    if (!url) { out.error = 'no-verify-url'; return out; }

    let res;
    try { res = await fetch(url); } catch { out.error = 'verify-failed'; return out; }
    if (!res || !res.ok) { out.error = `verify-${res ? res.status : 'n/a'}`; return out; }
    const data = await _json(res);
    // Fail-closed: only an explicit settled flag counts.
    if (data && data.settled === true) {
      out.settled = true;
      out.preimage = (typeof data.preimage === 'string' && data.preimage) ? data.preimage : null;
    } else {
      out.error = (typeof data.reason === 'string' && data.reason) ? data.reason : 'not-settled';
    }
    return out;
  }

  return { resolveLightningAddress, mintInvoice, verifySettled };
}