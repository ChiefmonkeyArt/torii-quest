// engine/components/productDetail.js — interactive product DETAIL view-model
// (M2, v0.2.283). Promotes the read-only product PREVIEW (productPreview.js) into
// a richer "clicked-into" detail surface: full description + image + seller proof
// + marketplace link, PLUS one real, lightweight interaction — a local SAVE keyed
// to the viewer's Nostr identity (savedProducts.js).
//
// Pure + node-safe: NO Three/Rapier/DOM, NO window/navigation, NO fetch, NO
// checkout/pay/zap/publish. This is the presentation layer: it re-shapes the
// validated product (productPanelViewModel) into a render-ready detail bag and
// describes the SAVE interaction's state — it never performs it (the host wires a
// click to savedProducts.toggleProductSaved). Commerce stays out-of-band on the
// marketplace: `readOnly:true` (no checkout) is preserved; the only action is the
// local, client-side save, which is gated on having an identity (anon → disabled).

import { productPanelViewModel } from './productPanel.js';
import { shortNpub, previewUrl } from './productPreview.js';

// Badge shown on the detail surface — names the one interaction (a LOCAL save)
// and re-states that no commerce happens here.
export const PRODUCT_DETAIL_BADGE = 'DETAIL · SAVE IS LOCAL · NO CHECKOUT';

// _clean(text, max) → a display-safe, length-capped string: strips control chars
// and HTML angle brackets so a hostile listing value can't inject markup into the
// host card (consistent with consentView.js sanitisation). Pure.
function _clean(text, max = 280) {
  // Strip ASCII control chars (0x00-0x1F) and HTML angle brackets, then collapse
  // whitespace. Built without literal control bytes in source.
  const CONTROL = new RegExp('[' + '\\u0000-\\u001F' + '<>]', 'g');
  const flat = String(text == null ? '' : text)
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

// _saveInteraction({ viewer, saved }) → the SAVE button's render state. A viewer
// (logged-in or verified-arrival identity) enables it; an anon viewer gets a
// disabled button with a connect-prompt hint. Local-only: `local:true`, no sign/
// publish. Pure.
function _saveInteraction({ viewer, saved }) {
  const enabled = typeof viewer === 'string' && viewer.trim() !== '';
  return {
    kind: 'save',
    local: true,            // writes only to the client's own store
    enabled,
    saved: enabled ? saved === true : false,
    label: enabled && saved === true ? 'SAVED ✓' : 'SAVE',
    hint: enabled ? '' : 'connect a Nostr identity to save',
  };
}

// productDetailView(product, { viewer, saved }) → a render-ready, interactive
// product DETAIL block:
//
//   {
//     title:       'PRODUCT DETAIL',
//     ok:          boolean,              // false ⇒ product failed validation
//     product:     string,               // the listing's title
//     description: string,               // sanitised, '' when none
//     image:       string | null,        // https image url (display), null when none
//     hasImage:    boolean,
//     seller:      string,               // shortened npub (ownership proof)
//     sellerFull:  string | null,        // the full seller npub (display only)
//     priceLabel:  string,               // 'See price' | 'Free' | '<n> sats'
//     reward:      string | null,        // optional in-game reward HINT
//     marketplace: { label, url, actionable:false } | null,  // link is text only
//     badge:       'DETAIL · SAVE IS LOCAL · NO CHECKOUT',
//     lines:       [{ label, value }],   // ready-to-draw detail rows
//     interaction: { kind:'save', local:true, enabled, saved, label, hint },
//     readOnly:    true,                 // no checkout/pay/zap surface, ever
//     actionable:  false,                // no COMMERCE action (save is local-only)
//     errors:      string[],
//   }
//
// `viewer` is the viewer's identity (hex64 pubkey or npub) — null/'' ⇒ anon.
// `saved` is whether this viewer has already saved this product (host passes the
// savedProducts lookup). Pure — never throws, never navigates, never fetches.
export function productDetailView(product, { viewer = null, saved = false } = {}) {
  const { ok, errors, view } = productPanelViewModel(product);
  if (!ok) {
    return {
      title: 'PRODUCT DETAIL',
      ok: false,
      product: '—',
      description: '',
      image: null,
      hasImage: false,
      seller: '—',
      sellerFull: null,
      priceLabel: 'See price',
      reward: null,
      marketplace: null,
      badge: PRODUCT_DETAIL_BADGE,
      lines: [{ label: 'Status', value: 'UNAVAILABLE' }],
      interaction: _saveInteraction({ viewer: null, saved: false }),
      readOnly: true,
      actionable: false,
      errors,
    };
  }

  const description = _clean(product && product.description);
  const linkUrl = previewUrl(view.linkUrl);

  const lines = [
    { label: 'Product', value: view.title },
    { label: 'Price', value: view.priceLabel },
    { label: 'Seller', value: shortNpub(view.seller) },
  ];
  if (description) lines.push({ label: 'About', value: description });
  if (view.hasReward) lines.push({ label: 'Reward', value: view.reward });
  lines.push({ label: 'Marketplace', value: view.linkLabel });
  lines.push({ label: 'Link', value: linkUrl || '—' });

  return {
    title: 'PRODUCT DETAIL',
    ok: true,
    product: view.title,
    description,
    image: view.imageUrl,
    hasImage: view.hasImage,
    seller: shortNpub(view.seller),
    sellerFull: view.seller,
    priceLabel: view.priceLabel,
    reward: view.reward,
    marketplace: { label: view.linkLabel, url: linkUrl, actionable: false },
    badge: PRODUCT_DETAIL_BADGE,
    lines,
    interaction: _saveInteraction({ viewer, saved }),
    readOnly: true,
    actionable: false, // commerce is out-of-band; the only action is the local save
    errors: [],
  };
}
