// tests/plebeian/auction-panel.test.js
// ADR-0026 — tests the pure panel helpers + the render() against a tiny fake DOM
// (no jsdom). Mirrors how emagakePanel keeps its pure rules unit-testable.

import { describe, it, expect } from 'vitest';
import {
  fmtClock, fmtDate, shortBidder, renderChips, renderBidRow, renderAuctionPanel,
} from '../../src/engine/plebeian/auctionPanel.js';

const AUC_ID = '55d80b60877693e4e5e8a20c358b6a03657fc74912bab90abf1fc7221266f6cb';
const SELLER = 'ec79b568bdea63ca6091f5b84b0c639c10a0919e175fa09a4de3154f82906f25';
const A_D = 'auction_1787326152656_1kb5y';

const auctionEvent = {
  id: AUC_ID, kind: 30408, pubkey: SELLER, created_at: 1787326152, content: '',
  tags: [
    ['d', A_D], ['title', 'Building from Strength to Strength'], ['summary', 'A snapshot in time'],
    ['auction_type', 'english'], ['start_at', '1787326152'], ['end_at', '1787329752'],
    ['currency', 'SAT'], ['starting_bid', '21'], ['bid_increment', '10'],
    ['image', 'https://cdn.nostrcheck.me/a.jpeg', '800x600', '0'],
  ],
};
// amounts include the non-monotonic tail (test auction): 150010, 150661 < 169000
const bidEvents = [2100, 4200, 169000, 150010, 150661].map((amt, i) => ({
  id: `bid${i}`, kind: 1023, pubkey: `bidder${i}`, created_at: 1787326152 + 60 * (i + 1),
  tags: [['e', AUC_ID], ['a', `30408:${SELLER}:${A_D}`], ['p', SELLER], ['amount', String(amt)], ['currency', 'SAT']],
}));

// Minimal fake document: getElementById returns a stub element with settable
// textContent/innerHTML/style/href + class/hidden handling. Just enough for render().
function fakeDoc() {
  const els = {};
  function mk(id) {
    return {
      id, _text: '', _html: '', _href: '', _hidden: null, _classes: new Set(),
      style: {},
      get textContent() { return this._text; }, set textContent(v) { this._text = v; },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
      get href() { return this._href; }, set href(v) { this._href = v; },
      setAttribute(n, v) { if (n === 'hidden') this._hidden = v; }, removeAttribute(n) { if (n === 'hidden') this._hidden = null; },
      classList: { add: (c) => { els[id]._classes.add(c); }, remove: (c) => { els[id]._classes.delete(c); } },
    };
  }
  return {
    doc: { getElementById(id) { if (!els[id]) els[id] = mk(id); return els[id]; } },
    els,
  };
}

describe('pure helpers', () => {
  it('fmtClock renders UTC HH:MM', () => {
    expect(fmtClock(1787326152)).toMatch(/^\d{2}:\d{2}$/); // 15:29
    expect(fmtClock(0)).toBe('');
    expect(fmtClock(NaN)).toBe('');
  });
  it('fmtDate renders UTC DD Mon YYYY', () => {
    expect(fmtDate(1787326152)).toMatch(/2026/);
    expect(fmtDate(0)).toBe('');
  });
  it('shortBidder takes the first 8 hex chars', () => {
    expect(shortBidder('abcdef0123456789')).toBe('abcdef01');
    expect(shortBidder(undefined)).toBe('');
  });
});

describe('renderChips + renderBidRow', () => {
  it('renders status/timing chips including the phase', () => {
    const { buildAuctionViewModel } = require('../../src/engine/plebeian/auctionModel.js');
    const vm = buildAuctionViewModel(auctionEvent, bidEvents, 1787326152 + 600);
    const html = renderChips(vm);
    expect(html).toContain('LIVE');
    expect(html).toContain('ENGLISH');
    expect(html).toContain('start');
    expect(html).toContain('end');
  });

  it('renders a high bid row with the gold flag', () => {
    const { buildBidHistory } = require('../../src/engine/plebeian/auctionModel.js');
    const h = buildBidHistory(bidEvents);
    const highRow = h.bids.filter((r) => r.isHighBid).pop(); // the running high (169,000)
    const html = renderBidRow(highRow);
    expect(html).toContain('class="bid high"');
    expect(html).toContain('high bid');
    expect(html).toContain('169,000');
  });

  it('renders a below-high bid row flagged "below high" (the test-auction tail)', () => {
    const { buildBidHistory } = require('../../src/engine/plebeian/auctionModel.js');
    const h = buildBidHistory(bidEvents);
    const noteRow = h.bids.find((r) => !r.isMonotonic);
    const html = renderBidRow(noteRow);
    expect(html).toContain('class="bid note"');
    expect(html).toContain('below high');
  });

  it('renders a colored-circle fallback avatar + initial when no profile', () => {
    const { buildBidHistory } = require('../../src/engine/plebeian/auctionModel.js');
    const h = buildBidHistory(bidEvents);
    const row = h.bids.find((r) => r.isTopBid);
    const html = renderBidRow(row);
    expect(html).toContain('avatar fallback');
    expect(html).toContain('background-color:hsl(');
  });

  it('renders the display name + img avatar when a profile is present', () => {
    const { buildBidHistory } = require('../../src/engine/plebeian/auctionModel.js');
    const prof = new Map([['bidder2', { name: 'sandwich', picture: 'https://x/a.png' }]]);
    const h = buildBidHistory(bidEvents, prof);
    const row = h.bids.find((r) => r.bidderPubkey === 'bidder2');
    const html = renderBidRow(row);
    expect(html).toContain('sandwich');
    expect(html).toContain('avatar img');
    expect(html).toContain('https://x/a.png');
  });
});

describe('renderAuctionPanel', () => {
  it('writes the title, high bid, chips, and bid rows into the DOM', () => {
    const { doc, els } = fakeDoc();
    const n = renderAuctionPanel({ auction: auctionEvent, bids: bidEvents }, { doc });
    expect(n).toBe(5);
    expect(els['auction-panel-title']._text).toBe('Building from Strength to Strength');
    expect(els['auction-panel-summary']._text).toBe('A snapshot in time');
    expect(els['auction-panel-high']._html).toContain('169,000');
    expect(els['auction-panel-high']._html).toContain('SAT');
    expect(els['auction-panel-chips']._html).toContain('ENDED');
    expect(els['auction-panel-body']._html).toContain('169,000');
    expect(els['auction-panel-body']._html).toContain('below high');
    expect(els['auction-panel-link']._href).toBe(`https://auctions.plebeian.market/auctions/${AUC_ID}`);
  });

  it('renders bids in descending order (highest bid first)', () => {
    const { doc, els } = fakeDoc();
    renderAuctionPanel({ auction: auctionEvent, bids: bidEvents }, { doc });
    const html = els['auction-panel-body']._html;
    // 169,000 (the peak) must appear before 4,200 in the rendered list
    expect(html.indexOf('169,000')).toBeLessThan(html.indexOf('4,200'));
  });

  it('sets the poster background image and unhides it', () => {
    const { doc, els } = fakeDoc();
    renderAuctionPanel({ auction: auctionEvent, bids: bidEvents }, { doc });
    expect(els['auction-panel-poster']._hidden).toBeNull();
    expect(els['auction-panel-poster'].style.backgroundImage).toContain('a.jpeg');
  });

  it('shows a loading state when no auction has arrived yet', () => {
    const { doc, els } = fakeDoc();
    const n = renderAuctionPanel({ auction: null, bids: [] }, { doc });
    expect(n).toBe(0);
    expect(els['auction-panel-body']._html).toContain('Waiting for relay');
    expect(els['auction-panel-status']._text).toContain('connecting');
  });

  it('no-ops (returns 0) when there is no DOM', () => {
    expect(renderAuctionPanel({ auction: auctionEvent, bids: bidEvents }, { doc: null })).toBe(0);
  });
});
