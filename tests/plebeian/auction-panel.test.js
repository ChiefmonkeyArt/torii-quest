// tests/plebeian/auction-panel.test.js
// ADR-0026 + ADR-0059 — tests the pure panel helpers (now data descriptors) + the
// render() against a tiny fake DOM (no jsdom). Mirrors how emagakePanel keeps its
// pure rules unit-testable. ADR-0059: renderAuctionPanel builds DOM nodes with
// createElement + textContent, so the fake DOM supports node construction.

import { describe, it, expect } from 'vitest';
import {
  fmtClock, fmtDate, shortBidder, buildChips, buildBidRow, renderAuctionPanel,
} from '../../src/engine/plebeian/auctionPanel.js';
import { buildAuctionViewModel, buildBidHistory } from '../../src/engine/plebeian/auctionModel.js';

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

// Minimal fake DOM node. Supports the node-building API renderAuctionPanel uses:
// createElement / createTextNode / appendChild / className / style / setAttribute /
// textContent (recursive over children). Enough for render() without jsdom.
function mkEl() {
  const el = {
    children: [], _text: '', _href: '', _hidden: null, _classes: new Set(),
    style: {}, className: '', attrs: {}, onerror: null,
    appendChild(c) { el.children.push(c); return c; },
    setAttribute(n, v) { if (n === 'hidden') el._hidden = v; else el.attrs[n] = v; },
    removeAttribute(n) { if (n === 'hidden') el._hidden = null; else delete el.attrs[n]; },
    get textContent() { return el.children.length ? el.children.map((c) => c.textContent).join('') : el._text; },
    set textContent(v) { el._text = String(v); el.children = []; },
    get href() { return el._href; }, set href(v) { el._href = v; },
    classList: { add(c) { el._classes.add(c); }, remove(c) { el._classes.delete(c); } },
  };
  return el;
}

function fakeDoc() {
  const els = {};
  return {
    doc: {
      getElementById(id) { if (!els[id]) els[id] = mkEl(); return els[id]; },
      createElement() { return mkEl(); },
      createTextNode(text) { return { textContent: String(text), nodeType: 3 }; },
    },
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

describe('buildChips + buildBidRow (data descriptors, no HTML)', () => {
  it('returns chip descriptors including the phase', () => {
    const vm = buildAuctionViewModel(auctionEvent, bidEvents, 1787326152 + 600);
    const chips = buildChips(vm);
    expect(chips).toHaveLength(4);
    expect(chips[0]).toEqual({ cls: 'chip live', text: 'LIVE' });
    expect(chips.map((c) => c.text)).toEqual(expect.arrayContaining(['ENGLISH']));
    expect(chips.map((c) => c.text).join(' ')).toContain('start');
    expect(chips.map((c) => c.text).join(' ')).toContain('end');
  });

  it('returns a high-bid row descriptor with the gold flag', () => {
    const h = buildBidHistory(bidEvents);
    const highRow = h.bids.filter((r) => r.isHighBid).pop(); // the running high (169,000)
    const row = buildBidRow(highRow);
    expect(row.cls).toBe('bid high');
    expect(row.flag).toBe('high bid');
    expect(row.amount).toBe('169,000');
  });

  it('returns a below-high row descriptor flagged "below high"', () => {
    const h = buildBidHistory(bidEvents);
    const noteRow = h.bids.find((r) => !r.isMonotonic);
    const row = buildBidRow(noteRow);
    expect(row.cls).toBe('bid note');
    expect(row.flag).toBe('below high');
  });

  it('returns a colored-circle fallback avatar (initial + hue) when no profile', () => {
    const h = buildBidHistory(bidEvents);
    const row = buildBidRow(h.bids.find((r) => r.isTopBid));
    expect(row.avatar.picture).toBeNull();
    expect(row.avatar.initial).toBeTruthy(); // derived from the pubkey (e.g. 'B')
    expect(typeof row.avatar.hue).toBe('number');
  });

  it('returns the display name + picture when a profile is present', () => {
    const prof = new Map([['bidder2', { name: 'sandwich', picture: 'https://x/a.png' }]]);
    const h = buildBidHistory(bidEvents, prof);
    const row = buildBidRow(h.bids.find((r) => r.bidderPubkey === 'bidder2'));
    expect(row.who).toBe('sandwich');
    expect(row.avatar.picture).toBe('https://x/a.png');
  });
});

describe('renderAuctionPanel', () => {
  it('writes the title, high bid, chips, and bid rows into the DOM (textContent)', () => {
    const { doc, els } = fakeDoc();
    const n = renderAuctionPanel({ auction: auctionEvent, bids: bidEvents }, { doc });
    expect(n).toBe(5);
    expect(els['auction-panel-title'].textContent).toBe('Building from Strength to Strength');
    expect(els['auction-panel-summary'].textContent).toBe('A snapshot in time');
    expect(els['auction-panel-high'].textContent).toContain('169,000');
    expect(els['auction-panel-high'].textContent).toContain('SAT');
    expect(els['auction-panel-chips'].textContent).toContain('ENDED');
    expect(els['auction-panel-chips'].textContent).toContain('ENGLISH');
    expect(els['auction-panel-body'].textContent).toContain('169,000');
    expect(els['auction-panel-body'].textContent).toContain('below high');
    expect(els['auction-panel-link'].href).toBe(`https://auctions.plebeian.market/auctions/${AUC_ID}`);
  });

  it('renders the high bid as a text node + a .cur span (no innerHTML)', () => {
    const { doc, els } = fakeDoc();
    renderAuctionPanel({ auction: auctionEvent, bids: bidEvents }, { doc });
    const high = els['auction-panel-high'];
    expect(high.children).toHaveLength(2);
    expect(high.children[0].nodeType).toBe(3); // text node
    expect(high.children[0].textContent).toBe('169,000 ');
    expect(high.children[1].className).toBe('cur');
    expect(high.children[1].textContent).toBe('SAT');
  });

  it('renders bids in descending order (highest bid first)', () => {
    const { doc, els } = fakeDoc();
    renderAuctionPanel({ auction: auctionEvent, bids: bidEvents }, { doc });
    const text = els['auction-panel-body'].textContent;
    // 169,000 (the peak) must appear before 4,200 in the rendered list
    expect(text.indexOf('169,000')).toBeLessThan(text.indexOf('4,200'));
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
    expect(els['auction-panel-body'].textContent).toContain('Waiting for relay');
    expect(els['auction-panel-body'].children[0].className).toBe('auction-empty');
    expect(els['auction-panel-status'].textContent).toContain('connecting');
  });

  it('no-ops (returns 0) when there is no DOM', () => {
    expect(renderAuctionPanel({ auction: auctionEvent, bids: bidEvents }, { doc: null })).toBe(0);
  });

  it('renders a malicious auction_type / currency / profile name as inert text (ADR-0059)', () => {
    const evil = {
      ...auctionEvent,
      tags: auctionEvent.tags.map((t) => {
        if (t[0] === 'auction_type') return ['auction_type', '<img src=x onerror=alert(1)>'];
        if (t[0] === 'currency') return ['currency', '<script>alert(1)</script>'];
        return t;
      }),
    };
    const prof = new Map([['bidder0', { name: '<b>owned</b>', picture: 'https://x/a.png' }]]);
    const { doc, els } = fakeDoc();
    renderAuctionPanel({ auction: evil, bids: bidEvents, profiles: prof }, { doc });
    // The chip text holds the literal string (uppercased by .toUpperCase()), not an <img> element.
    const chips = els['auction-panel-chips'];
    expect(chips.children.every((c) => c.children.length === 0)).toBe(true);
    expect(chips.textContent.toUpperCase()).toContain('<IMG SRC=X ONERROR=ALERT(1)>');
    // The currency is textContent inside a .cur span, never markup.
    const cur = els['auction-panel-high'].children[1];
    expect(cur.className).toBe('cur');
    expect(cur.textContent).toBe('<script>alert(1)</script>');
    expect(cur.children.length).toBe(0);
    // The bidder name is inert text, not a <b> element.
    expect(els['auction-panel-body'].textContent).toContain('<b>owned</b>');
    expect(els['auction-panel-body'].children.every((row) => !row.children.some((c) => c.className === 'b'))).toBe(true);
  });
});
