// engine/plebeian/plebeianRelay.js — ADR-0026 + ADR-0035. Browser WebSocket
// client for Plebeian's Nostr relay. `subscribeAuction` (ADR-0026, unchanged)
// subscribes to one auction (kind 30408 by id) + its bids (kind 1023 by #e).
// `subscribeByAuthor` (ADR-0035, additive) subscribes to every event of a
// given kind (or kinds) from one author — the query shape the new boards use
// to list ALL of the owner's products/auctions rather than one hardcoded id.
//
// SPLIT ON PURPOSE: `reduceEvents` / `reduceAuthorEvents` are pure functions
// over Nostr wire frames, so the accumulation + dedup rules are unit-testable
// without a browser. Only the `subscribe*` functions touch a WebSocket.
// READ-ONLY: this client never publishes, signs, or sends anything but REQ
// subscriptions.

import { parseProfileEvent } from './auctionModel.js';

export const PLEBEIAN_AUCTION_KIND = 30408;
export const PLEBEIAN_BID_KIND = 1023;
// ADR-0035: NIP-99 classified listing (product) kind, confirmed against a
// real staging event (see docs/adr/0035-product-auction-boards.md).
export const PLEBEIAN_PRODUCT_KIND = 30402;

/**
 * Fold one Nostr wire frame into the subscription state. Pure — no I/O.
 * state = { auction: event|null, bids: event[], eosed: bool }.
 * Returns the SAME ref when nothing changed (so callers can skip work), a NEW
 * ref when it did.
 */
export function reduceEvents(state, frame) {
  const s = state || { auction: null, bids: [], eosed: false };
  if (!Array.isArray(frame) || frame.length < 2) return s;
  const [type, subId, event] = frame;
  if (type === 'EVENT' && event) {
    if (subId === 'auc' && event.kind === PLEBEIAN_AUCTION_KIND) {
      return { ...s, auction: event };
    }
    if (subId === 'bids' && event.kind === PLEBEIAN_BID_KIND) {
      if (!event.id || s.bids.some((b) => b.id === event.id)) return s; // dedup
      return { ...s, bids: [...s.bids, event] };
    }
  }
  if (type === 'EOSE') return { ...s, eosed: true };
  return s;
}

/**
 * Open a live subscription to a Plebeian relay for one auction + its bids.
 * opts: { url, auctionId, onUpdate(snapshot), onStatus(status) }.
 * Returns { close() }. Auto-reconnects with backoff on close.
 */
export function subscribeAuction(opts) {
  const { url, auctionId, onUpdate, onStatus } = opts || {};
  let state = { auction: null, bids: [], eosed: false };
  let closed = false;
  let ws = null;
  let retry;

  function emit() {
    if (onUpdate) onUpdate({ auction: state.auction, bids: state.bids.slice() });
  }
  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(url);
    } catch {
      if (onStatus) onStatus('error');
      retry = setTimeout(connect, 3000);
      return;
    }
    ws.onopen = () => {
      if (onStatus) onStatus('open');
      ws.send(JSON.stringify(['REQ', 'auc', { ids: [auctionId] }]));
      ws.send(JSON.stringify(['REQ', 'bids', { '#e': [auctionId], kinds: [PLEBEIAN_BID_KIND], limit: 500 }]));
    };
    ws.onmessage = (msg) => {
      let frame;
      try { frame = JSON.parse(msg.data); } catch { return; }
      const next = reduceEvents(state, frame);
      if (next !== state) { state = next; emit(); }
    };
    ws.onerror = () => { if (onStatus) onStatus('error'); };
    ws.onclose = () => {
      if (closed) return;
      if (onStatus) onStatus('reconnecting');
      retry = setTimeout(connect, 3000);
    };
  }
  connect();
  return {
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      if (ws) { try { ws.close(); } catch { /* noop */ } }
    },
  };
}

/**
 * ADR-0035: fold one Nostr wire frame into an author-scoped event list. Pure —
 * no I/O. state = { events: event[], eosed: bool }. Replaces an existing event
 * with the same `d` tag + kind (NIP-33 parameterized replaceable: a re-edit of
 * the same product/auction carries the same `d`, and only the newest should
 * be kept) rather than appending a duplicate. Falls back to id-dedup for any
 * event with no `d` tag. Returns the SAME ref when nothing changed.
 */
export function reduceAuthorEvents(state, frame) {
  const s = state || { events: [], eosed: false };
  if (!Array.isArray(frame) || frame.length < 2) return s;
  const [type, , event] = frame;
  if (type === 'EVENT' && event && event.id) {
    const dTag = (event.tags || []).find((t) => t[0] === 'd');
    const dVal = dTag ? dTag[1] : null;
    const matches = (e) => (dVal != null
      ? e.kind === event.kind && (e.tags || []).some((t) => t[0] === 'd' && t[1] === dVal)
      : e.id === event.id);
    const idx = s.events.findIndex(matches);
    if (idx === -1) return { ...s, events: [...s.events, event] };
    // Newer created_at wins; an out-of-order older copy changes nothing.
    if ((s.events[idx].created_at || 0) >= (event.created_at || 0)) return s;
    const next = s.events.slice();
    next[idx] = event;
    return { ...s, events: next };
  }
  if (type === 'EOSE') return { ...s, eosed: true };
  return s;
}

/**
 * ADR-0035: open a live subscription to every event of `kinds` authored by
 * `author` (hex pubkey). Generalizes `subscribeAuction`'s single-id query into
 * a by-author-and-kind query, additive and independent — existing callers of
 * `subscribeAuction` are untouched. opts: { url, author, kinds:number[],
 * onUpdate(events), onStatus(status) }. Returns { close() }. Auto-reconnects
 * with backoff on close, same policy as `subscribeAuction`.
 */
export function subscribeByAuthor(opts) {
  const { url, author, kinds, onUpdate, onStatus } = opts || {};
  let state = { events: [], eosed: false };
  let closed = false;
  let ws = null;
  let retry;

  function emit() {
    if (onUpdate) onUpdate(state.events.slice());
  }
  function connect() {
    if (closed) return;
    if (!author || !Array.isArray(kinds) || !kinds.length) return;
    try {
      ws = new WebSocket(url);
    } catch {
      if (onStatus) onStatus('error');
      retry = setTimeout(connect, 3000);
      return;
    }
    ws.onopen = () => {
      if (onStatus) onStatus('open');
      ws.send(JSON.stringify(['REQ', 'byauthor', { authors: [author], kinds, limit: 500 }]));
    };
    ws.onmessage = (msg) => {
      let frame;
      try { frame = JSON.parse(msg.data); } catch { return; }
      const next = reduceAuthorEvents(state, frame);
      if (next !== state) { state = next; emit(); }
    };
    ws.onerror = () => { if (onStatus) onStatus('error'); };
    ws.onclose = () => {
      if (closed) return;
      if (onStatus) onStatus('reconnecting');
      retry = setTimeout(connect, 3000);
    };
  }
  connect();
  return {
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      if (ws) { try { ws.close(); } catch { /* noop */ } }
    },
  };
}

/**
 * Resolve bidder display identities (kind-0 profiles) for a set of pubkeys.
 * Queries every relay in `relays` in parallel, merges results (first name/picture
 * wins per pubkey), resolves once all close or after `timeoutMs`. Read-only: only
 * sends REQ subscriptions, never publishes.
 * @returns {Promise<Map<string,{name:string|null,picture:string|null}>>}
 */
export function fetchProfiles(pubkeys, relays, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const out = new Map();
    const list = (pubkeys && pubkeys.length) ? [...new Set(pubkeys)] : [];
    const urls = (relays && relays.length) ? [...new Set(relays)] : [];
    if (!list.length || !urls.length) { resolve(out); return; }
    let pending = urls.length;
    const finish = () => {
      if (pending < 0) return;
      pending = -1;
      resolve(out);
    };
    const timer = setTimeout(finish, timeoutMs);
    urls.forEach((url) => {
      let ws;
      try { ws = new WebSocket(url); } catch { if (--pending <= 0) { clearTimeout(timer); finish(); } return; }
      let done = false;
      const settle = () => { if (done) return; done = true; if (--pending <= 0) { clearTimeout(timer); finish(); } };
      ws.onopen = () => {
        try { ws.send(JSON.stringify(['REQ', 'prof', { authors: list, kinds: [0] }])); } catch { settle(); return; }
        // give each relay a 6s collection window, then close
        setTimeout(() => { try { ws.close(); } catch { /* noop */ } settle(); }, 6000);
      };
      ws.onmessage = (msg) => {
        let frame;
        try { frame = JSON.parse(msg.data); } catch { return; }
        if (frame[0] !== 'EVENT' || !frame[2]) return;
        const p = parseProfileEvent(frame[2]);
        if (!p) return;
        const prev = out.get(p.pubkey) || { name: null, picture: null };
        out.set(p.pubkey, {
          name: prev.name || p.name,
          picture: prev.picture || p.picture,
        });
      };
      ws.onerror = () => {};
      ws.onclose = () => settle();
    });
  });
}
