// server/kami/kamiNostr.js — ADR-0040 Stage 1.
// Pure NIP-17 gift-wrap helpers + a relay EVENT publisher for Kami's outbound
// replies. Runs server-side (Node) only — the browser cannot unwrap NIP-44
// without window.nostr.nip44 (see ADR-0040). Uses nostr-tools (nip17/nip44),
// added as a server-only dep; NOT shipped to the browser bundle.
//
// Kami = the sender (holds kami-priv). Owner = the recipient (public npub only).
// buildGiftWrap produces a kind:1059 gift-wrapped DM the owner can open in any
// NIP-17 client (Buzz, Amethyst, Nostir). The tool dual-writes: this wrap to a
// relay AND the same text to replies.jsonl (ADR-0039 in-game rack, unchanged).

import { nip17 } from 'nostr-tools';

export const REPLY_TEXT_CAP = 2000;

const HEX = /^[0-9a-f]{64}$/i;

function hexToU8(hex) {
  // 64-char hex → 32-byte Uint8Array. nostr-tools schnorr expects a real
  // Uint8Array (a Buffer is type 'object' and fails its abytes() guard).
  if (!HEX.test(hex)) return null;
  const u8 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    u8[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return u8;
}

function capText(text) {
  if (typeof text !== 'string') return '';
  const t = text.trim();
  return t.length > REPLY_TEXT_CAP ? t.slice(0, REPLY_TEXT_CAP) : t;
}

// buildGiftWrap({ kamiPrivHex, ownerPubHex, text, created_at? }) →
//   { ok:true, wrap, id, ts, text } | { ok:false, error }.
// Pure: no I/O. The wrap is a signed kind:1059 event ready to publish.
export function buildGiftWrap({ kamiPrivHex, ownerPubHex, text, createdAt } = {}) {
  const sender = hexToU8(kamiPrivHex);
  if (!sender) return { ok: false, error: 'bad-kami-priv' };
  if (!HEX.test(ownerPubHex || '')) return { ok: false, error: 'bad-owner-pubkey' };
  const body = capText(text);
  if (!body) return { ok: false, error: 'empty-text' };
  const ts = typeof createdAt === 'number' ? createdAt : Math.floor(Date.now() / 1000);
  try {
    // nip17.wrapEvent(senderPriv, { publicKey: hexString }, message) → kind:1059.
    // recipient.publicKey must be a HEX STRING (the #p tag is a string array).
    const wrap = nip17.wrapEvent(sender, { publicKey: ownerPubHex.toLowerCase() }, body);
    if (!wrap || wrap.kind !== 1059 || !wrap.sig) {
      return { ok: false, error: 'wrap-failed' };
    }
    return { ok: true, wrap, id: wrap.id, ts, text: body };
  } catch (err) {
    return { ok: false, error: 'wrap-threw: ' + (err && err.message ? err.message : String(err)) };
  }
}

// publishEventToRelay(url, event, { WebSocketCtor, timeoutMs }) →
//   { ok, relay, accepted, reason? }.
// Opens one WS, sends ["EVENT", event], resolves on the relay's OK frame.
// Injectable transport so it's unit-testable without a live relay.
export function publishEventToRelay(url, event, { WebSocketCtor, timeoutMs = 8000 } = {}) {
  const WS = WebSocketCtor || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  return new Promise((resolve) => {
    if (!WS) return resolve({ ok: false, relay: url, accepted: false, reason: 'no-websocket' });
    let done = false;
    const finish = (r) => { if (!done) { done = true; try { ws.close(); } catch (_) {} resolve(r); } };
    let ws;
    try { ws = new WS(url); }
    catch (e) { return resolve({ ok: false, relay: url, accepted: false, reason: 'bad-url' }); }
    const timer = setTimeout(() => finish({ ok: false, relay: url, accepted: false, reason: 'timeout' }), timeoutMs);
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['EVENT', event])); }
      catch (e) { finish({ ok: false, relay: url, accepted: false, reason: 'send-failed' }); }
    };
    ws.onmessage = (msg) => {
      const raw = msg && msg.data;
      // undici gives a string for text frames; the `ws` pkg gives a Buffer.
      const s = typeof raw === 'string' ? raw : (raw && typeof raw.toString === 'function' ? raw.toString('utf8') : String(raw));
      let frame;
      try { frame = JSON.parse(s); }
      catch (_) { return; }
      if (!Array.isArray(frame) || frame[0] !== 'OK') return;
      const accepted = frame[2] === true || frame[2] === 'true';
      clearTimeout(timer);
      finish({ ok: accepted, relay: url, accepted, reason: accepted ? null : (frame[3] || 'rejected') });
    };
    ws.onerror = () => finish({ ok: false, relay: url, accepted: false, reason: 'socket-error' });
    ws.onclose = () => finish({ ok: false, relay: url, accepted: false, reason: 'closed' });
  });
}

// Default relay set: the owner reads from their client's relays; publish to a
// small spread (Plebeian staging + common public relays) for reach.
export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.staging.plebeian.market',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];
