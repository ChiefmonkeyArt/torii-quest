// tests/url-harden.test.js — SEC-3 product URL hardening (v0.2.253, P2).
// Asserts the gate that must clear before any armed spawn URL becomes navigable.
// A failure NEVER yields a url; the caller treats !ok as "do not jump".
import { describe, it, expect } from 'vitest';
import { hardenSpawnUrl, appendTraveller } from '../src/engine/gateway/urlHarden.js';

describe('urlHarden — hardenSpawnUrl accept path', () => {
  it('accepts a clean https URL and re-emits the canonical href', () => {
    const r = hardenSpawnUrl('https://quest-torii.pplx.app');
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.url).toBe('https://quest-torii.pplx.app/');
  });

  it('preserves path + query on a valid https URL', () => {
    const r = hardenSpawnUrl('https://example.com/zone/nap?to=world-2');
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://example.com/zone/nap?to=world-2');
  });

  it('accepts a pplx.app host with a subdomain', () => {
    const r = hardenSpawnUrl('https://other-host.pplx.app/');
    expect(r.ok).toBe(true);
  });
});

describe('urlHarden — hardenSpawnUrl reject path (scheme / shape)', () => {
  it('rejects javascript: scheme', () => {
    const r = hardenSpawnUrl('javascript:alert(1)');
    expect(r.ok).toBe(false);
    expect(r.url).toBeNull();
    expect(r.errors).toContain('scheme-must-be-https');
  });

  it('rejects http: scheme', () => {
    const r = hardenSpawnUrl('http://example.com/');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('scheme-must-be-https');
  });

  it('rejects data: scheme', () => {
    const r = hardenSpawnUrl('data:text/html,<script>alert(1)</script>');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('scheme-must-be-https');
  });

  it('rejects an unparseable string', () => {
    const r = hardenSpawnUrl('not a url at all');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('url-unparseable');
  });

  it('rejects empty / non-string input', () => {
    expect(hardenSpawnUrl('').errors).toContain('url-required');
    expect(hardenSpawnUrl(null).errors).toContain('url-required');
    expect(hardenSpawnUrl(undefined).errors).toContain('url-required');
  });

  it('rejects an oversized URL', () => {
    const r = hardenSpawnUrl('https://example.com/' + 'x'.repeat(2100));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('url-too-long');
  });
});

describe('urlHarden — hardenSpawnUrl reject path (credentials / private hosts)', () => {
  it('rejects credentials embedded in the URL', () => {
    const r = hardenSpawnUrl('https://user:pass@example.com/');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('no-credentials-in-url');
  });

  it('rejects localhost by default', () => {
    const r = hardenSpawnUrl('https://localhost:3000/');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('private-host-rejected');
  });

  it('rejects 127.0.0.1 by default', () => {
    const r = hardenSpawnUrl('https://127.0.0.1/');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('private-host-rejected');
  });

  it('rejects an RFC1918 private host by default', () => {
    const r = hardenSpawnUrl('https://192.168.1.5/');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('private-host-rejected');
  });

  it('allows localhost when allowPrivate:true (dev opt-in)', () => {
    const r = hardenSpawnUrl('https://localhost:3000/', { allowPrivate: true });
    expect(r.ok).toBe(true);
  });
});

describe('urlHarden — hardenSpawnUrl allowlist', () => {
  it('accepts a host on the allowlist', () => {
    const r = hardenSpawnUrl('https://quest-torii.pplx.app/', {
      allowHosts: ['quest-torii.pplx.app'],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a host NOT on the allowlist (case-insensitive match)', () => {
    const r = hardenSpawnUrl('https://evil.example.com/', {
      allowHosts: ['quest-torii.pplx.app'],
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('host-not-allowlisted');
  });

  it('allowlist match is case-insensitive', () => {
    const r = hardenSpawnUrl('https://Quest-Torii.PPLX.app/', {
      allowHosts: ['quest-torii.pplx.app'],
    });
    expect(r.ok).toBe(true);
  });
});

describe('urlHarden — appendTraveller', () => {
  const PK = 'a'.repeat(64);
  it('appends the traveller pubkey as a query param', () => {
    const r = appendTraveller('https://quest-torii.pplx.app/', PK);
    expect(r.ok).toBe(true);
    expect(r.url).toContain('torii-traveller=' + PK);
  });

  it('preserves existing query params', () => {
    const r = appendTraveller('https://example.com/zone?to=world-2', PK);
    expect(r.ok).toBe(true);
    expect(r.url).toContain('to=world-2');
    expect(r.url).toContain('torii-traveller=' + PK);
  });

  it('rejects a non-hex64 pubkey', () => {
    const r = appendTraveller('https://example.com/', 'not-a-pubkey');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad-pubkey');
  });

  it('rejects a non-string url', () => {
    const r = appendTraveller('', PK);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('url-required');
  });
});
