// src/engine/gateway/openVisit.test.js — locks the Phase 0 OPEN-VISIT travel
// path (buildVisitUrl). Pure vitest: a good https website → ok; a javascript:
// scheme → not ok; the traveller pubkey is appended when ourHex is present;
// ok without ourHex (anonymous hop). No three/DOM — importable in the node env.
import { describe, it, expect } from 'vitest';
import { buildVisitUrl } from './openVisit.js';

const GOOD_HEX = 'a'.repeat(64);
const GOOD_HTTPS = 'https://torii-quest.example/quest';

describe('buildVisitUrl — good https website', () => {
  it('returns ok with a hardened https url', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS });
    expect(r.ok).toBe(true);
    expect(r.url).toBeTruthy();
    expect(r.url.startsWith('https://')).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('normalises the url (drops trailing quirks, keeps the path)', () => {
    const r = buildVisitUrl({ website: 'https://torii-quest.example/quest/' });
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://torii-quest.example/quest/');
  });
});

describe('buildVisitUrl — javascript: scheme rejected', () => {
  it('rejects a javascript: url', () => {
    const r = buildVisitUrl({ website: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
    expect(r.url).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects an http: url (https-only)', () => {
    const r = buildVisitUrl({ website: 'http://torii-quest.example/quest' });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects a data: url', () => {
    const r = buildVisitUrl({ website: 'data:text/html,<script>1</script>' });
    expect(r.ok).toBe(false);
  });
});

describe('buildVisitUrl — appends traveller when ourHex present', () => {
  it('appends the hex64 pubkey as ?torii-traveller=', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS }, { ourHex: GOOD_HEX });
    expect(r.ok).toBe(true);
    expect(r.url).toContain('torii-traveller=');
    expect(r.url).toContain(GOOD_HEX);
  });

  it('rejects a non-hex64 ourHex (appendTraveller fails closed)', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS }, { ourHex: 'not-hex' });
    expect(r.ok).toBe(false);
    expect(r.url).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('ok without ourHex (anonymous hop)', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS });
    expect(r.ok).toBe(true);
    expect(r.url).not.toContain('torii-traveller');
  });

  it('ok with an empty/blank ourHex (treated as anonymous)', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS }, { ourHex: '' });
    expect(r.ok).toBe(true);
    expect(r.url).not.toContain('torii-traveller');
  });
});

describe('buildVisitUrl — NAP-zone routing (zoneSlug, Phase 0c)', () => {
  it('appends #/zone/<slug> when a valid zoneSlug is provided', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS }, { zoneSlug: 'plebeian-market-bazaar' });
    expect(r.ok).toBe(true);
    expect(r.url).toContain('#/zone/plebeian-market-bazaar');
  });

  it('appends the zone hash AFTER the traveller param (both present)', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS }, { ourHex: GOOD_HEX, zoneSlug: 'nap-garden' });
    expect(r.ok).toBe(true);
    expect(r.url).toContain('torii-traveller=');
    expect(r.url).toContain(GOOD_HEX);
    expect(r.url).toContain('#/zone/nap-garden');
    // The hash comes after the query (WHATWG URL serialises hash last).
    expect(r.url.indexOf('torii-traveller=')).toBeLessThan(r.url.indexOf('#/zone/'));
  });

  it('leaves the URL unchanged when zoneSlug is invalid (no hash appended)', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS }, { zoneSlug: 'Not A Slug!' });
    expect(r.ok).toBe(true);
    expect(r.url).not.toContain('#/zone/');
    expect(r.url).toBe(GOOD_HTTPS);
  });

  it('leaves the URL unchanged when zoneSlug is absent (null)', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS });
    expect(r.ok).toBe(true);
    expect(r.url).not.toContain('#/zone/');
  });

  it('leaves the URL unchanged when zoneSlug is an empty string', () => {
    const r = buildVisitUrl({ website: GOOD_HTTPS }, { zoneSlug: '' });
    expect(r.ok).toBe(true);
    expect(r.url).not.toContain('#/zone/');
  });

  it('rejects a non-https website even with a valid zoneSlug (ok:false)', () => {
    const r = buildVisitUrl({ website: 'javascript:alert(1)' }, { zoneSlug: 'nap-garden' });
    expect(r.ok).toBe(false);
    expect(r.url).toBeNull();
  });

  it('never throws on a garbage zoneSlug', () => {
    expect(() => buildVisitUrl({ website: GOOD_HTTPS }, { zoneSlug: null })).not.toThrow();
    expect(() => buildVisitUrl({ website: GOOD_HTTPS }, { zoneSlug: 123 })).not.toThrow();
    expect(() => buildVisitUrl({ website: GOOD_HTTPS }, { zoneSlug: {} })).not.toThrow();
  });
});

describe('buildVisitUrl — input guards', () => {
  it('rejects a non-object world', () => {
    expect(buildVisitUrl(null).ok).toBe(false);
    expect(buildVisitUrl(undefined).ok).toBe(false);
    expect(buildVisitUrl('string').ok).toBe(false);
  });

  it('rejects a world with no website', () => {
    expect(buildVisitUrl({}).ok).toBe(false);
    expect(buildVisitUrl({ website: '' }).ok).toBe(false);
    expect(buildVisitUrl({ website: '   ' }).ok).toBe(false);
  });

  it('never throws on garbage', () => {
    expect(() => buildVisitUrl({ website: 'javascript:1' }, { ourHex: 'bad' })).not.toThrow();
    expect(() => buildVisitUrl({ website: null })).not.toThrow();
  });
});
