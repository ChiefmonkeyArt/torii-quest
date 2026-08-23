// src/engine/plebeian/auctionModel.js
// ADR-0026 — Spatial Marketplace. Pure, Nostr-shape-agnostic auction view-model.
// Verified against Plebeian's auctionsdev relay (2026-08-22):
//   auction = NIP-99 kind 30408 (schema 'auction_v1')
//   bid     = kind 1023, references auction via #e (id) + #a (30408:pubkey:d)
// No I/O, no WebSocket, no DOM. Node-testable.

/** First image url from an event's image tags (jpg/png/webp; mp4 poster fallback). */
function posterImage(event) {
  const imgs = (event.tags || []).filter((t) => t[0] === 'image' && t[1]);
  const still = imgs.find((t) => /\.(jpe?g|png|webp)$/i.test(t[1]));
  return (still || imgs[0] || [])[1] || null;
}

/** Parse a kind-0 Nostr profile (metadata) event into {pubkey, name, picture}. Pure. */
export function parseProfileEvent(event) {
  if (!event || event.kind !== 0 || !event.pubkey) return null;
  let c = {};
  try { c = JSON.parse(event.content || '{}'); } catch { /* malformed content */ }
  const name = c.display_name || c.name || c.username || null;
  const picture = c.picture || c.avatar || null;
  if (!name && !picture) return null;
  return { pubkey: event.pubkey, name, picture };
}

/** Deterministic hue (0-359) from a string — stable per pubkey. */
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Resolve a bidder's display identity from a profile map (pubkey -> {name, picture}).
 *  Falls back to a colored-circle avatar + initial when no profile exists. Pure. */
export function resolveBidder(pubkey, profiles) {
  const p = (profiles && pubkey && profiles.get(pubkey)) || null;
  const name = (p && p.name) || null;
  const picture = (p && p.picture) || null;
  const initial = name ? name[0].toUpperCase() : (pubkey ? pubkey[0].toUpperCase() : '?');
  const hue = hashHue(pubkey || '?');
  return { name, picture, initial, hue };
}

/** All still image urls (excludes video). */
function galleryImages(event) {
  return (event.tags || [])
    .filter((t) => t[0] === 'image' && t[1] && /\.(jpe?g|png|webp)$/i.test(t[1]))
    .map((t) => t[1]);
}

function tagFirst(event, name) {
  const t = (event.tags || []).find((x) => x[0] === name);
  return t ? t[1] : null;
}

function tagAll(event, name) {
  return (event.tags || []).filter((t) => t[0] === name).map((t) => t.slice(1));
}

function num(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a kind-30408 auction event into a flat view-model.
 * Returns null if the event is not a valid auction.
 */
export function parseAuctionEvent(event) {
  if (!event || event.kind !== 30408) return null;
  const d = tagFirst(event, 'd');
  const pubkey = event.pubkey;
  if (!d || !pubkey) return null;
  const aTag = `30408:${pubkey}:${d}`;
  const startAt = num(tagFirst(event, 'start_at'));
  const endAt = num(tagFirst(event, 'end_at'));
  const specs = {};
  for (const t of (event.tags || [])) {
    if (t[0] === 'spec' && t[1] && t[2]) specs[t[1]] = t[2];
  }
  return {
    id: event.id,
    aTag,
    sellerPubkey: pubkey,
    sellerNpub: null, // filled by caller if it has bech32 conversion
    title: tagFirst(event, 'title') || 'Untitled auction',
    summary: tagFirst(event, 'summary') || '',
    content: event.content || '',
    poster: posterImage(event),
    images: galleryImages(event),
    auctionType: tagFirst(event, 'auction_type') || 'english',
    schema: tagFirst(event, 'schema') || 'auction_v1',
    currency: tagFirst(event, 'currency') || 'SAT',
    startingBid: num(tagFirst(event, 'starting_bid')),
    bidIncrement: num(tagFirst(event, 'bid_increment')),
    reserve: num(tagFirst(event, 'reserve')),
    startAt,
    endAt,
    maxEndAt: num(tagFirst(event, 'max_end_at'), endAt),
    settlementGrace: num(tagFirst(event, 'settlement_grace'), 3600),
    settlementPolicy: tagFirst(event, 'settlement_policy'),
    keyScheme: tagFirst(event, 'key_scheme'),
    mints: tagAll(event, 'mint').flat(),
    categories: tagAll(event, 't').flat(),
    specs,
    createdAt: event.created_at || 0,
  };
}

/**
 * Parse a kind-1023 bid event into a flat bid record.
 * Returns null if not a valid bid.
 */
export function parseBidEvent(event) {
  if (!event || event.kind !== 1023) return null;
  const eRef = (event.tags || []).find((t) => t[0] === 'e' && t[1]);
  if (!eRef) return null;
  return {
    id: event.id,
    auctionId: eRef[1],
    bidderPubkey: event.pubkey,
    time: event.created_at || 0,
    amount: num(tagFirst(event, 'amount')),
    currency: tagFirst(event, 'currency') || 'SAT',
    mint: tagFirst(event, 'mint'),
    status: tagFirst(event, 'status') || 'placed',
    prevBid: tagFirst(event, 'prev_bid') || null,
  };
}

/**
 * Build the bid history: sort by time, track the running high bid, flag bids that
 * FAIL the English-auction monotonic-increase rule (amount <= prior high) — these
 * are the "buggy" bids the owner saw accepted.
 *
 * @param {Array} bidEvents raw kind-1023 events
 * @param {Map<string,{name,picture}>} [profiles] resolved bidder profiles
 */
export function buildBidHistory(bidEvents, profiles) {
  const bids = bidEvents
    .map(parseBidEvent)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time || a.amount - b.amount);
  let high = 0;
  let highBid = null;
  const rows = bids.map((b) => {
    const beatsReserve = b.amount > 0; // informational
    const isMonotonic = b.amount > high; // English auction: must strictly exceed prior high
    if (isMonotonic) {
      high = b.amount;
      highBid = b.id;
    }
    return { ...b, isHighBid: isMonotonic, isMonotonic, beatsReserve, bidder: resolveBidder(b.bidderPubkey, profiles) };
  });
  // Mark only THE single top bid as the "high bid" shown in the panel — every
  // ascending bid raised the running high, but flagging all of them reads as noise
  // in a highest-first list. isHighBid is kept for back-compat / tests.
  for (const r of rows) r.isTopBid = highBid !== null && r.id === highBid;
  return {
    bids: rows,
    bidCount: rows.length,
    highBidAmount: high,
    highBidId: highBid,
    // bids that broke monotonic increase — the visible bug
    invalidBids: rows.filter((r) => !r.isMonotonic),
  };
}

/**
 * Auction phase + countdown. 'ended' once past endAt (or maxEndAt if extended).
 */
export function auctionStatus(auction, nowSec) {
  if (!auction) return { phase: 'unknown', secondsRemaining: 0 };
  const now = nowSec || Math.floor(Date.now() / 1000);
  const end = auction.maxEndAt || auction.endAt;
  if (now < auction.startAt) return { phase: 'upcoming', secondsRemaining: auction.startAt - now };
  if (now < end) return { phase: 'live', secondsRemaining: end - now };
  return { phase: 'ended', secondsRemaining: 0, secondsSinceEnd: now - end };
}

/** Full view-model: auction + bids + status. The panel renders from this.
 *  @param {Array} bidEvents raw kind-1023 events
 *  @param {Map<string,{name,picture}>} [profiles] resolved bidder profiles
 */
export function buildAuctionViewModel(auctionEvent, bidEvents, nowSec, profiles) {
  const auction = parseAuctionEvent(auctionEvent);
  if (!auction) return null;
  const history = buildBidHistory(bidEvents, profiles);
  const status = auctionStatus(auction, nowSec);
  return {
    auction,
    status,
    highBid: history.highBidAmount,
    bidCount: history.bidCount,
    bids: history.bids,
    invalidBids: history.invalidBids,
    nextMinBid: history.highBidAmount + auction.bidIncrement,
  };
}
