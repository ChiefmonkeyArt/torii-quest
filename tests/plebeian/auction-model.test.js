// tests/plebeian/auction-model.test.js
// ADR-0026 — tests the pure auction view-model against REAL Plebeian event shapes
// captured from relay.staging.plebeian.market on 2026-08-22 (the owner's first
// test auction, id 55d80b60...6f6cb).

import { describe, it, expect } from 'vitest';
import {
  parseAuctionEvent,
  parseBidEvent,
  buildBidHistory,
  auctionStatus,
  buildAuctionViewModel,
} from '../../src/engine/plebeian/auctionModel.js';

const SELLER = 'ec79b568bdea63ca6091f5b84b0c639c10a0919e175fa09a4de3154f82906f25';
const AUC_ID = '55d80b60877693e4e5e8a20c358b6a03657fc74912bab90abf1fc7221266f6cb';
const A_D = 'auction_1787326152656_1kb5y';
const A_TAG = `30408:${SELLER}:${A_D}`;

// Minimal but shape-accurate auction event (kind 30408).
const auctionEvent = {
  id: AUC_ID,
  kind: 30408,
  pubkey: SELLER,
  created_at: 1787326152,
  content: 'FUN FACTs... Total Hash Rate, Bitcoin Price, cityscape...',
  tags: [
    ['d', A_D],
    ['title', 'Building from Strength to Strength'],
    ['summary', 'A snapshot in time of the brave new world'],
    ['auction_type', 'english'],
    ['start_at', '1787326152'],
    ['end_at', '1787329752'],
    ['currency', 'SAT'],
    ['price', '21', 'SAT'],
    ['starting_bid', '21', 'SAT'],
    ['bid_increment', '10'],
    ['reserve', '21'],
    ['schema', 'auction_v1'],
    ['key_scheme', 'hd_p2pk'],
    ['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
    ['image', 'https://cdn.nostrcheck.me/a.jpeg', '800x600', '0'],
    ['image', 'https://cdn.nostrcheck.me/b.mp4', '800x600', '8'],
    ['t', 'Art'], ['t', 'Bitcoin'],
    ['spec', 'Height', '50 cm'], ['spec', 'Width', '30 cm'],
  ],
};

// Real bid sequence (amounts only; times from created_at). The last two are the
// bug: 150010 and 150661 both BELOW the prior high of 169000.
const bidAmounts = [2100, 4200, 5550, 5560, 6000, 6010, 21000, 22000, 33333,
  33343, 33353, 69000, 69420, 96420, 121000, 150000, 169000, 150010, 150661];
const bidEvents = bidAmounts.map((amt, i) => ({
  id: `bid${i}`,
  kind: 1023,
  pubkey: `bidder${i % 3}`,
  created_at: 1787326152 + 60 * (i + 1),
  content: '',
  tags: [
    ['e', AUC_ID],
    ['a', A_TAG],
    ['p', SELLER],
    ['amount', String(amt)],
    ['currency', 'SAT'],
    ['mint', 'https://mint.cubabitcoin.org'],
  ],
}));

describe('parseAuctionEvent', () => {
  it('parses a kind-30408 auction into the flat view-model', () => {
    const a = parseAuctionEvent(auctionEvent);
    expect(a).not.toBeNull();
    expect(a.id).toBe(AUC_ID);
    expect(a.aTag).toBe(A_TAG);
    expect(a.title).toBe('Building from Strength to Strength');
    expect(a.auctionType).toBe('english');
    expect(a.currency).toBe('SAT');
    expect(a.startingBid).toBe(21);
    expect(a.bidIncrement).toBe(10);
    expect(a.startAt).toBe(1787326152);
    expect(a.endAt).toBe(1787329752);
    expect(a.poster).toBe('https://cdn.nostrcheck.me/a.jpeg');
    expect(a.images).toEqual(['https://cdn.nostrcheck.me/a.jpeg']); // mp4 excluded
    expect(a.specs).toEqual({ Height: '50 cm', Width: '30 cm' });
    expect(a.categories).toEqual(['Art', 'Bitcoin']);
  });

  it('rejects non-30408 events and events missing d/pubkey', () => {
    expect(parseAuctionEvent({ kind: 30402 })).toBeNull();
    expect(parseAuctionEvent({ kind: 30408, pubkey: SELLER })).toBeNull();
    expect(parseAuctionEvent({ kind: 30408, tags: [['d', 'x']] })).toBeNull();
  });
});

describe('buildBidHistory', () => {
  it('sorts bids by time and tracks the running high bid', () => {
    const h = buildBidHistory(bidEvents);
    expect(h.bidCount).toBe(19);
    // high bid should be the 169000 (index 16), NOT the later lower bids
    expect(h.highBidAmount).toBe(169000);
    expect(h.bids[16].amount).toBe(169000);
    expect(h.bids[16].isHighBid).toBe(true);
  });

  it('flags the non-monotonic bids that broke the English-auction rule (the bug)', () => {
    const h = buildBidHistory(bidEvents);
    // bids 17 and 18 (150010, 150661) are below the prior high 169000
    expect(h.invalidBids.map((b) => b.amount)).toEqual([150010, 150661]);
    expect(h.bids[17].isMonotonic).toBe(false);
    expect(h.bids[18].isMonotonic).toBe(false);
  });

  it('parses bid events and rejects non-1023 / missing-e events', () => {
    expect(parseBidEvent({ kind: 1 })).toBeNull();
    expect(parseBidEvent({ kind: 1023, pubkey: 'x', created_at: 1, tags: [['a', A_TAG]] })).toBeNull();
    const b = parseBidEvent(bidEvents[0]);
    expect(b.auctionId).toBe(AUC_ID);
    expect(b.amount).toBe(2100);
    expect(b.mint).toBe('https://mint.cubabitcoin.org');
  });
});

describe('auctionStatus', () => {
  it('returns live during the auction window', () => {
    expect(auctionStatus(parseAuctionEvent(auctionEvent), 1787326152 + 600).phase).toBe('live');
  });
  it('returns ended after endAt', () => {
    const s = auctionStatus(parseAuctionEvent(auctionEvent), 1787329752 + 1);
    expect(s.phase).toBe('ended');
    expect(s.secondsSinceEnd).toBeGreaterThan(0);
  });
  it('returns upcoming before startAt', () => {
    expect(auctionStatus(parseAuctionEvent(auctionEvent), 1787326152 - 1).phase).toBe('upcoming');
  });
});

describe('buildAuctionViewModel', () => {
  it('assembles the full panel view-model including next-min-bid', () => {
    const vm = buildAuctionViewModel(auctionEvent, bidEvents, 1787326152 + 600);
    expect(vm.auction.title).toBe('Building from Strength to Strength');
    expect(vm.highBid).toBe(169000);
    expect(vm.bidCount).toBe(19);
    expect(vm.nextMinBid).toBe(169000 + 10);
    expect(vm.status.phase).toBe('live');
    expect(vm.invalidBids.length).toBe(2);
  });
});
