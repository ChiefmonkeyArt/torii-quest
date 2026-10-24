// ADR-0145 slice 1 (v0.2.915): NAP boards show THIS world's owner, with
// signature-checked, owner-only, newest-per-listing events.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveBoardOwner, mergeOwnerEvents } from '../../src/engine/plebeian/boardOwner.js';
import { signEvent } from '../../conformance/gateway-v1/gate-v1.mjs';
import { PLEBEIAN_PRODUCT_RELAYS, PLEBEIAN_AUCTION_RELAYS } from '../../src/config.js';

const SKA = '11'.repeat(32);
const SKB = '22'.repeat(32);
const A = signEvent({ kind: 30402, created_at: 100, tags: [['d', 'x']], content: 'a' }, SKA).pubkey;
const doc = (v) => ({ querySelector: (s) => (s === 'meta[name="torii-host-pubkey"]' && v != null ? { getAttribute: () => v } : null) });

describe('resolveBoardOwner', () => {
  it('prefers window.__toriiHostPubkey, then the meta, then ADMIN_PUBKEY_HEX', () => {
    expect(resolveBoardOwner({ win: { __toriiHostPubkey: 'a'.repeat(64) }, doc: doc('b'.repeat(64)), adminHex: 'c'.repeat(64) })).toBe('a'.repeat(64));
    expect(resolveBoardOwner({ win: {}, doc: doc('B'.repeat(64)), adminHex: 'c'.repeat(64) })).toBe('b'.repeat(64));
    expect(resolveBoardOwner({ win: {}, doc: doc(null), adminHex: 'c'.repeat(64) })).toBe('c'.repeat(64));
  });
  it('rejects malformed values and returns "" with nothing usable', () => {
    expect(resolveBoardOwner({ win: { __toriiHostPubkey: 'npub1xyz' }, doc: doc('zz'), adminHex: '' })).toBe('');
    expect(resolveBoardOwner({ win: undefined, doc: undefined, adminHex: 'nope' })).toBe('');
  });
});

describe('mergeOwnerEvents', () => {
  const p1 = signEvent({ kind: 30402, created_at: 100, tags: [['d', 'x']], content: 'old' }, SKA);
  const p2 = signEvent({ kind: 30402, created_at: 200, tags: [['d', 'x']], content: 'new' }, SKA);
  const p3 = signEvent({ kind: 30402, created_at: 150, tags: [['d', 'y']], content: 'y' }, SKA);
  const other = signEvent({ kind: 30402, created_at: 300, tags: [['d', 'x']], content: 'not owner' }, SKB);
  it('keeps the newest per listing across relays', () => {
    const out = mergeOwnerEvents([[p1, p3], [p2, p1]], A);
    expect(out.map((e) => e.content).sort()).toEqual(['new', 'y']);
  });
  it('drops other authors, forged pubkeys and tampered content', () => {
    const forged = { ...other, pubkey: A };
    const tampered = { ...p2, content: 'tampered', created_at: 999 };
    expect(mergeOwnerEvents([[other, forged, tampered, p1]], A).map((e) => e.content)).toEqual(['old']);
  });
  it('returns [] without a valid owner or with junk input', () => {
    expect(mergeOwnerEvents([[p1]], '')).toEqual([]);
    expect(mergeOwnerEvents(null, A)).toEqual([]);
    expect(mergeOwnerEvents([null, [null, 5]], A)).toEqual([]);
  });
});

describe('ownerBoards wiring (owner decisions 2026-10-22)', () => {
  const src = readFileSync('src/engine/plebeian/ownerBoards.js', 'utf8');
  it('products from production + staging, auctions from staging', () => {
    expect(PLEBEIAN_PRODUCT_RELAYS).toEqual(['wss://relay.plebeian.market', 'wss://relay.staging.plebeian.market']);
    expect(PLEBEIAN_AUCTION_RELAYS).toEqual(['wss://relay.staging.plebeian.market']);
    expect(src).toMatch(/\[PLEBEIAN_PRODUCT_RELAYS, PLEBEIAN_PRODUCT_KIND, _productByRelay,/);
    expect(src).toMatch(/\[PLEBEIAN_AUCTION_RELAYS, PLEBEIAN_AUCTION_KIND, _auctionByRelay,/);
  });
  it('resolves the host owner, merges through the verifier, and closes sockets on hide', () => {
    expect(src).toMatch(/_owner = _ownerOverride !== undefined \? _ownerOverride : resolveBoardOwner\(\{ adminHex: ADMIN_PUBKEY_HEX \}\)/);
    expect(src).toMatch(/mergeStoreEvents\(\[\.\.\.byRelay\.values\(\)\], _store\)/);
    expect(src).toMatch(/if \(!_store\) _store = ownerStore\(_owner\);/);
    expect(src).toMatch(/if \(!active && wasActive && !_worldWanted\) stop\(\);/); // v0.2.919: world boards keep the feed
    expect(src).not.toMatch(/!ADMIN_PUBKEY_HEX\) return/);
  });
});
