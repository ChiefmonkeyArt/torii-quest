// tests/plebeian/board-panel.test.js
// ADR-0035 — tests the pure card builders + renderBoard() against a tiny fake
// DOM (no jsdom). Mirrors auction-panel.test.js's fakeDoc pattern.

import { describe, it, expect } from 'vitest';
import { renderProductCard, renderAuctionCard, renderBoard, parseAuctionEvents } from '../../src/engine/plebeian/boardPanel.js';
import { parseProductEvent } from '../../src/engine/plebeian/boardModel.js';

const PRODUCT = {
  id: 'p1', kind: 30402, pubkey: 'owner', created_at: 1, content: '',
  tags: [['d', 'noodles'], ['title', 'noodles'], ['price', '15', 'GBP'], ['visibility', 'on-sale'], ['stock', '21'], ['image', 'https://x/pic.jpg']],
};

const AUCTION = {
  id: 'a1', kind: 30408, pubkey: 'owner', created_at: 1, content: '',
  tags: [['d', 'auc1'], ['title', 'my auction'], ['auction_type', 'english'], ['schema', 'auction_v1'],
    ['currency', 'SAT'], ['starting_bid', '21'], ['start_at', '0'], ['end_at', '2000']],
};

// Minimal fake document, same shape as auction-panel.test.js's fakeDoc.
function fakeDoc() {
  const els = {};
  function mk(id) {
    return {
      id, _text: '', _html: '', _hidden: null, _classes: new Set(),
      get textContent() { return this._text; }, set textContent(v) { this._text = v; },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
      setAttribute(n, v) { if (n === 'hidden') this._hidden = v; }, removeAttribute(n) { if (n === 'hidden') this._hidden = null; },
      classList: { add: (c) => { els[id]._classes.add(c); }, remove: (c) => { els[id]._classes.delete(c); } },
    };
  }
  return { doc: { getElementById(id) { if (!els[id]) els[id] = mk(id); return els[id]; } }, els };
}

describe('renderProductCard + renderAuctionCard', () => {
  it('renders a product card with poster, title, price, stock', () => {
    const p = parseProductEvent(PRODUCT);
    const html = renderProductCard(p);
    expect(html).toContain('noodles');
    expect(html).toContain('15');
    expect(html).toContain('GBP');
    expect(html).toContain('21 in stock');
    expect(html).toContain("url('https://x/pic.jpg')");
  });

  it('renders a placeholder thumb when a product has no poster', () => {
    const noImg = { ...PRODUCT, tags: PRODUCT.tags.filter((t) => t[0] !== 'image') };
    const html = renderProductCard(parseProductEvent(noImg));
    expect(html).toContain('board-thumb-empty');
  });

  it('renders a live auction card with an "ends" chip', () => {
    const [a] = parseAuctionEvents([AUCTION]);
    const html = renderAuctionCard(a, true);
    expect(html).toContain('my auction');
    expect(html).toContain('ends');
    expect(html).toContain('board-chip-live');
  });

  it('renders a past auction card with an "ended" chip, no live class', () => {
    const [a] = parseAuctionEvents([AUCTION]);
    const html = renderAuctionCard(a, false);
    expect(html).toContain('ended');
    expect(html).not.toContain('board-chip-live');
  });
});

describe('renderBoard', () => {
  it('renders product cards into the body and sets the count', () => {
    const { doc, els } = fakeDoc();
    const p = parseProductEvent(PRODUCT);
    const n = renderBoard('product-board', [p], 'product', { doc });
    expect(n).toBe(1);
    expect(els['product-board-body']._html).toContain('noodles');
    expect(els['product-board-count']._text).toBe('1 ITEM');
  });

  it('shows empty copy per board kind when the list is empty', () => {
    const { doc, els } = fakeDoc();
    renderBoard('live-auction-board', [], 'auction-live', { doc });
    expect(els['live-auction-board-body']._html).toContain('NO LIVE AUCTIONS');
    expect(els['live-auction-board-count']._text).toBe('0 ITEMS');
  });

  it('renders auction cards for the past board kind', () => {
    const { doc, els } = fakeDoc();
    const [a] = parseAuctionEvents([AUCTION]);
    const n = renderBoard('past-auction-board', [a], 'auction-past', { doc });
    expect(n).toBe(1);
    expect(els['past-auction-board-body']._html).toContain('my auction');
    expect(els['past-auction-board-body']._html).toContain('ended');
  });

  it('returns 0 and does nothing when the root element is missing', () => {
    const doc = { getElementById: () => null };
    expect(renderBoard('nope', [{}], 'product', { doc })).toBe(0);
  });
});

describe('parseAuctionEvents', () => {
  it('parses valid events and drops invalid ones', () => {
    const out = parseAuctionEvents([AUCTION, { kind: 1, tags: [] }, null]);
    expect(out.length).toBe(1);
    expect(out[0].title).toBe('my auction');
  });
});
