// tests/napplets/product-napplet-snapshot.test.js — ADR-0058. Pure: the serializer
// that turns an auction view-model into plain JSON safe to postMessage into a
// sandboxed napplet iframe. No DOM, no jsdom.
import { describe, it, expect } from 'vitest';
import { serializeBidList, buildSurfaceUpdatePayload, PRODUCT_CHANNEL } from '../../src/engine/napplets/productNappletSnapshot.js';

// A minimal view-model shaped like buildAuctionViewModel() output. `bidder` already
// carries a resolved {name, picture, initial, hue} (picture must be dropped in v1).
function vm(bids, extra = {}) {
  return {
    auction: { title: 'Cornish Pasty', currency: 'SAT', ...extra.auction },
    status: { phase: 'live', secondsRemaining: 600, ...extra.status },
    highBid: 1500,
    bidCount: bids.length,
    nextMinBid: 1600,
    bids,
    ...extra,
  };
}

function bid(amount, pubkey, opts = {}) {
  return {
    id: 'bid-' + amount,
    time: opts.time || 1700000000 + amount,
    amount,
    isTopBid: !!opts.isTopBid,
    isMonotonic: opts.isMonotonic !== false,
    bidderPubkey: pubkey,
    bidder: {
      name: opts.name || null,
      picture: 'https://evil.example/p.png', // MUST be stripped in v1
      initial: opts.initial || (opts.name ? opts.name[0].toUpperCase() : (pubkey ? pubkey[0].toUpperCase() : '?')),
      hue: opts.hue ?? 42,
    },
  };
}

describe('serializeBidList', () => {
  it('returns null when there is no view-model or no auction', () => {
    expect(serializeBidList(null)).toBeNull();
    expect(serializeBidList({})).toBeNull();
    expect(serializeBidList({ status: {} })).toBeNull();
  });

  it('strips remote picture URLs (v1 uses initials only)', () => {
    const out = serializeBidList(vm([bid(100, 'pk1', { name: 'Alice' })]));
    expect(out.bids[0].bidder.picture).toBeUndefined();
    expect(out.bids[0].bidder.name).toBe('Alice');
    expect(out.bids[0].bidder.initial).toBe('A');
    expect(out.bids[0].bidder.hue).toBe(42);
  });

  it('keeps only the fields the renderer needs (no Maps, no functions, no raw events)', () => {
    const out = serializeBidList(vm([bid(100, 'pk1')]));
    const row = out.bids[0];
    expect(Object.keys(row).sort()).toEqual(['amount', 'bidder', 'isMonotonic', 'isTopBid', 'time']);
    expect(Object.keys(row.bidder).sort()).toEqual(['hue', 'initial', 'name']);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out); // fully cloneable
  });

  it('sorts bids highest-first and caps at 64 rows', () => {
    const bids = [];
    for (let i = 1; i <= 100; i++) bids.push(bid(i * 10, 'pk' + i));
    const out = serializeBidList(vm(bids));
    expect(out.bids).toHaveLength(64);
    expect(out.bids[0].amount).toBe(1000); // highest first
    expect(out.bids[63].amount).toBe(370);
  });

  it('preserves phase + high bid + currency in the envelope', () => {
    const out = serializeBidList(vm([bid(100, 'pk1')], { auction: { title: 'T', currency: 'BTC' } }));
    expect(out.title).toBe('T');
    expect(out.currency).toBe('BTC');
    expect(out.phase).toBe('live');
    expect(out.highBid).toBe(1500);
  });
});

describe('buildSurfaceUpdatePayload', () => {
  it('stamps the channel name + seq + status + snapshot', () => {
    const snap = serializeBidList(vm([bid(100, 'pk1')]));
    const payload = buildSurfaceUpdatePayload(snap, 'connected · live', 3);
    expect(payload.channel).toBe(PRODUCT_CHANNEL);
    expect(payload.channel).toBe('plebeian.auction');
    expect(payload.seq).toBe(3);
    expect(payload.status).toBe('connected · live');
    expect(payload.snapshot).toBe(snap);
  });

  it('defaults seq + status safely', () => {
    const payload = buildSurfaceUpdatePayload(null, null, undefined);
    expect(payload.seq).toBe(0);
    expect(payload.status).toBe('');
    expect(payload.snapshot).toBeNull();
  });
});
