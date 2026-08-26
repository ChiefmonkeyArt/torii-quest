// src/engine/identity/toriiOwnerLabel.js — pure helper for the homepage's
// "This torii belongs to: <label>" caption.
//
// The label always names the INSTANCE OWNER (the configured admin npub,
// exposed to the client as capability.adminPubkey — the same identity the
// existing isAdminOperator() checks elsewhere), never just whichever visitor
// happens to be logged in. When the current viewer IS that owner AND has a
// local profile draft with a human name set, that name is shown (an owner
// naming their own world reads better than their raw npub); every other case
// falls back to a shortened npub, and an unconfigured instance falls back to
// a neutral placeholder. Pure + never throws — safe to call before any
// capability/profile fetch resolves.

function shorten(npubOrHex) {
  const s = typeof npubOrHex === 'string' ? npubOrHex : '';
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

// resolveToriiOwnerLabel({ adminPubkey, viewerPubkey, profileDraft }) → string.
//   adminPubkey   — the instance's configured owner (capability.adminPubkey), or falsy if unset.
//   viewerPubkey  — the currently logged-in viewer's hex pubkey, or falsy if logged out.
//   profileDraft  — the viewer's OWN local draft ({ displayName, name, ... }), or falsy/{}.
export function resolveToriiOwnerLabel({ adminPubkey, viewerPubkey, profileDraft } = {}) {
  const owner = typeof adminPubkey === 'string' ? adminPubkey.trim() : '';
  if (!owner) return 'not yet claimed';

  const viewer = typeof viewerPubkey === 'string' ? viewerPubkey.trim() : '';
  const isOwnerViewing = !!viewer && viewer === owner;
  if (isOwnerViewing) {
    const draft = (profileDraft && typeof profileDraft === 'object') ? profileDraft : {};
    const name = (typeof draft.displayName === 'string' && draft.displayName.trim())
      || (typeof draft.name === 'string' && draft.name.trim())
      || '';
    if (name) return name;
  }
  return shorten(owner);
}
