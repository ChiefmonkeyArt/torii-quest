// tests/plebeian/plebeian-relay.test.js
// ADR-0026 — tests the pure event reducer that folds Nostr wire frames into the
// {auction, bids} snapshot the panel renders from. No WebSocket, no browser.

import { describe, it, expect } from 'vitest';
import { reduceEvents, PLEBEIAN_AUCTION_KIND, PLEBEIAN_BID_KIND } from '../../src/engine/plebeian/plebeianRelay.js';

const AUC_ID = '55d80b60877693e4e5e8a20c358b6a03657fc74912bab90abf1fc7221266f6cb';
const AUC_EVENT = { id: AUC_ID, kind: PLEBEIAN_AUCTION_KIND, pubkey: 'p', created_at: 1, tags: [['d', 'a1']], content: '' };
function bidEvent(i, amt) {
  return { id: `bid${i}`, kind: PLEBEIAN_BID_KIND, pubkey: `bidder${i}`, created_at: 100 + i, tags: [['e', AUC_ID], ['amount', String(amt)]] };
}

describe('reduceEvents', () => {
  it('starts with an empty default state', () => {
    const s = reduceEvents(undefined, ['NOTHING']);
    expect(s).toEqual({ auction: null, bids: [], eosed: false });
  });

  it('captures the auction event on the auc sub', () => {
    const s = reduceEvents(undefined, ['EVENT', 'auc', AUC_EVENT]);
    expect(s.auction).toBe(AUC_EVENT);
    expect(s.bids).toEqual([]);
  });

  it('accumulates bid events on the bids sub in arrival order', () => {
    let s = reduceEvents(undefined, ['EVENT', 'bids', bidEvent(1, 2100)]);
    s = reduceEvents(s, ['EVENT', 'bids', bidEvent(2, 4200)]);
    expect(s.bids.map((b) => b.id)).toEqual(['bid1', 'bid2']);
  });

  it('dedups bids by id (relays resend on reconnect)', () => {
    let s = reduceEvents(undefined, ['EVENT', 'bids', bidEvent(1, 2100)]);
    s = reduceEvents(s, ['EVENT', 'bids', bidEvent(1, 2100)]); // same id
    expect(s.bids.length).toBe(1);
  });

  it('ignores bid events with the wrong kind or missing id', () => {
    let s = reduceEvents(undefined, ['EVENT', 'bids', { id: 'x', kind: 1, tags: [] }]);
    expect(s.bids.length).toBe(0);
    s = reduceEvents(s, ['EVENT', 'bids', { kind: PLEBEIAN_BID_KIND, tags: [] }]); // no id → dedup guard
    expect(s.bids.length).toBe(0);
  });

  it('ignores events on unknown subIds', () => {
    const s = reduceEvents(undefined, ['EVENT', 'noise', AUC_EVENT]);
    expect(s.auction).toBeNull();
  });

  it('marks EOSE without dropping accumulated state', () => {
    let s = reduceEvents(undefined, ['EVENT', 'auc', AUC_EVENT]);
    s = reduceEvents(s, ['EVENT', 'bids', bidEvent(1, 2100)]);
    s = reduceEvents(s, ['EOSE', 'auc']);
    expect(s.eosed).toBe(true);
    expect(s.auction).toBe(AUC_EVENT);
    expect(s.bids.length).toBe(1);
  });

  it('returns the same ref when nothing changed (so callers can skip renders)', () => {
    const s = reduceEvents(undefined, ['EVENT', 'auc', AUC_EVENT]);
    const s2 = reduceEvents(s, ['NOTHING']);
    expect(s2).toBe(s);
  });
});
