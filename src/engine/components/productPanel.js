// engine/components/productPanel.js — product panel view-model shell (CMP-13
// continuation, v0.2.135). Turns a validated product (productDisplay.js) into a
// render-ready VIEW-MODEL: the plain strings/flags an in-world panel mesh or a
// DOM card would draw. Splitting the view-model out keeps the actual Three.js
// panel a thin renderer over a pure, node-testable shape.
//
// Pure + node-safe: NO Three/Rapier/DOM. READ-ONLY, like productDisplay — the
// view-model carries a link OUT to the marketplace and NO checkout/pay/zap/
// publish. Building the mesh from this view-model is the deferred render step.

import { validateProduct } from './productDisplay.js';

// priceLabel(priceSats) → a human label. null/undefined ⇒ 'See price' (price
// lives on the marketplace); 0 ⇒ 'Free'; otherwise '<n> sats'.
export function priceLabel(priceSats) {
  if (priceSats == null) return 'See price';
  if (priceSats === 0) return 'Free';
  return `${priceSats} sats`;
}

// productPanelViewModel(product) → { ok, errors, view }. Validates the product
// first (invalid ⇒ ok:false, view:null). The view is a flat, JSON-serialisable
// bag a renderer can bind directly. Pure — never throws, no side effects.
export function productPanelViewModel(product) {
  const { valid, errors } = validateProduct(product);
  if (!valid) return { ok: false, errors, view: null };

  const view = {
    title: product.title,
    imageUrl: product.image || null,
    hasImage: !!product.image,
    priceLabel: priceLabel(product.priceSats),
    seller: product.sellerNpub,
    linkUrl: product.url,
    linkLabel: 'View on Plebeian.Market',
    reward: product.reward || null,
    hasReward: !!product.reward,
  };
  return { ok: true, errors: [], view };
}
