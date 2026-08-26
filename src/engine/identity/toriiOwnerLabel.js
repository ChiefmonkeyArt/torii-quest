// src/engine/identity/toriiOwnerLabel.js — pure helper for the homepage's
// "This torii belongs to: <label>" caption.
//
// The label always names the INSTANCE OWNER (the configured admin npub,
// exposed to the client as capability.adminPubkey — the same identity the
// existing isAdminOperator() checks elsewhere), never just whichever visitor
// happens to be logged in. Priority order, highest first:
//   1. When the current viewer IS the owner AND has a local profile draft
//      with a human name set, that name is shown (an owner naming their own
//      world reads better than their raw npub, and reflects unpublished
//      edits immediately).
//   2. The owner's PUBLISHED Nostr profile displayName/name (v0.2.703-alpha)
//      — fetched read-only from relays by the caller (main.js) via kind:0 and
//      passed in as `ownerProfileName`, so EVERY visitor sees the real name,
//      not just the owner viewing their own browser.
//   3. A shortened npub.
// An unconfigured instance falls back to a neutral placeholder. Pure + never
// throws — safe to call before any capability/profile fetch resolves.

function shorten(npubOrHex) {
  const s = typeof npubOrHex === 'string' ? npubOrHex : '';
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

// resolveToriiOwnerLabel({ adminPubkey, viewerPubkey, profileDraft, ownerProfileName }) → string.
//   adminPubkey      — the instance's configured owner (capability.adminPubkey), or falsy if unset.
//   viewerPubkey     — the currently logged-in viewer's hex pubkey, or falsy if logged out.
//   profileDraft     — the viewer's OWN local draft ({ displayName, name, ... }), or falsy/{}.
//   ownerProfileName — the owner's PUBLISHED Nostr displayName/name, fetched read-only by the
//                      caller from relays (any visitor sees this, not just the owner). Falsy/blank
//                      when not yet fetched, unavailable, or the owner has no name set.
export function resolveToriiOwnerLabel({ adminPubkey, viewerPubkey, profileDraft, ownerProfileName } = {}) {
  const owner = typeof adminPubkey === 'string' ? adminPubkey.trim() : '';
  if (!owner) return 'not yet claimed';

  const viewer = typeof viewerPubkey === 'string' ? viewerPubkey.trim() : '';
  const isOwnerViewing = !!viewer && viewer === owner;
  if (isOwnerViewing) {
    const draft = (profileDraft && typeof profileDraft === 'object') ? profileDraft : {};
    const draftName = (typeof draft.displayName === 'string' && draft.displayName.trim())
      || (typeof draft.name === 'string' && draft.name.trim())
      || '';
    if (draftName) return draftName;
  }
  const publishedName = typeof ownerProfileName === 'string' ? ownerProfileName.trim() : '';
  if (publishedName) return publishedName;
  return shorten(owner);
}
