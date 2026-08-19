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
