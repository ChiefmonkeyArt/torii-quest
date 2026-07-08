// engine/components/productDisplay.js — reference component: a read-only product
// display (CMP-13 skeleton, v0.2.134). The first commerce surface in-world — a
// droppable that shows ONE Plebeian.Market product (title, image, seller npub,
// price, external link, optional in-game reward hint). Built on the v0.2.132
// component contract (defineComponent), like the Torii gateway.
//
// Pure + node-safe: NO Three/Rapier/DOM/Nostr imports. SKELETON — the lifecycle
// is a safe symmetric no-op so it is contract-valid and importable in tests and
// from the SDK. The actual in-world panel mesh / billboard is a documented TODO.
//
// READ-ONLY by design: this component DISPLAYS a product and links OUT to the
// marketplace. It performs NO payment, NO checkout, NO zap, NO Nostr publish —
// buying happens on Plebeian.Market via the external URL. Payment execution is
// deliberately out of scope for the skeleton (and would be a separate, audited
// component if ever built in-world).

import { defineComponent, COMPONENT_CONTRACT_VERSION } from './contract.js';

// The component's own semver, independent of the game VERSION.
export const PRODUCT_DISPLAY_VERSION = '0.1.0';

// A placeholder seller npub so the skeleton satisfies the contract's provenance
// rule (author.npub required). Real listings carry the seller's npub.
const DEFAULT_SELLER_NPUB = 'npub1product0display0skeleton0placeholder0seller0xxxxxxxxxx';

function _isBlank(v) { return v == null || v === ''; }
function looksLikeNpub(v) {
  return typeof v === 'string' && /^npub1[0-9a-z]{20,}$/.test(v);
}
// Accept only https:// external links with a real host — never javascript:/data:/
// relative — so a listing can't smuggle a script URL into the host (consistent
// with the existing Nostr-avatar URL validation + CSP hardening). Pure check,
// no navigation. SEC-3 (v0.2.354): the previous regex `/^https:\/\/[^\s]+$/i`
// was a naive string check that accepted anything starting with `https://`
// including malformed values like `https://` alone. We now parse with the
// WHATWG URL constructor and enforce `protocol === 'https:'` + a non-empty
// hostname — the parser rejects the truly malformed cases (`https://`,
// `https:javascript:`) and normalises the permissive-but-safe ones
// (`https:host`, `https:///host`, `HTTPS://`) to a real https host, so a
// listing can no longer smuggle a non-https scheme through us. A pre-parse
// whitespace guard preserves the old `[^\s]+` invariant (URL trims/encodes
// embedded whitespace, which we don't want to silently rewrite). The URL
// constructor is available in every supported runtime (browsers + Node ≥ 10)
// and only throws for unparseable inputs, handled below.
export function isSafeHttpUrl(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s === '' || /\s/.test(s)) return false;
  let u;
  try { u = new URL(s); } catch { return false; }
  return u.protocol === 'https:' && u.hostname.length > 0;
}

// validateProduct(product) → { valid, errors }. Pure, never throws. A displayable
// product needs a title, a seller npub (provenance), and a safe external URL;
// image/price/reward are optional but, when present, must be well-formed.
export function validateProduct(product) {
  const errors = [];
  if (!product || typeof product !== 'object') {
    return { valid: false, errors: ['product must be an object'] };
  }
  if (_isBlank(product.title)) errors.push('missing required field: title');
  if (_isBlank(product.sellerNpub)) errors.push('missing required field: sellerNpub');
  else if (!looksLikeNpub(product.sellerNpub)) errors.push('sellerNpub must be an npub (npub1…)');

  if (_isBlank(product.url)) errors.push('missing required field: url (external marketplace link)');
  else if (!isSafeHttpUrl(product.url)) errors.push('url must be an https:// link');

  if (!_isBlank(product.image) && !isSafeHttpUrl(product.image)) {
    errors.push('image must be an https:// link when present');
  }
  // Price, when present, must be a non-negative sats integer (free = 0/omitted).
  if (product.priceSats != null
      && !(Number.isFinite(product.priceSats) && product.priceSats >= 0)) {
    errors.push('priceSats must be a non-negative number when present');
  }
  return { valid: errors.length === 0, errors };
}

// createProductDisplay(config) → a contract-valid component. `config` =
//   { title, image, sellerNpub, priceSats, url, reward }
// describes the single product shown. Returns the object produced by
// defineComponent (idempotent .mount(scene, options)/.unmount()/.mounted).
export function createProductDisplay(config = {}) {
  const {
    title = 'Untitled Product',
    image = null,
    sellerNpub = DEFAULT_SELLER_NPUB,
    priceSats = null,
    url = 'https://plebeian.market',
    // Optional in-game reward HINT (e.g. a 'sticker gun' skin unlocked by owning
    // the product). A hint only — no entitlement is granted here; the host
    // decides if/how to honour it. NOT a payment.
    reward = null,
  } = config;

  const product = { title, image, sellerNpub, priceSats, url, reward };

  return defineComponent({
    manifest: {
      id: 'plebeian.product-display',
      name: 'Product Display',
      version: PRODUCT_DISPLAY_VERSION,
      author: { npub: sellerNpub },
      mountTarget: 'panel',
      contract: COMPONENT_CONTRACT_VERSION,
      kind: 'product',
      // The product block the host/panel will render once the mesh is built.
      product,
    },
    // SKELETON no-op mount — attaches nothing today. defineComponent tracks the
    // mounted flag + enforces idempotency, so this stays a safe symmetric pair.
    // TODO(CMP-13): render a product panel/billboard (title + image + price +
    // "view on Plebeian.Market" external link) at options.position. READ-ONLY:
    // the link opens the marketplace; NO in-world checkout/zap/publish here.
    mount(_scene, _options = {}) { /* skeleton: no-op */ },
    // SKELETON no-op unmount — nothing attached, contract symmetry holds.
    // TODO(CMP-13): remove the panel mesh.
    unmount() { /* skeleton: no-op */ },
  });
}

// A ready, contract-valid default instance for SDK discovery / demos.
export const productDisplay = createProductDisplay();
