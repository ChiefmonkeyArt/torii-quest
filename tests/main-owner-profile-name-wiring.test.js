// tests/main-owner-profile-name-wiring.test.js — regression lock for the
// v0.2.704-alpha fix: the homepage "This torii belongs to: <label>" caption
// must show the admin's PUBLISHED Nostr displayName to every visitor, not
// just a shortened npub.
//
// main.js is a large entry module with top-level side-effecting imports (DOM
// init wiring) not designed for isolated unit import, so — consistent with
// tests/main-heartbeat-consent.test.js and
// tests/torii-menu-heartbeat-toggle.test.js — this locks the fix at the
// source level via readFileSync + pattern assertions, backed by the full
// behavioral coverage in tests/torii-owner-label.test.js (pure resolver) and
// tests/nostr-fetch-owner-profile-name.test.js (read-only relay fetch).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

describe('main.js owner-profile-name wiring', () => {
  it('imports fetchOwnerProfileName from nostr.js', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*fetchOwnerProfileName[^}]*\}\s*from\s*['"]\.\/nostr\.js['"]/);
  });

  it('_refreshOwnerLabel passes ownerProfileName into resolveToriiOwnerLabel', () => {
    const start = SRC.indexOf('function _refreshOwnerLabel()');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 800);
    expect(body).toMatch(/resolveToriiOwnerLabel\(\{[\s\S]*ownerProfileName:/);
  });

  it('_refreshOwnerLabel keys the cached name to the current adminPubkey (never shows a stale owner name)', () => {
    const start = SRC.indexOf('function _refreshOwnerLabel()');
    const body = SRC.slice(start, start + 800);
    expect(body).toMatch(/adminPubkey\s*===\s*_ownerProfileNamePubkey/);
  });

  it('kicks off a relay fetch for the owner name at most once per adminPubkey (short-circuit guard present)', () => {
    expect(SRC).toMatch(/function _fetchOwnerProfileNameOnce\(/);
    const start = SRC.indexOf('function _fetchOwnerProfileNameOnce(');
    const body = SRC.slice(start, start + 900);
    // Must bail out early when already resolved or already in flight for this pubkey —
    // otherwise every NOSTR_LOGIN/capability re-probe would re-query relays needlessly.
    expect(body).toMatch(/pk === _ownerProfileNamePubkey/);
    expect(body).toMatch(/pk === _ownerProfileNameFetchInFlightFor/);
  });

  it('never reuses fetchProfileProgressive for the admin lookup (that mutates the VIEWER\u2019s own state)', () => {
    const start = SRC.indexOf('function _fetchOwnerProfileNameOnce(');
    const body = SRC.slice(start, start + 900);
    expect(body).not.toMatch(/fetchProfileProgressive/);
  });

  it('does not touch the Update Now button wiring', () => {
    // Guard against scope creep: this fix must stay confined to the owner-label
    // caption and must never alter the confirmed-real deploy action.
    const start = SRC.indexOf('function _refreshOwnerLabel()');
    const body = SRC.slice(start, start + 800);
    expect(body).not.toMatch(/update-now|onUpdateNow|triggerUpdate/i);
  });
});
