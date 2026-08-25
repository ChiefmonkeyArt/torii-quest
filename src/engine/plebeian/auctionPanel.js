// engine/plebeian/auctionPanel.js — ADR-0026 + ADR-0059. DOM renderer for a Plebeian auction.
// Mirrors emagakePanel.js: pure formatting helpers + a render(snapshot, {doc}) that
// writes into #auction-panel-body (DOM that already exists in index.html).
//
// ADR-0059: NO innerHTML of untrusted data. The pure helpers return plain data
// descriptors (not HTML strings), and renderAuctionPanel builds DOM nodes with
// createElement + textContent. Relay data (auction_type, currency, title, summary,
// profile name/picture) is untrusted and must never be interpolated into markup.
//
// READ-ONLY: the footer link is display-only — no bidding, checkout, zap, or publish.

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

/** Status + timing chips as plain data (ADR-0059: no HTML). Pure. */
export function buildChips(vm) {
  const ph = vm.status.phase;
  const cls = ph === 'live' ? 'live' : ph === 'ended' ? 'ended' : 'upcoming';
  return [
    { cls: `chip ${cls}`, text: ph.toUpperCase() },
    { cls: 'chip', text: `start ${fmtDate(vm.auction.startAt)}` },
    { cls: 'chip', text: `end ${fmtDate(vm.auction.endAt)}` },
    { cls: 'chip', text: vm.auction.auctionType.toUpperCase() },
  ];
}

/** One bid row as a plain descriptor (ADR-0059: no HTML). `r` is a row from
 *  buildBidHistory (has isTopBid, isMonotonic, bidder). Pure. */
export function buildBidRow(r) {
  const bd = r.bidder || {};
  const who = bd.name || shortBidder(r.bidderPubkey);
  const flag = r.isTopBid ? 'high bid' : !r.isMonotonic ? 'below high' : '';
  const cls = ['bid', r.isTopBid ? 'high' : '', !r.isMonotonic ? 'note' : ''].filter(Boolean).join(' ');
  return {
    cls,
    time: fmtClock(r.time),
    who,
    amount: r.amount.toLocaleString(),
    flag,
    avatar: {
      hue: bd.hue || 0,
      initial: bd.initial || '?',
      picture: bd.picture || null,
    },
  };
}

// --- DOM node builders (internal; ADR-0059) -------------------------------------------

/** createElement + optional className + textContent. text is ALWAYS assigned via
 *  textContent, never innerHTML. */
function el(doc, tag, className, text) {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Build a chip <span> from a {cls, text} descriptor. */
function chipNode(doc, c) {
  return el(doc, 'span', c.cls, c.text);
}

/** Build the avatar block (colored-circle fallback + optional profile <img>). */
function avatarNode(doc, a) {
  const fallback = el(doc, 'span', 'avatar fallback', a.initial);
  fallback.style.backgroundColor = `hsl(${a.hue} 55% 45%)`;
  if (!a.picture) return fallback;
  const wrap = el(doc, 'span', 'avatar-wrap');
  wrap.appendChild(fallback);
  const img = doc.createElement('img');
  img.className = 'avatar img';
  img.setAttribute('src', a.picture);
  img.setAttribute('alt', '');
  img.setAttribute('loading', 'lazy');
  img.setAttribute('referrerpolicy', 'no-referrer');
  img.onerror = () => { img.style.display = 'none'; };
  wrap.appendChild(img);
  return wrap;
}

/** Build a bid-row <div> from a buildBidRow descriptor. */
function bidRowNode(doc, d) {
  const row = el(doc, 'div', d.cls);
  row.appendChild(avatarNode(doc, d.avatar));
  row.appendChild(el(doc, 'span', 't', d.time));
  row.appendChild(el(doc, 'span', 'who', d.who));
  row.appendChild(el(doc, 'span', 'amt', d.amount));
  if (d.flag) row.appendChild(el(doc, 'span', 'flag', d.flag));
  return row;
}

/** Replace an element's children with a single text node. */
function setText(doc, id, val) {
  const e = doc.getElementById(id);
  if (e) e.textContent = val;
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
    if (body) {
      body.textContent = '';
      body.appendChild(el(doc, 'div', 'auction-empty', 'Waiting for relay…'));
    }
    if (statusEl) statusEl.textContent = 'watch-only · connecting';
    return 0;
  }

  const poster = doc.getElementById('auction-panel-poster');
  if (poster) {
    if (vm.auction.poster) { poster.style.backgroundImage = `url("${vm.auction.poster}")`; poster.removeAttribute('hidden'); }
    else poster.setAttribute('hidden', '');
  }
  setText(doc, 'auction-panel-title', vm.auction.title);
  setText(doc, 'auction-panel-summary', vm.auction.summary);

  // Chips: build <span> nodes from plain data (no innerHTML).
  const chipsEl = doc.getElementById('auction-panel-chips');
  if (chipsEl) {
    chipsEl.textContent = '';
    for (const c of buildChips(vm)) chipsEl.appendChild(chipNode(doc, c));
  }

  // High bid: text node + a <span class="cur"> for the currency.
  const highEl = doc.getElementById('auction-panel-high');
  if (highEl) {
    highEl.textContent = '';
    highEl.appendChild(doc.createTextNode(`${vm.highBid.toLocaleString()} `));
    highEl.appendChild(el(doc, 'span', 'cur', vm.auction.currency));
  }

  setText(doc, 'auction-panel-next', vm.bidCount
    ? `next min ${vm.nextMinBid.toLocaleString()} · ${vm.bidCount} bids`
    : `starting ${vm.auction.startingBid} · 0 bids`);
  const link = doc.getElementById('auction-panel-link');
  if (link) link.href = `https://auctions.plebeian.market/auctions/${vm.auction.id}`;
  // ADR-0058: when a napplet owns the bid-list body, skip writing it here so the
  // iframe is not destroyed. The header/stats above are still updated by this path.
  if (body && !opts.skipBody) {
    body.textContent = '';
    const rows = [...vm.bids].sort((a, b) => b.amount - a.amount);
    for (const r of rows) body.appendChild(bidRowNode(doc, buildBidRow(r)));
  }
  if (statusEl) statusEl.textContent = `watch-only · ${vm.bidCount} bids`;
  return vm.bids.length;
}
