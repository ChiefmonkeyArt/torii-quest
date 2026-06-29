// engine/gateway/handoffVerify.js — SEC-2 handoff verification gate (P1, v0.2.252).
// The gate a traveller clears BEFORE trusting a host's signed accept and acting
// on the hop. Given a sanitised accept RESPONSE (from travelRequest.
// extractTravelResponse) and what the traveller EXPECTS (the request id they
// sent, the host pubkey they addressed it to, their own traveller pubkey), it
// verifies the response is a genuine, correctly-attributed accept for THIS hop.
//
// PURE + node-safe: NO DOM, NO socket, NO signing, NO navigation. It consumes a
// sanitised model + expectation and returns a verdict. Full BIP-340 signature
// crypto-verification is the next crypto layer (would need @noble/curves; the
// project is deliberately dependency-free, so SEC-2 here is STRUCTURAL: host
// identity match + request reference + traveller addressing + https spawn). The
// `trust` field is honest about this: 'host-matched' (structural pass) vs
// 'crypto-verified' (future). A signed-but-mismatched response fails closed.
//
// Checks (ALL must pass for trusted:true):
//   1. response.accepted === true            (a deny never arms a hop)
//   2. response.referencesRequestId === expectedRequestId  (it answers OUR ask)
//   3. response.hostPubkey === expectedHostPubkey         (signed by the host we chose)
//   4. response.travellerPubkey === expectedTravellerPubkey (addressed to US)
//   5. response.spawn is a valid https URL    (SEC-3 will deepen the URL check;
//      until then, a non-https/absent spawn on an accept fails closed)

const HEX64 = /^[0-9a-f]{64}$/;
function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

function _safeHttps(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  return u.protocol === 'https:' ? u.href : null;
}

// verifyHandoff({ response, expectedRequestId, expectedHostPubkey,
//   expectedTravellerPubkey, requireSpawn }) →
//   { ok, trusted, trust, errors }. Pure; never throws.
//
//   ok      — the inputs were well-formed enough to evaluate (false = malformed)
//   trusted — the accept passes every SEC-2 structural check (the hop may arm)
//   trust   — 'host-matched' (structural pass) | 'crypto-verified' (future) |
//             'unverified' (not trusted)
//   errors  — human-readable reasons (empty when trusted)
export function verifyHandoff(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const response = o.response && typeof o.response === 'object' ? o.response : null;
  const expectedRequestId = typeof o.expectedRequestId === 'string' ? o.expectedRequestId.trim() : '';
  const expectedHostPubkey = typeof o.expectedHostPubkey === 'string' ? o.expectedHostPubkey.trim() : '';
  const expectedTravellerPubkey = typeof o.expectedTravellerPubkey === 'string' ? o.expectedTravellerPubkey.trim() : '';
  const requireSpawn = o.requireSpawn !== false; // default true

  if (!response) return { ok: false, trusted: false, trust: 'unverified', errors: ['response model is required'] };
  if (!expectedRequestId) return { ok: false, trusted: false, trust: 'unverified', errors: ['expectedRequestId is required'] };
  if (!_isHex64(expectedHostPubkey)) return { ok: false, trusted: false, trust: 'unverified', errors: ['expectedHostPubkey must be hex64'] };
  if (!_isHex64(expectedTravellerPubkey)) return { ok: false, trusted: false, trust: 'unverified', errors: ['expectedTravellerPubkey must be hex64'] };

  const errors = [];

  // 1. accept state
  if (response.accepted !== true) errors.push('response is not an accept (denied)');

  // 2. references OUR request
  if (response.referencesRequestId !== expectedRequestId) {
    errors.push('response does not reference our request id');
  }

  // 3. signed by the host we addressed the request to
  if (response.hostPubkey !== expectedHostPubkey) {
    errors.push('response signer is not the host we requested travel to');
  }

  // 4. addressed to US (the traveller)
  if (response.travellerPubkey !== expectedTravellerPubkey) {
    errors.push('response is not addressed to our traveller pubkey');
  }

  // 5. spawn URL (https only). SEC-3 will add deeper host/scheme hardening.
  if (requireSpawn) {
    const safeSpawn = _safeHttps(response.spawn);
    if (!safeSpawn) errors.push('accept has no valid https spawn URL');
  }

  if (errors.length) return { ok: true, trusted: false, trust: 'unverified', errors };
  return { ok: true, trusted: true, trust: 'host-matched', errors: [] };
}
