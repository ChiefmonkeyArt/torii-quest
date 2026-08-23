// engine/plebeian/auctionPanel.js — ADR-0026. DOM renderer for a Plebeian auction.
// Mirrors emagakePanel.js: pure formatting helpers + a render(snapshot, {doc}) that
// writes into #auction-panel-body (DOM that already exists in index.html).
//
// SPLIT ON PURPOSE: the formatting + row/chip string builders are pure and
// unit-testable. Only `renderAuctionPanel` touches the DOM, and only via an
// injectable `doc`. READ-ONLY: the footer link is display-only — no bidding,
// checkout, zap, or publish.

import { buildAuctionViewModel } from './auctionModel.js';

/** UTC HH:MM for a unix-seconds timestamp. '' if invalid. */
export function fmtClock(unix) {
  if (!Number.isFinite(unix) || unix <= 0) return '';
  const d = new Date(unix * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** UTC "DD Mon YYYY" for a unix-seconds timestamp. '' if invalid. */
export function fmtDate(unix) {
  if (!Number.isFinite(unix) || unix <= 0) return '';
  return new Date(unix * 1000).toUTCString().slice(5, 16);
}

/** First 8 hex chars of a bidder pubkey (enough to tell bidders apart on a rack). */
export function shortBidder(pubkey) {
  return (pubkey || '').slice(0, 8);
}

/** Status + timing chips row as HTML. Pure. */
export function renderChips(vm) {
  const ph = vm.status.phase;
  const cls = ph === 'live' ? 'live' : ph === 'ended' ? 'ended' : 'upcoming';
  return [
    `<span class="chip ${cls}">${ph.toUpperCase()}</span>`,
    `<span class="chip">start ${fmtDate(vm.auction.startAt)}</span>`,
    `<span class="chip">end ${fmtDate(vm.auction.endAt)}</span>`,
    `<span class="chip">${vm.auction.auctionType.toUpperCase()}</span>`,
  ].join('');
}

/** One bid row as HTML. `r` is a row from buildBidHistory (has isTopBid, isMonotonic, bidder). Pure.
 *  Layout left-to-right: avatar · time · bidder name · amount · flag. */
export function renderBidRow(r) {
  const bd = r.bidder || {};
  const who = bd.name || shortBidder(r.bidderPubkey);
  // The colored-circle fallback is always rendered; a profile picture img sits on
  // top of it and hides itself on load error, so a broken picture URL falls back
  // gracefully to the initial-letter avatar.
  const fallback = `<span class="avatar fallback" style="background-color:hsl(${bd.hue || 0} 55% 45%)">${bd.initial || '?'}</span>`;
  const avatar = bd.picture
    ? `<span class="avatar-wrap">${fallback}<img class="avatar img" src="${bd.picture}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'"></span>`
    : fallback;
  const flag = r.isTopBid ? 'high bid' : !r.isMonotonic ? 'below high' : '';
  const cls = ['bid', r.isTopBid ? 'high' : '', !r.isMonotonic ? 'note' : ''].filter(Boolean).join(' ');
  const flagHtml = flag ? `<span class="flag">${flag}</span>` : '';
  return `<div class="${cls}">${avatar}<span class="t">${fmtClock(r.time)}</span><span class="who">${who}</span><span class="amt">${r.amount.toLocaleString()}</span>${flagHtml}</div>`;
}

/**
 * Render an auction snapshot into #auction-panel. Idempotent: rebuilds the bid
 * list from scratch each call (correct at this scale — hundreds of bids at most).
 * @param {{auction, bids}} snapshot from plebeianRelay
 * @param {{doc:Document}} [opts] injectable for tests
 * @returns {number} bid rows rendered (0 if no auction yet)
 */
export function renderAuctionPanel(snapshot, opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return 0;
  const root = doc.getElementById('auction-panel');
  if (!root) return 0;
  const body = doc.getElementById('auction-panel-body');
  const statusEl = doc.getElementById('auction-panel-status');
  const vm = buildAuctionViewModel(snapshot.auction, snapshot.bids, undefined, snapshot.profiles);
  if (!vm) {
    if (body) body.innerHTML = '<div class="auction-empty">Waiting for relay…</div>';
    if (statusEl) statusEl.textContent = 'watch-only · connecting';
    return 0;
  }
  const setText = (id, val) => { const el = doc.getElementById(id); if (el) el.textContent = val; };
  const setHTML = (id, val) => { const el = doc.getElementById(id); if (el) el.innerHTML = val; };

  const poster = doc.getElementById('auction-panel-poster');
  if (poster) {
    if (vm.auction.poster) { poster.style.backgroundImage = `url("${vm.auction.poster}")`; poster.removeAttribute('hidden'); }
    else poster.setAttribute('hidden', '');
  }
  setText('auction-panel-title', vm.auction.title);
  setText('auction-panel-summary', vm.auction.summary);
  setHTML('auction-panel-chips', renderChips(vm));
  setHTML('auction-panel-high', `${vm.highBid.toLocaleString()} <span class="cur">${vm.auction.currency}</span>`);
  setText('auction-panel-next', vm.bidCount
    ? `next min ${vm.nextMinBid.toLocaleString()} · ${vm.bidCount} bids`
    : `starting ${vm.auction.startingBid} · 0 bids`);
  const link = doc.getElementById('auction-panel-link');
  if (link) link.href = `https://auctions.plebeian.market/auctions/${vm.auction.id}`;
  if (body) body.innerHTML = [...vm.bids].sort((a, b) => b.amount - a.amount).map(renderBidRow).join('');
  if (statusEl) statusEl.textContent = `watch-only · ${vm.bidCount} bids`;
  return vm.bids.length;
}
