// tests/plebeian/reduce-author-events.test.js
// ADR-0035 — tests the pure event reducer that folds Nostr wire frames into an
// author-scoped event list, used by the owner boards' subscribeByAuthor query.
// No WebSocket, no browser.

import { describe, it, expect } from 'vitest';
import { reduceAuthorEvents, PLEBEIAN_PRODUCT_KIND, PLEBEIAN_AUCTION_KIND } from '../../src/engine/plebeian/plebeianRelay.js';

function productEvent(id, dVal, createdAt, title) {
  return { id, kind: PLEBEIAN_PRODUCT_KIND, pubkey: 'owner', created_at: createdAt, tags: [['d', dVal], ['title', title || 'x']] };
}

describe('reduceAuthorEvents', () => {
  it('starts with an empty default state', () => {
    const s = reduceAuthorEvents(undefined, ['NOTHING']);
    expect(s).toEqual({ events: [], eosed: false });
  });

  it('accumulates events with distinct d tags', () => {
    let s = reduceAuthorEvents(undefined, ['EVENT', 'byauthor', productEvent('e1', 'noodles', 1)]);
    s = reduceAuthorEvents(s, ['EVENT', 'byauthor', productEvent('e2', 'ramen', 2)]);
    expect(s.events.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('replaces an existing event with the same kind + d tag (NIP-33 parameterized replaceable)', () => {
    let s = reduceAuthorEvents(undefined, ['EVENT', 'byauthor', productEvent('e1', 'noodles', 1, 'noodles v1')]);
    s = reduceAuthorEvents(s, ['EVENT', 'byauthor', productEvent('e2', 'noodles', 2, 'noodles v2')]);
    expect(s.events.length).toBe(1);
    expect(s.events[0].id).toBe('e2');
  });

  it('ignores an older re-delivery of the same d tag (out-of-order relay resend)', () => {
    let s = reduceAuthorEvents(undefined, ['EVENT', 'byauthor', productEvent('e2', 'noodles', 5, 'newest')]);
    const before = s;
    s = reduceAuthorEvents(s, ['EVENT', 'byauthor', productEvent('e1', 'noodles', 1, 'stale')]);
    expect(s).toBe(before);
    expect(s.events[0].id).toBe('e2');
  });

  it('falls back to id-based dedup for events with no d tag', () => {
    const noD = { id: 'nod1', kind: PLEBEIAN_AUCTION_KIND, pubkey: 'owner', created_at: 1, tags: [] };
    let s = reduceAuthorEvents(undefined, ['EVENT', 'byauthor', noD]);
    s = reduceAuthorEvents(s, ['EVENT', 'byauthor', noD]);
    expect(s.events.length).toBe(1);
  });

  it('ignores events with no id', () => {
    const s = reduceAuthorEvents(undefined, ['EVENT', 'byauthor', { kind: PLEBEIAN_PRODUCT_KIND, tags: [] }]);
    expect(s.events.length).toBe(0);
  });

  it('marks EOSE without dropping accumulated state', () => {
    let s = reduceAuthorEvents(undefined, ['EVENT', 'byauthor', productEvent('e1', 'noodles', 1)]);
    s = reduceAuthorEvents(s, ['EOSE', 'byauthor']);
    expect(s.eosed).toBe(true);
    expect(s.events.length).toBe(1);
  });

  it('returns the same ref when nothing changed (so callers can skip renders)', () => {
    const s = reduceAuthorEvents(undefined, ['EVENT', 'byauthor', productEvent('e1', 'noodles', 1)]);
    const s2 = reduceAuthorEvents(s, ['NOTHING']);
    expect(s2).toBe(s);
  });
});
