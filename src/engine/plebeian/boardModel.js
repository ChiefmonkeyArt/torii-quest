// engine/plebeian/boardModel.js — ADR-0035. Pure, Nostr-shape-agnostic view
// models for the three owner-scoped boards: Live Products, Live Auctions,
// Past Auctions. No I/O, no WebSocket, no DOM — Node-testable.
//
// Verified against a real event pulled from wss://relay.staging.plebeian.market
// (2026-08-23, see docs/adr/0035-product-auction-boards.md):
//   product = NIP-99 kind 30402, tags include `visibility` ("on-sale" etc.),
//             `price` [amount, currency], `stock`, `title`, `summary`, `image`.
// Auctions reuse `parseAuctionEvent` from auctionModel.js unchanged — this
// module only adds the product parser + the live/past split + sort/paging
// helpers shared by all three boards.

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

/** First still image (jpg/png/webp) from an event's image tags. */
function posterImage(event) {
  const imgs = (event.tags || []).filter((t) => t[0] === 'image' && t[1]);
  const still = imgs.find((t) => /\.(jpe?g|png|webp)$/i.test(t[1]));
  return (still || imgs[0] || [])[1] || null;
}

/**
 * Parse a kind-30402 product (NIP-99 classified listing) event into a flat
 * view-model. Returns null if the event is not a valid product.
 */
export function parseProductEvent(event) {
  if (!event || event.kind !== 30402) return null;
  const d = tagFirst(event, 'd');
  const pubkey = event.pubkey;
  if (!d || !pubkey) return null;
  const priceTag = (event.tags || []).find((t) => t[0] === 'price');
  return {
    id: event.id,
    dTag: d,
    sellerPubkey: pubkey,
    title: tagFirst(event, 'title') || 'Untitled product',
    summary: tagFirst(event, 'summary') || '',
    content: event.content || '',
    poster: posterImage(event),
    images: (event.tags || [])
      .filter((t) => t[0] === 'image' && t[1])
      .map((t) => t[1]),
    price: priceTag ? num(priceTag[1]) : 0,
    currency: priceTag ? (priceTag[2] || 'SAT') : 'SAT',
    visibility: tagFirst(event, 'visibility') || 'unknown',
    stock: num(tagFirst(event, 'stock'), null),
    categories: tagAll(event, 't').flat(),
    createdAt: event.created_at || 0,
  };
}

/** Products currently for sale: visibility === 'on-sale'. Newest first. */
export function selectOnSaleProducts(productEvents) {
  return (productEvents || [])
    .map(parseProductEvent)
    .filter((p) => p && p.visibility === 'on-sale')
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Split parsed auctions into live / past by `end_at` vs `nowSec`. An auction
 * with no valid end_at is treated as live (fail open — better to show a
 * possibly-stale item than to hide it from view).
 */
export function splitAuctionsByEnd(auctionViewModels, nowSec) {
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  const live = [];
  const past = [];
  for (const a of (auctionViewModels || [])) {
    if (!a) continue;
    const end = a.maxEndAt || a.endAt;
    if (Number.isFinite(end) && end > 0 && end <= now) past.push(a);
    else live.push(a);
  }
  // Live: soonest-ending first (most urgent). Past: most-recently-ended first.
  live.sort((a, b) => (a.maxEndAt || a.endAt) - (b.maxEndAt || b.endAt));
  past.sort((a, b) => (b.maxEndAt || b.endAt) - (a.maxEndAt || a.endAt));
  return { live, past };
}
