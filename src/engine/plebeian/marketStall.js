// engine/plebeian/marketStall.js — ADR-0026 + ADR-0058. Owns the live auction panel:
// opens a Plebeian relay subscription when the player enters the NAP market zone and
// renders each update. Read-only display; no bidding.
//
// ADR-0058: when the product-stall-panel napplet surface is enabled, the bid-list body
// is rendered by a sandboxed iframe (productNappletHost) and the shell pushes serialized
// auction snapshots to it. The shell still owns the panel header (title / summary /
// chips / high / next / poster / link) via the legacy renderer with skipBody. If the
// napplet mount fails or the surface is disabled, the full legacy renderer is used.
//
// LAZY: nothing runs (no WebSocket, no rendering) until the player first enters the
// market zone. The panel is hidden outside the NAP zone. The subscription stays open
// across re-entry (reconnects are handled inside plebeianRelay).

import { subscribeAuction, fetchProfiles } from './plebeianRelay.js';
import { renderAuctionPanel } from './auctionPanel.js';
import { buildAuctionViewModel } from './auctionModel.js';
import { createProductNappletHost } from '../napplets/productNappletHost.js';
import { serializeBidList } from '../napplets/productNappletSnapshot.js';
import { PLEBEIAN_RELAYS, PLEBEIAN_AUCTION_ID } from '../../config.js';

// Profiles are resolved from both Plebeian relays (staging + prod) so a bidder
// who set a profile on either shows their display name + avatar.
const PROF_RELAYS = [...new Set([...(PLEBEIAN_RELAYS || []), 'wss://relay.plebeian.market'])];

let _sub = null;
let _active = false;
let _last = { auction: null, bids: [] };
let _profiles = new Map();
let _profTimer = null;
let _profFetching = false;
let _host = null; // ADR-0058: product napplet host (null when not mounted / fallback)
let _relayStatus = '';

function _hasNapplet() { return !!(_host && _host.isMounted()); }

function render() {
  if (!_active) return;
  const snap = { ..._last, profiles: _profiles };
  if (_hasNapplet()) {
    // Napplet owns the bid-list body; the shell still updates the header (skipBody).
    renderAuctionPanel(snap, { skipBody: true });
    const vm = buildAuctionViewModel(_last.auction, _last.bids, undefined, _profiles);
    _host.push(serializeBidList(vm), _relayStatus || (vm ? `${vm.bidCount} bids` : 'connecting'));
  } else {
    renderAuctionPanel(snap);
  }
}

/** Best-effort: fetch kind-0 profiles for the current bidders once, then
 *  re-render so names/avatars appear. Profiles are a display nicety — a fetch
 *  failure or missing profile just falls back to the colored-circle avatar. */
function scheduleProfileFetch(bids) {
  if (_profTimer || _profFetching) return;
  const pubs = [...new Set((bids || []).map((b) => b.pubkey).filter(Boolean))];
  if (!pubs.length) return;
  _profTimer = setTimeout(async () => {
    _profTimer = null;
    _profFetching = true;
    try {
      const got = await fetchProfiles(pubs, PROF_RELAYS);
      if (got && got.size) { _profiles = got; render(); }
    } catch { /* best-effort */ }
    _profFetching = false;
  }, 400);
}

function start() {
  if (_sub) return;
  const url = PLEBEIAN_RELAYS && PLEBEIAN_RELAYS[0];
  if (!url) return;
  _sub = subscribeAuction({
    url,
    auctionId: PLEBEIAN_AUCTION_ID,
    onUpdate: (snap) => { _last = snap; render(); scheduleProfileFetch(snap.bids); },
    onStatus: (st) => {
      _relayStatus = st === 'open' ? 'connected · live' : st === 'error' ? 'relay error' : st;
      if (!_active) return;
      if (!_hasNapplet()) {
        const el = document.getElementById('auction-panel-status');
        if (el) el.textContent = _relayStatus;
      }
      // When the napplet is mounted, the status footer is pushed with the next render.
    },
  });
}

function stop() {
  if (_sub) { _sub.close(); _sub = null; }
}

/** Try to mount the product napplet into #auction-panel-body. Returns true if the
 *  napplet is live, false if the legacy renderer should be used instead. */
function _tryMountNapplet() {
  if (_host) { _host.destroy(); _host = null; }
  // createProductNappletHost uses the global window/document (browser-only path).
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  _host = createProductNappletHost({ window, document });
  return _host.mount(); // false → surface disabled / no body / mount threw → fallback
}

/**
 * Show/hide the market stall panel. Called per-frame from the NAP-zone hook in
 * arenaRuntime. No-op when the active state is unchanged.
 */
export function setMarketActive(active) {
  if (active === _active) return;
  _active = active;
  const root = document.getElementById('auction-panel');
  if (!root) return;
  if (active) {
    root.classList.add('floating');
    root.removeAttribute('hidden');
    _tryMountNapplet(); // ADR-0058: best-effort; falls back to legacy on failure
    start();
    render();
  } else {
    if (_host) { _host.destroy(); _host = null; }
    root.setAttribute('hidden', '');
    root.classList.remove('floating');
    stop();
  }
}

/** Test/debug hook: force-close the subscription + reset state. */
export function _resetMarketStall() {
  stop();
  if (_host) { _host.destroy(); _host = null; }
  _active = false;
  _last = { auction: null, bids: [] };
  _profiles = new Map();
  _relayStatus = '';
  if (_profTimer) { clearTimeout(_profTimer); _profTimer = null; }
  _profFetching = false;
}
