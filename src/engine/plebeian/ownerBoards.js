// engine/plebeian/ownerBoards.js — ADR-0035. Owns the three owner-scoped
// boards: subscribes to the owner's products (kind 30402) and auctions
// (kind 30408) via subscribeByAuthor, splits auctions into live/past, and
// renders all three into their DOM panels. Mirrors marketStall.js's lazy
// start/stop + setActive pattern, but scoped to the owner's own npub rather
// than one hardcoded auction id (ADR-0035 §2 — additive, existing
// subscribeAuction/marketStall paths are untouched).

import { subscribeByAuthor, PLEBEIAN_PRODUCT_KIND, PLEBEIAN_AUCTION_KIND } from './plebeianRelay.js';
import { selectOnSaleProducts, splitAuctionsByEnd } from './boardModel.js';
import { renderBoard, parseAuctionEvents } from './boardPanel.js';
import { PLEBEIAN_RELAYS, ADMIN_PUBKEY_HEX } from '../../config.js';

const BOARD_IDS = {
  product: 'product-board',
  liveAuction: 'live-auction-board',
  pastAuction: 'past-auction-board',
};

let _productSub = null;
let _auctionSub = null;
let _active = false;
let _rawProducts = [];
let _rawAuctions = [];

function render() {
  if (!_active) return;
  renderBoard(BOARD_IDS.product, selectOnSaleProducts(_rawProducts), 'product');
  const { live, past } = splitAuctionsByEnd(parseAuctionEvents(_rawAuctions));
  renderBoard(BOARD_IDS.liveAuction, live, 'auction-live');
  renderBoard(BOARD_IDS.pastAuction, past, 'auction-past');
}

function start() {
  if (_productSub || _auctionSub) return;
  const url = PLEBEIAN_RELAYS && PLEBEIAN_RELAYS[0];
  if (!url || !ADMIN_PUBKEY_HEX) return;
  _productSub = subscribeByAuthor({
    url,
    author: ADMIN_PUBKEY_HEX,
    kinds: [PLEBEIAN_PRODUCT_KIND],
    onUpdate: (events) => { _rawProducts = events; render(); },
  });
  _auctionSub = subscribeByAuthor({
    url,
    author: ADMIN_PUBKEY_HEX,
    kinds: [PLEBEIAN_AUCTION_KIND],
    onUpdate: (events) => { _rawAuctions = events; render(); },
  });
}

function stop() {
  if (_productSub) { _productSub.close(); _productSub = null; }
  if (_auctionSub) { _auctionSub.close(); _auctionSub = null; }
}

function showHide(active) {
  for (const boardId of Object.values(BOARD_IDS)) {
    const root = document.getElementById(boardId);
    if (!root) continue;
    if (active) { root.classList.add('floating'); root.removeAttribute('hidden'); }
    else { root.setAttribute('hidden', ''); root.classList.remove('floating'); }
  }
}

/**
 * Show/hide all three owner boards. Called from the same NAP-zone hook as
 * setMarketActive, with the identical `_inNapNow && !kamiActive()` gate — the
 * boards are market UI too, so they follow the same "not while roaming as
 * Kami" rule the owner already asked for. No-op when unchanged.
 */
export function setBoardsActive(active) {
  if (active === _active) return;
  _active = active;
  showHide(active);
  if (active) { start(); render(); }
}

/** Test/debug hook: force-close both subscriptions + reset state. */
export function _resetOwnerBoards() {
  stop();
  _active = false;
  _rawProducts = [];
  _rawAuctions = [];
}
