// engine/napplets/productNappletSnapshot.js — ADR-0058. PURE + node-safe. Serializes a
// Plebeian auction view-model into plain JSON safe to postMessage into a sandboxed
// napplet iframe. The napplet renders from this structured data with textContent —
// never innerHTML of untrusted data.
//
// What is stripped / why:
//  - Maps / functions / class instances: not cloneable across the postMessage boundary.
//  - Remote profile picture URLs: v1 uses initials only (colored circle + initial).
//    Image loading is deferred; if it ever lands it allows only https: + referrerPolicy.
//  - Raw event fields the renderer does not need (mints, specs, settlementPolicy, …).
//  - Bid rows are capped (highest-first) — the panel re-renders fully each push, so a
//    runaway auction cannot grow the iframe DOM unbounded.

const MAX_BIDS = 64;

// serializeBidList(vm) → plain JSON safe for iframe transfer, or null if no auction.
// `vm` is the output of auctionModel.buildAuctionViewModel().
export function serializeBidList(vm) {
  if (!vm || !vm.auction) return null;
  const a = vm.auction;
  const rows = [...(vm.bids || [])]
    .sort((x, y) => y.amount - x.amount || x.time - y.time)
    .slice(0, MAX_BIDS)
    .map((b) => {
      const bd = (b && b.bidder) || {};
      return {
        time: Number.isFinite(b.time) ? b.time : 0,
        amount: Number.isFinite(b.amount) ? b.amount : 0,
        isTopBid: !!b.isTopBid,
        isMonotonic: !!b.isMonotonic,
        bidder: {
          name: typeof bd.name === 'string' && bd.name ? bd.name : null,
          initial: typeof bd.initial === 'string' && bd.initial ? bd.initial : '?',
          hue: Number.isFinite(bd.hue) ? bd.hue : 0,
        },
      };
    });
  return {
    title: typeof a.title === 'string' && a.title ? a.title : 'Untitled auction',
    currency: typeof a.currency === 'string' && a.currency ? a.currency : 'SAT',
    phase: (vm.status && vm.status.phase) || 'unknown',
    secondsRemaining: (vm.status && Number.isFinite(vm.status.secondsRemaining)) ? vm.status.secondsRemaining : 0,
    highBid: Number.isFinite(vm.highBid) ? vm.highBid : 0,
    bidCount: Number.isFinite(vm.bidCount) ? vm.bidCount : 0,
    nextMinBid: Number.isFinite(vm.nextMinBid) ? vm.nextMinBid : 0,
    bids: rows,
  };
}

// buildSurfaceUpdatePayload(snapshot, status, seq) → the envelope `data` pushed via
// surface.post('world.surface.update', data). Centralizes the channel name so the
// shell + napplet agree on one constant.
export const PRODUCT_CHANNEL = 'plebeian.auction';

export function buildSurfaceUpdatePayload(snapshot, status, seq) {
  return {
    channel: PRODUCT_CHANNEL,
    seq: Number.isFinite(seq) ? seq : 0,
    status: typeof status === 'string' ? status : '',
    snapshot,
  };
}
