// tests/product-display.test.js — locks the read-only product display reference
// component (CMP-13 skeleton, src/engine/components/productDisplay.js). Built on
// the v0.2.132 component contract (defineComponent): contract-valid, carries a
// product manifest, has a symmetric idempotent lifecycle, validates listings
// safely, and exposes NO payment path. Pure module → node-testable.
import { describe, it, expect } from 'vitest';
import {
  createProductDisplay, productDisplay, validateProduct, isSafeHttpUrl,
  PRODUCT_DISPLAY_VERSION,
} from '../src/engine/components/productDisplay.js';
import { isComponent, validateManifest } from '../src/engine/components/contract.js';
import * as SDK from '../src/sdk/index.js';

const SELLER = 'npub1seller000000000000000000000000000000000000000000';

describe('productDisplay — contract validity', () => {
  it('the default instance satisfies the component contract', () => {
    expect(isComponent(productDisplay)).toBe(true);
    expect(validateManifest(productDisplay.manifest).valid).toBe(true);
  });
  it('declares a product manifest (kind + provenance npub + panel target)', () => {
    const m = productDisplay.manifest;
    expect(m.kind).toBe('product');
    expect(m.id).toBe('plebeian.product-display');
    expect(m.mountTarget).toBe('panel');
    expect(typeof m.author.npub).toBe('string');
    expect(m.author.npub.length).toBeGreaterThan(0);
    expect(m.version).toBe(PRODUCT_DISPLAY_VERSION);
  });
});

describe('validateProduct', () => {
  const ok = {
    title: 'Sticker Gun', sellerNpub: SELLER, url: 'https://plebeian.market/p/1',
  };
  it('accepts a minimal valid product', () => {
    expect(validateProduct(ok).valid).toBe(true);
  });
  it('requires title, sellerNpub, and url', () => {
    expect(validateProduct({}).valid).toBe(false);
    expect(validateProduct({ title: 'x', url: 'https://a.b' }).valid).toBe(false); // no seller
    expect(validateProduct({ title: 'x', sellerNpub: SELLER }).valid).toBe(false); // no url
  });
  it('rejects a non-npub seller', () => {
    const r = validateProduct({ ...ok, sellerNpub: 'nope' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/sellerNpub/);
  });
  it('rejects non-https url / image (no script or relative URLs)', () => {
    expect(validateProduct({ ...ok, url: 'javascript:alert(1)' }).valid).toBe(false);
    expect(validateProduct({ ...ok, url: '/relative' }).valid).toBe(false);
    expect(validateProduct({ ...ok, image: 'http://insecure' }).valid).toBe(false);
    expect(validateProduct({ ...ok, image: 'https://img.example/a.png' }).valid).toBe(true);
  });
  it('rejects a negative price but allows zero / omitted', () => {
    expect(validateProduct({ ...ok, priceSats: -1 }).valid).toBe(false);
    expect(validateProduct({ ...ok, priceSats: 0 }).valid).toBe(true);
    expect(validateProduct({ ...ok, priceSats: 21000 }).valid).toBe(true);
  });
  it('never throws on junk input', () => {
    expect(validateProduct(null).valid).toBe(false);
    expect(validateProduct(42).valid).toBe(false);
  });
});

describe('createProductDisplay — config flows into the manifest', () => {
  it('carries the supplied product fields incl. the reward hint', () => {
    const c = createProductDisplay({
      title: 'Sticker Gun', image: 'https://img.example/gun.png', sellerNpub: SELLER,
      priceSats: 5000, url: 'https://plebeian.market/p/42', reward: 'skin:sticker-gun',
    });
    expect(c.manifest.author.npub).toBe(SELLER);
    expect(c.manifest.product).toEqual({
      title: 'Sticker Gun', image: 'https://img.example/gun.png', sellerNpub: SELLER,
      priceSats: 5000, url: 'https://plebeian.market/p/42', reward: 'skin:sticker-gun',
    });
    expect(validateManifest(c.manifest).valid).toBe(true);
    expect(validateProduct(c.manifest.product).valid).toBe(true);
  });
});

describe('productDisplay — symmetric idempotent lifecycle (no payment path)', () => {
  it('mount then unmount toggles the mounted flag and is idempotent', () => {
    const c = createProductDisplay();
    const scene = { tag: 'panel' };
    expect(c.mounted).toBe(false);
    expect(c.mount(scene)).toBe(true);
    expect(c.mounted).toBe(true);
    expect(c.mount(scene)).toBe(false);  // already mounted → no-op
    expect(c.unmount()).toBe(true);
    expect(c.unmount()).toBe(false);     // already down → no-op
  });
  it('exposes no checkout / pay / zap surface (read-only)', () => {
    const c = createProductDisplay();
    expect(c.checkout).toBeUndefined();
    expect(c.pay).toBeUndefined();
    expect(c.zap).toBeUndefined();
  });
});

describe('isSafeHttpUrl — SEC-3 URL-object hardening (v0.2.354)', () => {
  // Accepts plain https:// URLs and rejects everything else. Behavior locks the
  // WHATWG URL-parser replacement of the old regex string check.
  it('accepts well-formed https URLs', () => {
    expect(isSafeHttpUrl('https://plebeian.market/p/1')).toBe(true);
    expect(isSafeHttpUrl('https://img.example/a.png?x=1&y=2#frag')).toBe(true);
    expect(isSafeHttpUrl('https://user:pass@host.example/path')).toBe(true);
    expect(isSafeHttpUrl('https://xn--nxasmq6b.example/')).toBe(true); // IDN punycode
    expect(isSafeHttpUrl('  https://host.example/  ')).toBe(true);    // trim ok
  });
  it('rejects any non-https scheme', () => {
    expect(isSafeHttpUrl('http://insecure.example')).toBe(false);
    expect(isSafeHttpUrl('ftp://host.example')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('mailto:a@b.example')).toBe(false);
  });
  it('rejects script-URL smuggling attempts the old regex would have caught, plus a URL-parser-only class', () => {
    // The old string check already blocked bare `javascript:` (no leading https://).
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    // A trailing embedded `javascript:` inside path/hash is still a valid https
    // URL to the URL parser — host stays trustworthy; content is opaque to us.
    expect(isSafeHttpUrl('https://host.example/#javascript:alert(1)')).toBe(true);
  });
  it('rejects malformed / relative / hostless inputs', () => {
    // Not parseable as a URL at all — old regex would happily accept anything
    // starting with `https://` even if unparseable; URL parser rejects it.
    expect(isSafeHttpUrl('/relative')).toBe(false);
    expect(isSafeHttpUrl('plebeian.market')).toBe(false);
    expect(isSafeHttpUrl('https://')).toBe(false); // no host at all
    expect(isSafeHttpUrl('https:javascript:alert(1)')).toBe(false); // unparseable
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl('   ')).toBe(false);
    // Embedded whitespace / control chars — old regex `[^\s]+` already rejected
    // these; keep the invariant explicit under the URL-parser rewrite.
    expect(isSafeHttpUrl('https://host.example/ path')).toBe(false);
    expect(isSafeHttpUrl('https://host.example/\npath')).toBe(false);
    expect(isSafeHttpUrl('https://host.example/\tpath')).toBe(false);
  });
  it('normalises permissive but safe inputs to real https hosts (WHATWG parser behaviour)', () => {
    // Documented behaviour: the WHATWG parser accepts `https:host`, `https:///host`,
    // and backslash variants and normalises them to `https://host/`. These have a
    // real hostname the app can navigate to — there's no smuggled scheme — so we
    // accept them. This test locks that behaviour so a future "tighter" rewrite
    // has to make an explicit call about breaking it.
    expect(isSafeHttpUrl('https:host.example')).toBe(true);
    expect(isSafeHttpUrl('https:///host.example')).toBe(true);
    expect(isSafeHttpUrl('HTTPS://host.example/')).toBe(true);
  });
  it('never throws on non-string / junk input', () => {
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(42)).toBe(false);
    expect(isSafeHttpUrl({})).toBe(false);
    expect(isSafeHttpUrl(['https://host.example'])).toBe(false);
  });
  it('validateProduct rejects the class of inputs the old regex accepted but the parser refuses', () => {
    const ok = { title: 'x', sellerNpub: 'npub1seller000000000000000000000000000000000000000000' };
    // Old regex `^https:\/\/[^\s]+$` accepted the strings below; URL parser rejects.
    expect(validateProduct({ ...ok, url: 'https://' }).valid).toBe(false);
    expect(validateProduct({ ...ok, url: 'https://good.example', image: 'https://' }).valid).toBe(false);
  });
});

describe('productDisplay — SDK exposure', () => {
  it('is re-exported from the SDK at the experimental tier', () => {
    expect(typeof SDK.productDisplay.createProductDisplay).toBe('function');
    expect(isComponent(SDK.productDisplay.productDisplay)).toBe(true);
    expect(SDK.SDK_SURFACE.productDisplay.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.surfacesByTier(SDK.STABILITY.EXPERIMENTAL)).toContain('productDisplay');
  });
});
