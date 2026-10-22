// engine/plebeian/marketBoardModel.js — ADR-0145 (v0.2.919): what the two
// in-world NAP market boards show. PURE: no THREE/DOM/sockets.
//
//   PRODUCT board → one slide per on-sale product: photo, title, price, stock,
//                   seller name + avatar.
//   AUCTION board → one slide per auction: photo, title, high bid, bid count,
//                   bidders, countdown (live / starts in / ended), seller.
//
// Bids are signature-checked here (a relay can't inflate a total with forged
// bids) and must reference the auction they are counted for.
import { selectOnSaleProducts } from './boardModel.js';
import { parseAuctionEvent, buildBidHistory, auctionStatus } from './auctionModel.js';
import { verifyNostrEventSig } from '../crypto/nostrSig.js';

export const SLIDE_SECONDS = 8;
export const MAX_SLIDES = 12;

const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

/** https-only image URL (length-capped), else null. */
export function safeImageUrl(u) {
  if (typeof u !== 'string' || u.length > 2048) return null;
  try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; }
}

/** "169,000 sats" / "15 GBP" / "0.5 USD". */
export function formatAmount(n, currency) {
  const c = String(currency || 'SAT').toUpperCase();
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const sats = c === 'SAT' || c === 'SATS';
  const txt = v.toLocaleString('en-GB', { maximumFractionDigits: sats ? 0 : 2 });
  return sats ? `${txt} sats` : `${txt} ${c}`;
}

const pad = (n) => String(n).padStart(2, '0');
function span(sec) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d > 0) return `${d}d ${pad(h)}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(r)}s`;
}

/** Countdown chip: { text, tone: 'live'|'soon'|'upcoming'|'ended' }. */
export function formatCountdown(status, endAtSec) {
  if (!status) return { text: '', tone: 'ended' };
  if (status.phase === 'live') return { text: 'Ends in ' + span(status.secondsRemaining), tone: status.secondsRemaining <= 600 ? 'soon' : 'live' };
  if (status.phase === 'upcoming') return { text: 'Starts in ' + span(status.secondsRemaining), tone: 'upcoming' };
  if (status.phase === 'ended') {
    const d = Number.isFinite(endAtSec) && endAtSec > 0 ? new Date(endAtSec * 1000) : null;
    return { text: d ? 'Ended ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Ended', tone: 'ended' };
  }
  return { text: '', tone: 'ended' };
}

/** Seller identity for a slide (profile name/picture, else short npub-ish id). */
export function sellerOf(pubkey, profiles) {
  const p = profiles && typeof profiles.get === 'function' ? profiles.get(pubkey) : null;
  const short = typeof pubkey === 'string' ? pubkey.slice(0, 8) : '';
  return { pubkey: pubkey || '', name: clip((p && p.name) || short, 32), picture: safeImageUrl(p && p.picture) };
}

/** PRODUCT board slides. */
export function buildProductSlides(productEvents, profiles) {
  return selectOnSaleProducts(productEvents).slice(0, MAX_SLIDES).map((p) => ({
    kind: 'product',
    id: p.id,
    title: clip(p.title, 80),
    image: safeImageUrl(p.poster),
    price: formatAmount(p.price, p.currency),
    stock: Number.isFinite(p.stock) && p.stock !== null ? (p.stock > 0 ? `${p.stock} in stock` : 'Sold out') : '',
    seller: sellerOf(p.sellerPubkey, profiles),
  }));
}

/** Only signed bids that reference THIS auction (by event id or a-coordinate). */
export function bidsFor(auction, bidEvents) {
  const out = [];
  for (const e of Array.isArray(bidEvents) ? bidEvents : []) {
    if (!e || e.kind !== 1023) continue;
    const refs = (e.tags || []).some((t) => Array.isArray(t) && ((t[0] === 'e' && t[1] === auction.id) || (t[0] === 'a' && t[1] === auction.aTag)));
    if (refs && verifyNostrEventSig(e)) out.push(e);
  }
  return out;
}

/** AUCTION board slides: live (soonest ending) → upcoming → ended (newest). */
export function buildAuctionSlides(auctionEvents, bidEvents, profiles, nowSec) {
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  const rank = { live: 0, upcoming: 1, ended: 2, unknown: 3 };
  const rows = [];
  for (const ev of Array.isArray(auctionEvents) ? auctionEvents : []) {
    const a = parseAuctionEvent(ev);
    if (!a) continue;
    const status = auctionStatus(a, now);
    const hist = buildBidHistory(bidsFor(a, bidEvents));
    const valid = hist.bids.filter((b) => b.isMonotonic);
    const end = a.maxEndAt || a.endAt;
    rows.push({
      kind: 'auction',
      id: a.id,
      aTag: a.aTag,
      title: clip(a.title, 80),
      image: safeImageUrl(a.poster),
      phase: status.phase,
      endAt: end,
      startAt: a.startAt,
      countdown: formatCountdown(status, end),
      highBid: hist.highBidAmount > 0 ? formatAmount(hist.highBidAmount, a.currency) : '',
      startingBid: formatAmount(a.startingBid, a.currency),
      bidCount: hist.bidCount,
      bidders: new Set(valid.map((b) => b.bidderPubkey)).size,
      seller: sellerOf(a.sellerPubkey, profiles),
    });
  }
  rows.sort((x, y) => (rank[x.phase] - rank[y.phase])
    || (x.phase === 'ended' ? y.endAt - x.endAt : x.phase === 'live' ? x.endAt - y.endAt : x.startAt - y.startAt));
  return rows.slice(0, MAX_SLIDES);
}

/** Re-time an auction slide's countdown for `nowSec` (cheap; no re-parse). */
export function retimeAuctionSlide(slide, nowSec) {
  if (!slide || slide.kind !== 'auction') return slide;
  const status = auctionStatus({ startAt: slide.startAt, endAt: slide.endAt, maxEndAt: slide.endAt }, nowSec);
  return { ...slide, phase: status.phase, countdown: formatCountdown(status, slide.endAt) };
}

/** Which slide is up after `elapsedSec` of cycling. */
export function slideIndexAt(elapsedSec, count, periodSec = SLIDE_SECONDS) {
  if (!(count > 0)) return -1;
  const t = Math.max(0, Number(elapsedSec) || 0);
  return Math.floor(t / periodSec) % count;
}

/** Pubkeys whose profiles the boards need (sellers), capped. */
export function sellersNeeded(slidesA, slidesB) {
  const s = new Set();
  for (const x of [...(slidesA || []), ...(slidesB || [])]) if (x && x.seller && x.seller.pubkey) s.add(x.seller.pubkey);
  return [...s].slice(0, 24);
}
