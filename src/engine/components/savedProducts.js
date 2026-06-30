// engine/components/savedProducts.js — client-side "saved products" list, keyed
// by the viewer's Nostr identity (M2, v0.2.283). Promotes the product surface
// from a read-only proof to a real, lightweight interaction: a traveller who has
// connected / arrived with a verified npub can SAVE a product they reached
// through a gateway, and that list persists locally under THEIR identity.
//
// Safety boundary (mirrors liveUpdateCheck.js / the consent floor):
//   - PURE + node-safe at import: no THREE/Rapier/DOM, no module-level storage,
//     never throws. The Storage dependency is INJECTED — there is no global
//     localStorage fallback, so importing this never touches client state.
//   - This is a LOCAL-ONLY action: it writes to the injected Storage and nothing
//     else. It is NOT a relay write, NOT a Nostr publish, NOT a payment/zap — so
//     it needs no consent/sign gate (saving to your own browser store is not a
//     network or signing action). A future "share my list" WOULD be a publish and
//     would have to route through consentGate; that is explicitly out of scope.
//   - Keyed by identity: each viewer's saved list lives under its own identity
//     bucket, so two npubs on one browser never see each other's saves. An ANON
//     viewer (no identity) cannot save — setProductSaved fails closed (reason
//     'anon') so the UI can prompt "connect a Nostr identity to save".

// localStorage key + schema version for the saved-products map. Bumping the
// suffix invalidates every client's saved lists on a shape change.
export const SAVED_PRODUCTS_KEY = 'torii.savedProducts.v1';

// Cap a single viewer's list so a hostile/looping caller can't grow storage
// without bound (quota safety). Oldest entries are dropped past the cap.
export const MAX_SAVED_PER_IDENTITY = 100;

// _identityKey(identity) → a normalised bucket key for a viewer, or '' for anon.
// Accepts a 64-hex pubkey or an npub1… string (both are valid Torii identities:
// a logged-in operator carries the hex pubkey, an arriving traveller is seated
// with the same). Pure; anything else (null/empty/garbage) → '' (anon).
export function _identityKey(identity) {
  const s = String(identity || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  if (/^npub1[0-9a-z]{20,}$/.test(s)) return s;
  return '';
}

// productKey(product) → a stable id for a product so the same listing toggles the
// same saved entry. Prefers the external URL (the listing's canonical address),
// falls back to the title. Pure; '' when neither is usable.
export function productKey(product) {
  if (!product || typeof product !== 'object') return '';
  const url = String(product.url || '').trim().toLowerCase();
  if (url) return url.slice(0, 256);
  const title = String(product.title || '').trim().toLowerCase();
  return title ? title.slice(0, 256) : '';
}

// _readMap(storage) → the full { identityKey: entry[] } map, or {} on any
// absent/secured/malformed storage. Pure; never throws.
function _readMap(storage) {
  if (!storage || typeof storage.getItem !== 'function') return {};
  let raw;
  try { raw = storage.getItem(SAVED_PRODUCTS_KEY); } catch { return {}; }
  if (!raw) return {};
  let map;
  try { map = JSON.parse(raw); } catch { return {}; }
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
}

// _writeMap(storage, map) → best-effort persist. Pure; never throws (quota /
// secured storage is swallowed). Returns true on a successful write.
function _writeMap(storage, map) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try { storage.setItem(SAVED_PRODUCTS_KEY, JSON.stringify(map)); return true; }
  catch { return false; }
}

// _entry(product, key, now) → the compact, display-safe saved record we persist.
function _entry(product, key, now) {
  return {
    key,
    title: String(product.title || '').slice(0, 200),
    sellerNpub: typeof product.sellerNpub === 'string' ? product.sellerNpub : null,
    url: typeof product.url === 'string' ? product.url : null,
    priceSats: Number.isFinite(product.priceSats) ? product.priceSats : null,
    at: Number.isFinite(now) ? now : 0,
  };
}

// readSavedFor(storage, identity) → the viewer's saved entries (newest-first by
// insertion order is preserved as stored). [] for anon / none. Pure; never throws.
export function readSavedFor(storage, identity) {
  const id = _identityKey(identity);
  if (!id) return [];
  const list = _readMap(storage)[id];
  return Array.isArray(list) ? list.filter((e) => e && typeof e.key === 'string' && e.key) : [];
}

// savedCountFor(storage, identity) → how many products this viewer has saved.
export function savedCountFor(storage, identity) {
  return readSavedFor(storage, identity).length;
}

// isProductSaved(storage, identity, product) → whether THIS viewer has saved it.
export function isProductSaved(storage, identity, product) {
  const key = productKey(product);
  if (!key) return false;
  return readSavedFor(storage, identity).some((e) => e.key === key);
}

// setProductSaved(storage, identity, product, save, now) → persists the toggle.
//   → { ok, saved, count, reason }
// ANON (no identity) fails closed: { ok:false, saved:false, count:0, reason:'anon' }.
// A product with no usable key: { ok:false, ..., reason:'invalid' }. Otherwise the
// list is updated (add when save:true, remove when save:false), capped, and the
// new state returned. Pure-by-injection; never throws.
export function setProductSaved(storage, identity, product, save, now) {
  const id = _identityKey(identity);
  if (!id) return { ok: false, saved: false, count: 0, reason: 'anon' };
  const key = productKey(product);
  if (!key) return { ok: false, saved: false, count: 0, reason: 'invalid' };

  const map = _readMap(storage);
  const current = Array.isArray(map[id]) ? map[id].filter((e) => e && e.key) : [];
  const without = current.filter((e) => e.key !== key);

  let next;
  if (save) {
    next = [...without, _entry(product, key, now)];
    if (next.length > MAX_SAVED_PER_IDENTITY) next = next.slice(next.length - MAX_SAVED_PER_IDENTITY);
  } else {
    next = without;
  }

  if (next.length) map[id] = next; else delete map[id];
  const ok = _writeMap(storage, map);
  return { ok, saved: ok ? !!save : isProductSaved(storage, identity, product), count: next.length, reason: ok ? null : 'storage' };
}

// toggleProductSaved(storage, identity, product, now) → flips the current saved
// state for this viewer and persists. Returns the same shape as setProductSaved.
export function toggleProductSaved(storage, identity, product, now) {
  const wasSaved = isProductSaved(storage, identity, product);
  return setProductSaved(storage, identity, product, !wasSaved, now);
}
