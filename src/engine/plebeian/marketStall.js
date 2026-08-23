// engine/plebeian/marketStall.js — ADR-0026. Owns the live auction panel: opens a
// Plebeian relay subscription when the player enters the NAP market zone and
// renders each update into #auction-panel. Read-only display; no bidding.
//
// LAZY: nothing runs (no WebSocket, no rendering) until the player first enters
// the market zone. The panel is hidden outside the NAP zone. The subscription
// stays open across re-entry (reconnects are handled inside plebeianRelay) so a
// quick step out + back in doesn't tear down and rebuild the relay connection.

import { subscribeAuction } from './plebeianRelay.js';
import { renderAuctionPanel } from './auctionPanel.js';
import { PLEBEIAN_RELAYS, PLEBEIAN_AUCTION_ID } from '../../config.js';

let _sub = null;
let _active = false;
let _last = { auction: null, bids: [] };

function start() {
  if (_sub) return;
  const url = PLEBEIAN_RELAYS && PLEBEIAN_RELAYS[0];
  if (!url) return;
  _sub = subscribeAuction({
    url,
    auctionId: PLEBEIAN_AUCTION_ID,
    onUpdate: (snap) => { _last = snap; if (_active) renderAuctionPanel(snap); },
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
    renderAuctionPanel(_last);
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
}
