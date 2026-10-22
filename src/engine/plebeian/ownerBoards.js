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
import { PLEBEIAN_PRODUCT_RELAYS, PLEBEIAN_AUCTION_RELAYS, ADMIN_PUBKEY_HEX } from '../../config.js';
import { resolveBoardOwner, mergeOwnerEvents } from './boardOwner.js';

const BOARD_IDS = {
  product: 'product-board',
  liveAuction: 'live-auction-board',
  pastAuction: 'past-auction-board',
};

let _subs = [];
let _owner = '';
let _active = false;
let _rawProducts = [];
let _rawAuctions = [];
const _productByRelay = new Map();
const _auctionByRelay = new Map();

function render() {
  if (!_active) return;
  renderBoard(BOARD_IDS.product, selectOnSaleProducts(_rawProducts), 'product');
  const { live, past } = splitAuctionsByEnd(parseAuctionEvents(_rawAuctions));
  renderBoard(BOARD_IDS.liveAuction, live, 'auction-live');
  renderBoard(BOARD_IDS.pastAuction, past, 'auction-past');
}

// ADR-0145 slice 1: the owner is THIS world's owner (host pubkey meta), not the
// server-only ADMIN_PUBKEY_HEX, which is '' in every browser and silently kept
// the boards empty. One subscription per relay; merged, signature-checked and
// owner-only via mergeOwnerEvents.
function start() {
  if (_subs.length) return;
  _owner = resolveBoardOwner({ adminHex: ADMIN_PUBKEY_HEX });
  if (!_owner) return;
  for (const url of PLEBEIAN_PRODUCT_RELAYS) {
    _subs.push(subscribeByAuthor({
      url, author: _owner, kinds: [PLEBEIAN_PRODUCT_KIND],
      onUpdate: (events) => { _productByRelay.set(url, events); _rawProducts = mergeOwnerEvents([..._productByRelay.values()], _owner); render(); },
    }));
  }
  for (const url of PLEBEIAN_AUCTION_RELAYS) {
    _subs.push(subscribeByAuthor({
      url, author: _owner, kinds: [PLEBEIAN_AUCTION_KIND],
      onUpdate: (events) => { _auctionByRelay.set(url, events); _rawAuctions = mergeOwnerEvents([..._auctionByRelay.values()], _owner); render(); },
    }));
  }
}

// Close the sockets when the boards hide (v0.2.915): an unreachable relay no
// longer retries every 3 s for the whole session. Cached events stay, so a
// re-open renders instantly while the subscriptions reconnect.
function stop() {
  for (const s of _subs) { try { s.close(); } catch { /* closed */ } }
  _subs = [];
}

/** Test / debug seam. */
export function _ownerBoardsState() {
  return { owner: _owner, subs: _subs.length, products: _rawProducts.length, auctions: _rawAuctions.length, active: _active };
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
  const wasActive = _active;
  _active = active;
  // Always force-show/hide all three boards — even when already active, a
  // board may have been individually hidden via hideOwnerBoard() (an ADR-0036
  // close button) and a fresh trigger press must re-show it. Without this,
  // setBoardsActive(true) short-circuited when _active was already true, so the
  // boards stayed hidden after a close→reopen cycle (the auction panel reopened
  // via setMarketActive(true), the boards did not).
  showHide(active);
  // (Re)start the relay subscriptions + render only on the false→true edge to
  // avoid redundant WebSocket churn on repeated trigger presses.
  if (active && !wasActive) { start(); render(); }
  if (!active && wasActive) stop();
}

/**
 * ADR-0036: hide ONE board by its DOM id, independent of the other two —
 * used by that board's own close button. Does NOT touch `_active`/the
 * shared subscriptions, so the sibling boards keep receiving live data;
 * re-opening via setBoardsActive(true) or the trigger re-shows all three
 * (showHide re-adds 'floating' to every board, including this one).
 */
export function hideOwnerBoard(boardId) {
  const root = document.getElementById(boardId);
  if (!root) return;
  root.setAttribute('hidden', '');
  root.classList.remove('floating');
}

/** Test/debug hook: force-close both subscriptions + reset state. */
export function _resetOwnerBoards() {
  stop();
  _active = false;
  _rawProducts = [];
  _rawAuctions = [];
}
