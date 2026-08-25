// engine/identity/profileDraft.js — pure localStorage helpers for the
// Profile settings tab's draft fields (Phase 0g). Mirrors
// engine/menu/adminPrefs.js's injected-storage pattern exactly (default
// globalThis.localStorage, tests pass a fake, never throws, degrades to
// defaults with no storage).
//
// This is PREVIEW / this-browser-only local draft state, same spirit as
// adminPrefs' torii.world.active: it lets the Profile form show whatever the
// owner last typed (even before they've published a signed kind:0), so the
// tab isn't blank every time it's reopened. The actual published-to-relays
// profile is a signed Nostr event this module never touches — main.js reads
// this draft only to pre-fill the form and to build the unsigned event via
// profileMetadata.buildProfileMetadataEvent before signing.

const PROFILE_DRAFT_KEY = 'torii.profile.draft';

function _storage(s) {
  const store = s === undefined ? globalThis.localStorage : s;
  if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') {
    return null;
  }
  return store;
}

// getProfileDraft(storage?) → the last-saved draft object (shape:
// { name, displayName, about, picture, website, nip05, lud16 }), or {} when
// absent/invalid/no-storage. Pure; never throws.
export function getProfileDraft(storage) {
  try {
    const store = _storage(storage);
    if (!store) return {};
    const raw = store.getItem(PROFILE_DRAFT_KEY);
    if (typeof raw !== 'string' || raw === '') return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

// setProfileDraft(fields, storage?) → void. Stores a plain-object subset of
// the known profile fields (unknown keys are dropped). Never throws.
export function setProfileDraft(fields, storage) {
  try {
    const store = _storage(storage);
    if (!store) return;
    const f = (fields && typeof fields === 'object' && !Array.isArray(fields)) ? fields : {};
    const out = {};
    for (const k of ['name', 'displayName', 'about', 'picture', 'website', 'nip05', 'lud16']) {
      if (typeof f[k] === 'string') out[k] = f[k];
    }
    store.setItem(PROFILE_DRAFT_KEY, JSON.stringify(out));
  } catch {
    /* storage disabled / quota — ignore; read still returns the prior value */
  }
}
