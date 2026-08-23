// kamiReplyRoute.js — ADR-0039. Pure helpers for the GET /mp/kami/replies route.
//
// Split out of arena-ws.js so the query parse + response shaping are unit-testable
// without an HTTP server. The route handler is a thin admin-gated wrapper that
// calls parseSince + replyStore.readRepliesSince + shapeReplyResponse.
import { REPLY_TEXT_CAP, REPLY_QUOTE_CAP } from './kamiReplyStore.js';

/**
 * Parse the ?since=<ts> query into a non-negative ms timestamp.
 * Anything missing/invalid → 0 (return the whole backlog).
 */
export function parseSince(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Shape the JSON response from raw reply records. Re-caps text/quote and coerces
 * types so the wire payload is predictable regardless of what the store returned.
 */
export function shapeReplyResponse(records) {
  const list = Array.isArray(records) ? records : [];
  return {
    v: 1,
    replies: list.map((r) => ({
      id: String((r && r.id) || ''),
      ts: Number((r && r.ts)) || 0,
      from: (r && r.from) || 'kami',
      ref: r && r.ref ? String(r.ref) : null,
      quote: typeof r?.quote === 'string' ? r.quote.slice(0, REPLY_QUOTE_CAP) : '',
      text: typeof r?.text === 'string' ? r.text.slice(0, REPLY_TEXT_CAP) : '',
    })),
  };
}
