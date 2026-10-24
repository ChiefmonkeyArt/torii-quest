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
import { resolveBoardOwner, ownerStore, resolveStoreConfig, storeFilters, mergeStoreEvents, storeKey, STORE_KIND, STORE_D } from './boardOwner.js';

const BOARD_IDS = {
  product: 'product-board',
  liveAuction: 'live-auction-board',
  pastAuction: 'past-auction-board',
};

let _subs = [];
let _configSubs = [];
let _owner = '';
let _store = null;
// v0.2.931 (ADR-0147 M1): a VISITED Starter Pack island shows ITS owner's store.
// undefined = no override (this node's owner); '' = blocked (no store); hex = that owner.
let _ownerOverride;
const _configByRelay = new Map();
let _active = false;
// v0.2.919: the in-world market boards want the same data while the player is
// in the NAP Zone, with or without the HUD panels open.
let _worldWanted = false;
const _dataListeners = new Set();
let _rawProducts = [];
let _rawAuctions = [];
const _productByRelay = new Map();
const _auctionByRelay = new Map();

function render() {
  if (_dataListeners.size) {
    const data = { products: _rawProducts, auctions: _rawAuctions, store: _store };
    for (const fn of _dataListeners) { try { fn(data); } catch { /* listener errors stay local */ } }
  }
  if (!_active) return;
  renderBoard(BOARD_IDS.product, selectOnSaleProducts(_rawProducts), 'product');
  const { live, past } = splitAuctionsByEnd(parseAuctionEvents(_rawAuctions));
  renderBoard(BOARD_IDS.liveAuction, live, 'auction-live');
  renderBoard(BOARD_IDS.pastAuction, past, 'auction-past');
}

// ADR-0145: the owner is THIS world's owner (host pubkey meta), not the
// server-only ADMIN_PUBKEY_HEX ('' in every browser). The store shows the
// owner's shop by default, or what the owner's signed store set picks: another
// seller, or a custom list of products/auctions (boardOwner.js). Listings start
// immediately with the owner default and switch when a store set arrives.
function openListings(reset) {
  closeAll(_subs); _subs = [];
  if (reset) { _productByRelay.clear(); _auctionByRelay.clear(); _rawProducts = []; _rawAuctions = []; }
  const plan = [
    [PLEBEIAN_PRODUCT_RELAYS, PLEBEIAN_PRODUCT_KIND, _productByRelay, (v) => { _rawProducts = v; }],
    [PLEBEIAN_AUCTION_RELAYS, PLEBEIAN_AUCTION_KIND, _auctionByRelay, (v) => { _rawAuctions = v; }],
  ];
  for (const [relays, kind, byRelay, set] of plan) {
    const filters = storeFilters(_store, kind);
    if (!filters.length) continue;
    const store = _store;
    for (const url of relays) {
      _subs.push(subscribeByAuthor({
        url, filters,
        onUpdate: (events) => { if (store !== _store) return; byRelay.set(url, events); set(mergeStoreEvents([...byRelay.values()], _store)); render(); },
      }));
    }
  }
  render();
}

function start() {
  if (_subs.length || _configSubs.length) return;
  _owner = _ownerOverride !== undefined ? _ownerOverride : resolveBoardOwner({ adminHex: ADMIN_PUBKEY_HEX });
  if (!_owner) return;
  if (!_store) _store = ownerStore(_owner);
  openListings(false);
  for (const url of PLEBEIAN_PRODUCT_RELAYS) {
    _configSubs.push(subscribeByAuthor({
      url, filters: [{ authors: [_owner], kinds: [STORE_KIND], '#d': [STORE_D], limit: 4 }],
      onUpdate: (events) => {
        _configByRelay.set(url, events);
        const next = resolveStoreConfig([..._configByRelay.values()].flat(), _owner);
        if (storeKey(next) !== storeKey(_store)) { _store = next; openListings(true); }
      },
    }));
  }
}

function closeAll(list) { for (const s of list) { try { s.close(); } catch { /* closed */ } } }

// Close the sockets when the boards hide (v0.2.915): an unreachable relay no
// longer retries every 3 s for the whole session. The last store config and
// listings stay cached, so a re-open renders instantly while they reconnect.
function stop() {
  closeAll(_subs); closeAll(_configSubs);
  _subs = []; _configSubs = [];
}

/**
 * v0.2.931: point the boards at another world's owner (a visited Starter Pack
 * island), or back home with null. Any non-null value that is not a 64-char
 * lowercase hex pubkey BLOCKS the store, so a visitor never sees the wrong shop.
 * A change drops the old store + listings and reopens the feeds if wanted.
 */
export function setBoardOwnerOverride(hex) {
  const next = hex == null ? undefined : (typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex) ? hex : '');
  if (next === _ownerOverride) return;
  _ownerOverride = next;
  stop();
  _store = null; _owner = '';
  _rawProducts = []; _rawAuctions = [];
  _productByRelay.clear(); _auctionByRelay.clear(); _configByRelay.clear();
  if (_worldWanted || _active) { start(); render(); }
}

/** Test / debug seam. */
export function _ownerBoardsState() {
  return { owner: _owner, override: _ownerOverride === undefined ? null : _ownerOverride, store: _store ? { ..._store, items: _store.items.slice() } : null, subs: _subs.length + _configSubs.length, products: _rawProducts.length, auctions: _rawAuctions.length, active: _active, worldWanted: _worldWanted };
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
  if (!active && wasActive && !_worldWanted) stop();
}

/** v0.2.919: the in-world boards want data (player in the NAP Zone). */
export function setBoardsWorldWanted(want) {
  const w = !!want;
  if (w === _worldWanted) return;
  _worldWanted = w;
  if (w) { start(); render(); }
  else if (!_active) stop();
}

/** v0.2.919: observe merged, verified owner-store data. Called now + on change. → unsubscribe */
export function onOwnerBoardsData(fn) {
  if (typeof fn !== 'function') return () => {};
  _dataListeners.add(fn);
  try { fn({ products: _rawProducts, auctions: _rawAuctions, store: _store }); } catch { /* listener errors stay local */ }
  return () => _dataListeners.delete(fn);
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
  _store = null; _owner = ''; _ownerOverride = undefined;
  _worldWanted = false; _dataListeners.clear();
  _productByRelay.clear(); _auctionByRelay.clear(); _configByRelay.clear();
}
