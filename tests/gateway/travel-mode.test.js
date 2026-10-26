// v0.2.935 (ADR-0147 M3.3) — automatic, labelled travel mode (pure).
import { describe, it, expect } from 'vitest';
import { chooseTravelMode, visitPlanFor } from '../../src/engine/gateway/travelMode.js';

const ME = 'ab'.repeat(32);
const row = { pubkey: 'cd'.repeat(32), website: 'https://other-engine.example/play/', zoneId: 'garden', zoneType: 'nap' };

describe('chooseTravelMode', () => {
  it('a resolved Torii world is entered in place', () => {
    expect(chooseTravelMode({ ok: true, world: { id: 'w' } }, row)).toEqual({ mode: 'enter' });
  });
  it('no Torii description → a labelled visit to the hardened Gate v1 hop', () => {
    const m = chooseTravelMode({ ok: false, reason: 'no-reference' }, row, { ourHex: ME });
    expect(m.mode).toBe('visit');
    expect(m.note).toBe('other-engine');
    expect(m.host).toBe('other-engine.example');
    const u = new URL(m.url);
    expect(u.protocol).toBe('https:');
    expect(u.searchParams.get('torii-traveller')).toBe(ME);
    expect(u.hash).toBe('#/zone/garden');
  });
  it('a world Quest could not build is offered as a visit (enter-failed)', () => {
    for (const reason of ['fetch-failed', 'bad-json', 'invalid-world', 'resolve-error']) {
      expect(chooseTravelMode({ ok: false, reason }, row).note).toBe('enter-failed');
    }
  });
  it('forgery / tampering signals are refused, never offered', () => {
    for (const reason of ['bad-sig', 'hash-mismatch', 'bad-reference', 'bad-npub', undefined]) {
      expect(chooseTravelMode({ ok: false, reason }, row).mode).toBe('none');
    }
  });
  it('no usable website → none', () => {
    for (const website of ['', 'http://x.example/', 'https://localhost/', 'https://a:b@x.example/', 'https://x.example:8443/', 'javascript:alert(1)']) {
      expect(chooseTravelMode({ ok: false, reason: 'no-reference' }, { ...row, website }).mode).toBe('none');
    }
  });
  it('visitPlanFor drops a malformed traveller and non-nap zones', () => {
    const p = visitPlanFor({ ...row, zoneType: 'arena' }, { ourHex: 'nothex' });
    expect(new URL(p.url).searchParams.get('torii-traveller')).toBeNull();
    expect(new URL(p.url).hash).toBe('');
    expect(visitPlanFor(null)).toBeNull();
  });
});
