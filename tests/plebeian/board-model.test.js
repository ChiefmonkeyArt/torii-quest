// tests/plebeian/board-model.test.js
// ADR-0035 — pure view-model tests for the owner boards: product parsing,
// on-sale filtering, and the live/past auction split by end_at. No I/O.

import { describe, it, expect } from 'vitest';
import { parseProductEvent, selectOnSaleProducts, splitAuctionsByEnd } from '../../src/engine/plebeian/boardModel.js';
import { parseAuctionEvent } from '../../src/engine/plebeian/auctionModel.js';

const PRODUCT_KIND = 30402;
const AUCTION_KIND = 30408;

function productEvent(over = {}) {
  return {
    id: over.id || 'p1',
    kind: PRODUCT_KIND,
    pubkey: 'owner',
    created_at: over.createdAt ?? 100,
    content: '',
    tags: [
      ['d', over.d || 'noodles'],
      ['title', over.title || 'noodles'],
      ['price', over.price || '15', over.currency || 'GBP'],
      ['visibility', over.visibility || 'on-sale'],
      ['stock', over.stock ?? '21'],
      ...(over.image ? [['image', over.image]] : []),
    ],
  };
}

function auctionEvent(over = {}) {
  return {
    id: over.id || 'a1',
    kind: AUCTION_KIND,
    pubkey: 'owner',
    created_at: over.createdAt ?? 100,
    content: '',
    tags: [
      ['d', over.d || 'auc1'],
      ['title', over.title || 'auction'],
      ['auction_type', 'english'],
      ['schema', 'auction_v1'],
      ['currency', 'SAT'],
      ['starting_bid', '21'],
      ['start_at', String(over.startAt ?? 0)],
      ['end_at', String(over.endAt ?? 0)],
    ],
  };
}

describe('parseProductEvent', () => {
  it('parses a real-shaped kind-30402 event', () => {
    const p = parseProductEvent(productEvent());
    expect(p.title).toBe('noodles');
    expect(p.price).toBe(15);
    expect(p.currency).toBe('GBP');
    expect(p.visibility).toBe('on-sale');
    expect(p.stock).toBe(21);
  });

  it('returns null for the wrong kind or missing d/pubkey', () => {
    expect(parseProductEvent({ kind: 1, tags: [] })).toBeNull();
    expect(parseProductEvent({ kind: PRODUCT_KIND, pubkey: 'x', tags: [] })).toBeNull();
  });

  it('extracts the first still image as poster', () => {
    const p = parseProductEvent(productEvent({ image: 'https://x/pic.jpg' }));
    expect(p.poster).toBe('https://x/pic.jpg');
  });
});

describe('selectOnSaleProducts', () => {
  it('keeps only visibility=on-sale, newest first', () => {
    const events = [
      productEvent({ id: 'p1', d: 'a', createdAt: 1, visibility: 'on-sale' }),
      productEvent({ id: 'p2', d: 'b', createdAt: 5, visibility: 'sold' }),
      productEvent({ id: 'p3', d: 'c', createdAt: 3, visibility: 'on-sale' }),
    ];
    const out = selectOnSaleProducts(events);
    expect(out.map((p) => p.id)).toEqual(['p3', 'p1']);
  });

  it('returns an empty array for no events', () => {
    expect(selectOnSaleProducts([])).toEqual([]);
    expect(selectOnSaleProducts(null)).toEqual([]);
  });
});

describe('splitAuctionsByEnd', () => {
  const now = 1000;

  it('splits live (end_at > now) from past (end_at <= now)', () => {
    const vms = [
      parseAuctionEvent(auctionEvent({ id: 'live1', d: 'x', endAt: 2000 })),
      parseAuctionEvent(auctionEvent({ id: 'past1', d: 'y', endAt: 500 })),
    ];
    const { live, past } = splitAuctionsByEnd(vms, now);
    expect(live.map((a) => a.id)).toEqual(['live1']);
    expect(past.map((a) => a.id)).toEqual(['past1']);
  });

  it('treats an auction with no valid end_at as live (fail open)', () => {
    const vm = parseAuctionEvent(auctionEvent({ id: 'noend', d: 'z', endAt: 0 }));
    const { live, past } = splitAuctionsByEnd([vm], now);
    expect(live.map((a) => a.id)).toEqual(['noend']);
    expect(past.length).toBe(0);
  });

  it('sorts live soonest-ending first and past most-recently-ended first', () => {
    const vms = [
      parseAuctionEvent(auctionEvent({ id: 'live-far', d: 'a', endAt: 5000 })),
      parseAuctionEvent(auctionEvent({ id: 'live-soon', d: 'b', endAt: 1500 })),
      parseAuctionEvent(auctionEvent({ id: 'past-old', d: 'c', endAt: 100 })),
      parseAuctionEvent(auctionEvent({ id: 'past-recent', d: 'd', endAt: 900 })),
    ];
    const { live, past } = splitAuctionsByEnd(vms, now);
    expect(live.map((a) => a.id)).toEqual(['live-soon', 'live-far']);
    expect(past.map((a) => a.id)).toEqual(['past-recent', 'past-old']);
  });

  it('handles an empty list', () => {
    const { live, past } = splitAuctionsByEnd([], now);
    expect(live).toEqual([]);
    expect(past).toEqual([]);
  });
});
