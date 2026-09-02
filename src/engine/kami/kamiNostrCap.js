// src/engine/kami/kamiNostrCap.js — ADR-0040 Stage 1.
//
// Pure feature-detection for NIP-07 (window.nostr). The in-game emagake rack
// CANNOT decrypt NIP-17 gift-wrapped DMs unless the user's Nostr extension
// exposes window.nostr.nip44 (encrypt/decrypt) — most NIP-07 extensions only
// expose getPublicKey + signEvent and deliberately hide the owner's private key,
// so the browser cannot do the ECDH to unwrap NIP-44 itself.
//
// This module only REPORTS capability. It does NOT enable any in-game decrypt
// path yet (gated on real extension support, which is not assumed). The rack
// keeps reading replies.jsonl via GET /mp/kami/replies (ADR-0039).

const _win = () => (typeof window !== 'undefined' ? window : null);

export function hasNip07() {
  const w = _win();
  return !!(w && typeof w === 'object' && w.nostr && typeof w.nostr === 'object');
}

export function hasNip04() {
  if (!hasNip07()) return false;
  const n = _win().nostr;
  return typeof n.encrypt === 'function' && typeof n.decrypt === 'function';
}

export function hasNip44() {
  if (!hasNip07()) return false;
  const n = _win().nostr;
  return !!(n.nip44 && typeof n.nip44 === 'object') &&
    typeof n.nip44.encrypt === 'function' &&
    typeof n.nip44.decrypt === 'function';
}

// summarize() → a plain object safe to log (no secrets). 'canDecryptNip44Dm'
// is the one bit a future in-game rack would gate on; today it is almost
// always false because extensions rarely expose nip44.
export function summarize() {
  return {
    nip07: hasNip07(),
    nip04: hasNip04(),
    nip44: hasNip44(),
    canDecryptNip17Dm: hasNip44(),
  };
}
