// ADR-0145 (v0.2.916): the NAP store shows the owner's shop by default; the
// owner can pick another seller's npub, or a custom list of products/auctions.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { nip19 } from 'nostr-tools';
import { naddrToCoord, npubToHex } from '../../src/engine/crypto/npub.js';
import {
  STORE_KIND, STORE_D, STORE_MAX_ITEMS, ownerStore, parseStoreConfig, resolveStoreConfig,
  storeFilters, mergeStoreEvents, buildStoreEvent, storeKey,
} from '../../src/engine/plebeian/boardOwner.js';
import { previewStore, publishStore } from '../../src/engine/plebeian/napStoreAdmin.js';
import { signEvent } from '../../conformance/gateway-v1/gate-v1.mjs';

const SK_OWNER = '11'.repeat(32), SK_SELLER = '22'.repeat(32), SK_X = '33'.repeat(32);
const pk = (sk) => signEvent({ kind: 1, created_at: 1, tags: [], content: '' }, sk).pubkey;
const OWNER = pk(SK_OWNER), SELLER = pk(SK_SELLER), X = pk(SK_X);
const store = (tags, at = 100, sk = SK_OWNER) => signEvent({ kind: STORE_KIND, created_at: at, tags: [['d', STORE_D], ...tags], content: '' }, sk);
const listing = (kind, d, at, sk, content = d) => signEvent({ kind, created_at: at, tags: [['d', d]], content }, sk);

describe('naddrToCoord', () => {
  it('decodes a real naddr (as Plebeian shares) and passes raw coordinates through', () => {
    const n = nip19.naddrEncode({ kind: 30402, pubkey: SELLER, identifier: 'hat-01', relays: ['wss://relay.staging.plebeian.market'] });
    expect(naddrToCoord(n)).toBe(`30402:${SELLER}:hat-01`);
    expect(naddrToCoord('nostr:' + n)).toBe(`30402:${SELLER}:hat-01`);
    expect(naddrToCoord(`30408:${SELLER}:auc`)).toBe(`30408:${SELLER}:auc`);
  });
  it('rejects junk, a bad checksum and other bech32 types', () => {
    const n = nip19.naddrEncode({ kind: 30402, pubkey: SELLER, identifier: 'x' });
    expect(naddrToCoord(n.slice(0, -1) + (n.endsWith('q') ? 'p' : 'q'))).toBeNull();
    expect(naddrToCoord(nip19.npubEncode(SELLER))).toBeNull();
    expect(naddrToCoord('hello')).toBeNull();
    expect(naddrToCoord(42)).toBeNull();
  });
});

describe('store config', () => {
  it('no event → the owner\'s own shop', () => {
    expect(resolveStoreConfig([], OWNER)).toEqual(ownerStore(OWNER));
    expect(resolveStoreConfig([store([])], OWNER)).toEqual(ownerStore(OWNER));
  });
  it('a p tag → that seller\'s shop; a tags → a custom store (a wins over p)', () => {
    expect(resolveStoreConfig([store([['p', SELLER]])], OWNER)).toEqual({ mode: 'seller', seller: SELLER, items: [] });
    const c = resolveStoreConfig([store([['p', SELLER], ['a', `30402:${SELLER}:hat`], ['a', `30408:${X}:auc`]])], OWNER);
    expect(c).toEqual({ mode: 'custom', seller: '', items: [`30402:${SELLER}:hat`, `30408:${X}:auc`] });
  });
  it('only the owner can set it, signatures are checked, newest wins', () => {
    expect(resolveStoreConfig([store([['p', SELLER]], 100, SK_X)], OWNER)).toEqual(ownerStore(OWNER));
    const forged = { ...store([['p', SELLER]]), tags: [['d', STORE_D], ['p', X]] };
    expect(parseStoreConfig(forged, OWNER)).toBeNull();
    expect(resolveStoreConfig([store([['p', SELLER]], 100), store([['p', X]], 200)], OWNER).seller).toBe(X);
  });
  it('ignores non-listing a-tags and caps custom stores', () => {
    const many = Array.from({ length: 40 }, (_, i) => ['a', `30402:${SELLER}:i${i}`]);
    expect(resolveStoreConfig([store([['a', `1:${SELLER}:x`], ...many])], OWNER).items).toHaveLength(STORE_MAX_ITEMS);
  });
});

describe('filters + merge', () => {
  const custom = { mode: 'custom', seller: '', items: [`30402:${SELLER}:hat`, `30402:${SELLER}:mug`, `30408:${X}:auc`] };
  it('owner/seller → one author filter; custom → one filter per author with #d', () => {
    expect(storeFilters({ mode: 'seller', seller: SELLER, items: [] }, 30402)).toEqual([{ authors: [SELLER], kinds: [30402], limit: 500 }]);
    expect(storeFilters(custom, 30402)).toEqual([{ authors: [SELLER], kinds: [30402], '#d': ['hat', 'mug'], limit: 8 }]);
    expect(storeFilters(custom, 30408)).toEqual([{ authors: [X], kinds: [30408], '#d': ['auc'], limit: 4 }]);
    expect(storeFilters(null, 30402)).toEqual([]);
  });
  it('custom merge keeps only the chosen, signed items, newest each', () => {
    const lists = [[listing(30402, 'hat', 1, SK_SELLER, 'old'), listing(30402, 'other', 1, SK_SELLER)], [listing(30402, 'hat', 2, SK_SELLER, 'new'), listing(30402, 'hat', 9, SK_X, 'imposter')]];
    expect(mergeStoreEvents(lists, custom).map((e) => e.content)).toEqual(['new']);
    const tampered = { ...listing(30402, 'mug', 3, SK_SELLER), content: 'changed' };
    expect(mergeStoreEvents([[tampered]], custom)).toEqual([]);
  });
  it('storeKey changes only when the store changes', () => {
    expect(storeKey(ownerStore(OWNER))).toBe(storeKey(ownerStore(OWNER)));
    expect(storeKey(custom)).not.toBe(storeKey(ownerStore(OWNER)));
  });
});

describe('napStore console helper', () => {
  const n = nip19.naddrEncode({ kind: 30402, pubkey: SELLER, identifier: 'hat' });
  it('preview builds the unsigned set and says what it will show', () => {
    expect(previewStore({ owner: OWNER, seller: nip19.npubEncode(SELLER) }).shows).toMatch(/^seller /);
    const p = previewStore({ owner: OWNER, items: [n] });
    expect(p.shows).toBe('custom store: 1 item(s)');
    expect(p.event.tags).toContainEqual(['a', `30402:${SELLER}:hat`]);
    expect(previewStore({ owner: OWNER }).shows).toBe('your own shop');
    expect(previewStore({ owner: OWNER, items: ['nope'] }).ok).toBe(false);
    expect(previewStore({ owner: '' }).ok).toBe(false);
  });
  it('publish refuses unless the signer is this world\'s owner', async () => {
    const sign = vi.fn(); const publish = vi.fn();
    const r = await publishStore({ owner: OWNER, items: [n], sign, publish, getSignerPubkey: async () => X });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/not this world's owner/);
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
  it('publish signs with the owner and fans out', async () => {
    const sign = async (u) => ({ ok: true, event: signEvent(u, SK_OWNER) });
    const publish = vi.fn(async () => ({ accepted: 1, failed: ['wss://down'] }));
    const r = await publishStore({ owner: OWNER, seller: SELLER, sign, publish, getSignerPubkey: async () => OWNER });
    expect(r).toMatchObject({ ok: true, accepted: 1, failedRelays: ['wss://down'] });
    expect(parseStoreConfig(publish.mock.calls[0][0], OWNER)).toEqual({ mode: 'seller', seller: SELLER, items: [] });
  });
});

describe('wiring', () => {
  const ob = readFileSync('src/engine/plebeian/ownerBoards.js', 'utf8');
  const main = readFileSync('src/main.js', 'utf8');
  it('boards follow the owner store set and reopen listings only on change', () => {
    expect(ob).toMatch(/filters: \[\{ authors: \[_owner\], kinds: \[STORE_KIND\], '#d': \[STORE_D\], limit: 4 \}\]/);
    expect(ob).toMatch(/if \(storeKey\(next\) !== storeKey\(_store\)\) \{ _store = next; openListings\(true\); \}/);
    expect(ob).toMatch(/set\(mergeStoreEvents\(\[\.\.\.byRelay\.values\(\)\], _store\)\)/);
  });
  it('the console helper is lazy and publishes only to the Plebeian relays', () => {
    expect(main).toMatch(/window\.ToriiDebug\.napStore = \{/);
    expect(main).toMatch(/publish: \(ev\) => fanoutPublish\(PLEBEIAN_PRODUCT_RELAYS, ev\)/);
    expect(main).not.toMatch(/^import .*napStoreAdmin/m);
    expect(npubToHex(nip19.npubEncode(SELLER))).toBe(SELLER);
  });
});
