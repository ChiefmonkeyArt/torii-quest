const HEX64 = /^[0-9a-f]{64}$/;

export const WRITE_POLICY_OWNER_ONLY = 'owner-only';
export const WRITE_POLICY_DELEGATES = 'delegates';
export const WRITE_POLICY_FOLLOWS_WRITE = 'follows-write';
export const WRITE_POLICY_OPEN = 'open';

export const EDITABLE_WRITE_POLICIES = Object.freeze([
  WRITE_POLICY_OWNER_ONLY,
  WRITE_POLICY_DELEGATES,
  WRITE_POLICY_FOLLOWS_WRITE,
]);

export const DISABLED_WRITE_POLICIES = Object.freeze([
  WRITE_POLICY_OPEN,
]);

function _normaliseHex64(value) {
  const pubkey = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return HEX64.test(pubkey) ? pubkey : '';
}

function _normaliseDelegateSet(delegateSet) {
  if (!(delegateSet instanceof Set)) return new Set();
  const out = new Set();
  for (const pubkey of delegateSet) {
    const normalised = _normaliseHex64(pubkey);
    if (normalised) out.add(normalised);
  }
  return out;
}

export function normaliseWritePolicy(raw) {
  if (raw == null || raw === '') {
    return { ok: true, policy: WRITE_POLICY_OWNER_ONLY, error: null, supported: true, editable: true };
  }
  const policy = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (policy === WRITE_POLICY_OWNER_ONLY || policy === WRITE_POLICY_DELEGATES || policy === WRITE_POLICY_FOLLOWS_WRITE) {
    return { ok: true, policy, error: null, supported: true, editable: true };
  }
  if (policy === WRITE_POLICY_OPEN) {
    return { ok: false, policy: WRITE_POLICY_OWNER_ONLY, error: 'write-policy-unsupported', supported: false, editable: false };
  }
  return { ok: false, policy: WRITE_POLICY_OWNER_ONLY, error: 'write-policy-unreadable', supported: false, editable: false };
}

export function decideWriteAuthority(opts = {}) {
  const actorPubkey = _normaliseHex64(opts.actorPubkey);
  const ownerPubkey = _normaliseHex64(opts.ownerPubkey);
  const actorTrust = typeof opts.actorTrust === 'string' ? opts.actorTrust : 'denied';
  const writePolicy = normaliseWritePolicy(opts.writePolicy).policy;
  const delegateSet = _normaliseDelegateSet(opts.delegateSet);
  const followsOwner = opts.followsOwner === true ? true : (opts.followsOwner === false ? false : 'unknown');

  if (actorTrust === 'owner-session') {
    return { allowed: true, reason: 'owner-session' };
  }
  if (actorTrust === 'crypto-verified' && actorPubkey && ownerPubkey && actorPubkey === ownerPubkey) {
    return { allowed: true, reason: 'owner' };
  }
  if (actorTrust === 'anon') {
    return { allowed: false, reason: 'anon-denied' };
  }
  if (actorTrust === 'denied') {
    return { allowed: false, reason: 'denied' };
  }
  if (actorTrust !== 'crypto-verified' || !actorPubkey) {
    return { allowed: false, reason: 'write-requires-crypto-verified' };
  }

  switch (writePolicy) {
    case WRITE_POLICY_OWNER_ONLY:
      return { allowed: false, reason: 'owner-only' };
    case WRITE_POLICY_DELEGATES:
      if (!delegateSet.size) return { allowed: false, reason: 'delegate-set-missing' };
      return delegateSet.has(actorPubkey)
        ? { allowed: true, reason: 'delegate' }
        : { allowed: false, reason: 'delegate-required' };
    case WRITE_POLICY_FOLLOWS_WRITE:
      if (followsOwner === true) return { allowed: true, reason: 'follows-owner' };
      return followsOwner === false
        ? { allowed: false, reason: 'follow-required' }
        : { allowed: false, reason: 'follow-check-unavailable' };
    default:
      return { allowed: false, reason: 'owner-only' };
  }
}

export function assertWriteAuthority(opts = {}) {
  const verdict = decideWriteAuthority(opts);
  if (verdict.allowed) return verdict;
  const error = new Error(`write authority denied: ${verdict.reason}`);
  error.code = 'WRITE_AUTHORITY_DENIED';
  error.reason = verdict.reason;
  error.verdict = verdict;
  throw error;
}
