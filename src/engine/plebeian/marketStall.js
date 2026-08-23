// engine/plebeian/marketStall.js — ADR-0026. Owns the live auction panel: opens a
// Plebeian relay subscription when the player enters the NAP market zone and
// renders each update into #auction-panel. Read-only display; no bidding.
//
// LAZY: nothing runs (no WebSocket, no rendering) until the player first enters
// the market zone. The panel is hidden outside the NAP zone. The subscription
// stays open across re-entry (reconnects are handled inside plebeianRelay) so a
// quick step out + back in doesn't tear down and rebuild the relay connection.

import { subscribeAuction, fetchProfiles } from './plebeianRelay.js';
import { renderAuctionPanel } from './auctionPanel.js';
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

function render() {
  if (!_active) return;
  renderAuctionPanel({ ..._last, profiles: _profiles });
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
      if (!_active) return;
      const el = document.getElementById('auction-panel-status');
      if (el) el.textContent = st === 'open' ? 'connected · live' : st === 'error' ? 'relay error' : st;
    },
  });
}

function stop() {
  if (_sub) { _sub.close(); _sub = null; }
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
    start();
    render();
  } else {
    root.setAttribute('hidden', '');
    root.classList.remove('floating');
  }
}

/** Test/debug hook: force-close the subscription + reset state. */
export function _resetMarketStall() {
  stop();
  _active = false;
  _last = { auction: null, bids: [] };
  _profiles = new Map();
  if (_profTimer) { clearTimeout(_profTimer); _profTimer = null; }
  _profFetching = false;
}
