// tests/product-panel.test.js — locks the product panel view-model shell (CMP-13
// continuation, src/engine/components/productPanel.js). Pure module → node-test.
// It turns a validated product into a render-ready view-model. We assert: valid
// products produce a flat view bag, the price label rules hold, invalid products
// degrade to ok:false, and the view-model stays READ-ONLY (no checkout surface).
import { describe, it, expect } from 'vitest';
import { productPanelViewModel, priceLabel } from '../src/engine/components/productPanel.js';
import * as SDK from '../src/sdk/index.js';

const VALID = {
  title: 'Sticker Gun Skin',
  image: 'https://plebeian.market/img/gun.png',
  sellerNpub: 'npub1seller00000000000000000000000',
  priceSats: 2100,
  url: 'https://plebeian.market/p/sticker-gun',
  reward: 'sticker-gun-skin',
};

describe('priceLabel', () => {
  it('formats null / 0 / positive correctly', () => {
    expect(priceLabel(null)).toBe('See price');
    expect(priceLabel(undefined)).toBe('See price');
    expect(priceLabel(0)).toBe('Free');
    expect(priceLabel(2100)).toBe('2100 sats');
  });
});

describe('productPanelViewModel', () => {
  it('builds a flat render-ready view from a valid product', () => {
    const { ok, view } = productPanelViewModel(VALID);
    expect(ok).toBe(true);
    expect(view.title).toBe('Sticker Gun Skin');
    expect(view.imageUrl).toBe(VALID.image);
    expect(view.hasImage).toBe(true);
    expect(view.priceLabel).toBe('2100 sats');
    expect(view.linkUrl).toBe(VALID.url);
    expect(view.linkLabel).toBe('View on Plebeian.Market');
    expect(view.reward).toBe('sticker-gun-skin');
    expect(view.hasReward).toBe(true);
  });

  it('handles a product with no image / no reward / no price', () => {
    const { ok, view } = productPanelViewModel({
      title: 'Plain', sellerNpub: VALID.sellerNpub, url: VALID.url,
    });
    expect(ok).toBe(true);
    expect(view.hasImage).toBe(false);
    expect(view.imageUrl).toBeNull();
    expect(view.hasReward).toBe(false);
    expect(view.priceLabel).toBe('See price');
  });

  it('degrades to ok:false on an invalid product', () => {
    const { ok, errors, view } = productPanelViewModel({ title: '', sellerNpub: 'x', url: 'ftp://x' });
    expect(ok).toBe(false);
    expect(view).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('stays read-only — no checkout/pay/zap fields leak into the view', () => {
    const { view } = productPanelViewModel(VALID);
    for (const k of ['checkout', 'pay', 'zap', 'buy', 'publish']) {
      expect(view).not.toHaveProperty(k);
    }
  });
});

describe('productPanel — SDK exposure', () => {
  it('is re-exported from the SDK at the experimental tier', () => {
    expect(typeof SDK.productPanel.productPanelViewModel).toBe('function');
    expect(SDK.SDK_SURFACE.productPanel.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.surfacesByTier(SDK.STABILITY.EXPERIMENTAL)).toContain('productPanel');
  });
});
