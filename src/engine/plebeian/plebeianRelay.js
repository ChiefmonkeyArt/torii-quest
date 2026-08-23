// engine/plebeian/plebeianRelay.js — ADR-0026. Browser WebSocket client for
// Plebeian's Nostr relay. Subscribes to one auction (kind 30408 by id) + its bids
// (kind 1023 by #e) and emits {auction, bids} snapshots via onUpdate.
//
// SPLIT ON PURPOSE: `reduceEvents` is a pure function over Nostr wire frames, so
// the accumulation + dedup rules are unit-testable without a browser. Only
// `subscribeAuction` touches a WebSocket. READ-ONLY: this client never publishes,
// signs, or sends anything but REQ subscriptions.

import { parseProfileEvent } from './auctionModel.js';

export const PLEBEIAN_AUCTION_KIND = 30408;
export const PLEBEIAN_BID_KIND = 1023;

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
