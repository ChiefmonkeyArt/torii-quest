// engine/plebeian/boardPanel.js — ADR-0035. DOM renderer for the three owner
// boards (Live Products, Live Auctions, Past Auctions). Mirrors auctionPanel.js:
// pure string builders + one injectable-doc render function, called three times
// with a different board id/list. READ-ONLY: no buy/bid/checkout — each card's
// footer link is display-only, same convention as #auction-panel-link.

import { parseAuctionEvent } from './auctionModel.js';

/** UTC "DD Mon" for a unix-seconds timestamp. '' if invalid. */
export function fmtShortDate(unix) {
  if (!Number.isFinite(unix) || unix <= 0) return '';
  return new Date(unix * 1000).toUTCString().slice(5, 11);
}

/** One product card as HTML. `p` is a parseProductEvent() record. Pure. */
export function renderProductCard(p) {
  const img = p.poster
    ? `<div class="board-thumb" style="background-image:url('${p.poster}')"></div>`
    : `<div class="board-thumb board-thumb-empty"></div>`;
  const stock = Number.isFinite(p.stock) ? `<span class="board-chip">${p.stock} in stock</span>` : '';
  return `<div class="board-card">${img}<div class="board-card-body">` +
    `<div class="board-card-title">${p.title}</div>` +
    `<div class="board-card-row"><span class="board-price">${p.price.toLocaleString()} <span class="cur">${p.currency}</span></span>${stock}</div>` +
    `</div></div>`;
}

/** One auction card as HTML. `a` is a parseAuctionEvent() record. `live` picks
 *  the countdown label vs an "ended" label. Pure. */
export function renderAuctionCard(a, live) {
  const img = a.poster
    ? `<div class="board-thumb" style="background-image:url('${a.poster}')"></div>`
    : `<div class="board-thumb board-thumb-empty"></div>`;
  const end = a.maxEndAt || a.endAt;
  const timeLabel = live
    ? `<span class="board-chip board-chip-live">ends ${fmtShortDate(end)}</span>`
    : `<span class="board-chip">ended ${fmtShortDate(end)}</span>`;
  return `<div class="board-card" data-auction-id="${a.id}">${img}<div class="board-card-body">` +
    `<div class="board-card-title">${a.title}</div>` +
    `<div class="board-card-row"><span class="board-price">${a.startingBid.toLocaleString()} <span class="cur">${a.currency}</span></span>${timeLabel}</div>` +
    `</div></div>`;
}

/**
 * Render one board's card list into `#<boardId>-body`. Idempotent: rebuilds
 * from scratch each call, same convention as renderAuctionPanel.
 * @param {string} boardId one of 'product-board' | 'live-auction-board' | 'past-auction-board'
 * @param {Array} items already-filtered/sorted records (product or auction view-models)
 * @param {'product'|'auction-live'|'auction-past'} kind which card renderer + empty copy to use
 * @param {{doc:Document}} [opts] injectable for tests
 * @returns {number} cards rendered
 */
export function renderBoard(boardId, items, kind, opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return 0;
  const root = doc.getElementById(boardId);
  if (!root) return 0;
  const body = doc.getElementById(`${boardId}-body`);
  const countEl = doc.getElementById(`${boardId}-count`);
  const list = items || [];
  if (countEl) countEl.textContent = `${list.length} ${list.length === 1 ? 'ITEM' : 'ITEMS'}`;
  if (!body) return 0;
  if (!list.length) {
    const emptyCopy = kind === 'product' ? 'NO PRODUCTS ON SALE'
      : kind === 'auction-live' ? 'NO LIVE AUCTIONS'
      : 'NO PAST AUCTIONS';
    body.innerHTML = `<div class="board-empty">${emptyCopy}</div>`;
    return 0;
  }
  const renderer = kind === 'product' ? renderProductCard : (a) => renderAuctionCard(a, kind === 'auction-live');
  body.innerHTML = list.map(renderer).join('');
  return list.length;
}

/** Re-parse raw kind-30408 events into auction view-models, dropping invalid
 *  ones. Thin wrapper so callers pass raw relay events straight through. */
export function parseAuctionEvents(events) {
  return (events || []).map(parseAuctionEvent).filter(Boolean);
}
