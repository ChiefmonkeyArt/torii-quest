// tests/product-interaction.test.js — richer product interaction beyond read-only
// proof (M2, v0.2.283). Asserts the pure detail view-model (productDetail.js) and
// the npub-keyed local save store (savedProducts.js): a verified viewer sees an
// enabled SAVE action and can save/unsave; an anon viewer is read-only with a
// connect prompt; saves are isolated per identity and persisted; the detail view
// sanitises hostile description markup and never exposes a commerce/checkout action.
import { describe, it, expect } from 'vitest';
import {
  productDetailView, PRODUCT_DETAIL_BADGE,
} from '../src/engine/components/productDetail.js';
import {
  productKey, _identityKey, readSavedFor, savedCountFor, isProductSaved,
  setProductSaved, toggleProductSaved, SAVED_PRODUCTS_KEY, MAX_SAVED_PER_IDENTITY,
} from '../src/engine/components/savedProducts.js';
import * as SDK from '../src/sdk/index.js';

// A minimal in-memory Storage stand-in (the Web Storage subset the module touches).
function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const NPUB = 'npub1demo0traveller0fixture0torii0quest0xxxxxxxxxxxxxxxxxxxx';

const PRODUCT = Object.freeze({
  title: 'Sticker Gun Skin',
  sellerNpub: 'npub1demo0seller0fixture0pleb0market0xxxxxxxxxxxxxxxxxxxx',
  priceSats: 2100,
  url: 'https://plebeian.market/listing/sticker-gun',
  reward: 'Sticker Gun skin',
  description: 'A bright orange wrap.',
});

describe('productDetailView', () => {
  it('renders a full detail view-model with seller, price, reward, link', () => {
    const v = productDetailView(PRODUCT, { viewer: HEX_A, saved: false });
    expect(v.ok).toBe(true);
    expect(v.product).toBe('Sticker Gun Skin');
    expect(v.priceLabel).toBe('2100 sats');
    expect(v.reward).toBe('Sticker Gun skin');
    expect(v.badge).toBe(PRODUCT_DETAIL_BADGE);
    expect(v.marketplace.actionable).toBe(false);
    expect(v.lines.some((l) => l.label === 'About')).toBe(true);
  });

  it('enables the SAVE action for a verified viewer (hex pubkey or npub)', () => {
    for (const viewer of [HEX_A, NPUB]) {
      const v = productDetailView(PRODUCT, { viewer, saved: false });
      expect(v.interaction.kind).toBe('save');
      expect(v.interaction.enabled).toBe(true);
      expect(v.interaction.local).toBe(true);
      expect(v.interaction.label).toBe('SAVE');
      expect(v.interaction.hint).toBe('');
    }
  });

  it('reflects a saved state with a SAVED label', () => {
    const v = productDetailView(PRODUCT, { viewer: HEX_A, saved: true });
    expect(v.interaction.saved).toBe(true);
    expect(v.interaction.label).toBe('SAVED ✓');
  });

  it('anon viewer → read-only, disabled save with a connect prompt', () => {
    const v = productDetailView(PRODUCT, { viewer: null });
    expect(v.interaction.enabled).toBe(false);
    expect(v.interaction.saved).toBe(false);
    expect(v.interaction.hint).toBe('connect a Nostr identity to save');
    expect(v.readOnly).toBe(true);
    expect(v.actionable).toBe(false); // no commerce/checkout action ever
  });

  it('sanitises hostile description markup — strips angle brackets + control chars', () => {
    const hostile = 'pwn<script>alert(1)' + String.fromCharCode(9, 0) + '</script>tail';
    const v = productDetailView({ ...PRODUCT, description: hostile }, { viewer: HEX_A });
    expect(v.description).not.toMatch(/[<>]/);
    const CONTROL = new RegExp('[' + '\\u0000-\\u001F' + ']');
    expect(CONTROL.test(v.description)).toBe(false);
    expect(v.description).toContain('script'); // text content kept, only markup chars removed
  });

  it('invalid product → UNAVAILABLE, never actionable', () => {
    const v = productDetailView({ title: '' }, { viewer: HEX_A });
    expect(v.ok).toBe(false);
    expect(v.lines[0].value).toBe('UNAVAILABLE');
    expect(v.interaction.enabled).toBe(false);
    expect(v.actionable).toBe(false);
  });
});

describe('savedProducts — identity keying', () => {
  it('productKey is stable (prefers url) and identityKey accepts hex64 + npub only', () => {
    expect(productKey(PRODUCT)).toBe('https://plebeian.market/listing/sticker-gun');
    expect(productKey({ title: 'Just A Title' })).toBe('just a title');
    expect(productKey({})).toBe('');
    expect(_identityKey(HEX_A)).toBe(HEX_A);
    expect(_identityKey(NPUB)).toBe(NPUB);
    expect(_identityKey('')).toBe('');
    expect(_identityKey('not-an-id')).toBe('');
  });

  it('saves under the viewer identity and round-trips', () => {
    const s = memStorage();
    const r = setProductSaved(s, HEX_A, PRODUCT, true, 1000);
    expect(r).toEqual({ ok: true, saved: true, count: 1, reason: null });
    expect(isProductSaved(s, HEX_A, PRODUCT)).toBe(true);
    const list = readSavedFor(s, HEX_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe(PRODUCT.url);
    expect(list[0].at).toBe(1000);
  });

  it('isolates saves per identity — another npub sees an empty list', () => {
    const s = memStorage();
    setProductSaved(s, HEX_A, PRODUCT, true, 1);
    expect(isProductSaved(s, HEX_B, PRODUCT)).toBe(false);
    expect(savedCountFor(s, HEX_B)).toBe(0);
    expect(savedCountFor(s, HEX_A)).toBe(1);
  });

  it('toggle flips the saved state and persists', () => {
    const s = memStorage();
    expect(toggleProductSaved(s, HEX_A, PRODUCT, 1).saved).toBe(true);
    expect(isProductSaved(s, HEX_A, PRODUCT)).toBe(true);
    expect(toggleProductSaved(s, HEX_A, PRODUCT, 2).saved).toBe(false);
    expect(isProductSaved(s, HEX_A, PRODUCT)).toBe(false);
    expect(savedCountFor(s, HEX_A)).toBe(0);
  });

  it('anon (no identity) cannot save — fails closed with reason "anon"', () => {
    const s = memStorage();
    expect(setProductSaved(s, '', PRODUCT, true, 1)).toEqual({ ok: false, saved: false, count: 0, reason: 'anon' });
    expect(setProductSaved(s, null, PRODUCT, true, 1).reason).toBe('anon');
    expect(s.getItem(SAVED_PRODUCTS_KEY)).toBeNull(); // nothing written
  });

  it('a product with no usable key cannot be saved', () => {
    const s = memStorage();
    expect(setProductSaved(s, HEX_A, {}, true, 1).reason).toBe('invalid');
  });

  it('caps a single identity list at MAX_SAVED_PER_IDENTITY (oldest dropped)', () => {
    const s = memStorage();
    for (let i = 0; i < MAX_SAVED_PER_IDENTITY + 5; i += 1) {
      setProductSaved(s, HEX_A, { title: `p${i}`, url: `https://plebeian.market/p/${i}`, sellerNpub: PRODUCT.sellerNpub }, true, i);
    }
    expect(savedCountFor(s, HEX_A)).toBe(MAX_SAVED_PER_IDENTITY);
  });

  it('never throws on malformed / missing / secured storage', () => {
    expect(readSavedFor(null, HEX_A)).toEqual([]);
    expect(readSavedFor(memStorage({ [SAVED_PRODUCTS_KEY]: 'not json' }), HEX_A)).toEqual([]);
    expect(isProductSaved(null, HEX_A, PRODUCT)).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readSavedFor(throwing, HEX_A)).toEqual([]);
    expect(setProductSaved(throwing, HEX_A, PRODUCT, true, 1).ok).toBe(false);
  });
});

describe('SDK exposure', () => {
  it('exposes productDetail + savedProducts at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.productDetail.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.SDK_SURFACE.savedProducts.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.productDetail.productDetailView).toBe('function');
    expect(typeof SDK.savedProducts.toggleProductSaved).toBe('function');
  });
});
