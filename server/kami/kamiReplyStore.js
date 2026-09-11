// kamiReplyStore.js — ADR-0039. On-disk store for AI "Kami replies" to ema.
//
// WHY A SEPARATE FEED: the browser can SEAL ema (it has the owner + Kami pubkeys)
// but cannot DECRYPT the backlog — NIP-07 only signs, it never exposes the owner
// private key for ECDH, and kamiSeal's custom ECDH+HKDF+AES-GCM envelope is not
// NIP-04/NIP-44. So an AI reply sealed the same way would be unreadable in-game.
// Instead, AI replies are a separate PLAINTEXT feed the emagake rack polls and
// renders. Replies are AI-generated responses derived from the owner's own
// notes — low sensitivity (the owner already holds the plaintext of their own
// ema). The owner said these are "banal anyway" and the key is rotatable.
//
// Schema is SELF-CONTAINED: because the browser cannot decrypt the original ema,
// each reply carries an optional short `quote` of the ema it replies to, so the
// rack row reads on its own. `text` and `quote` are length-capped.
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

export const REPLY_TEXT_CAP  = 2000;
export const REPLY_QUOTE_CAP = 280;

function capStr(s, n) {
  const str = typeof s === 'string' ? s : '';
  return str.length > n ? str.slice(0, n) : str;
}

/**
 * Build a reply store bound to a directory (same kami dir as ema.jsonl).
 * @param {object} opts { dir, fs }  — fs is node:fs/promises API (injectable for tests)
 */
export function makeReplyStore({ dir, fs } = {}) {
  const f = fs || fsp;
  if (!f || typeof f.appendFile !== 'function' || typeof f.readFile !== 'function') {
    throw new Error('kamiReplyStore: fs (node:fs/promises API) is required');
  }
  const replyPath = join(dir, 'replies.jsonl');

  // Poll cursor. The file is append-only, so consecutive polls only need to
  // parse the NEW tail instead of re-parsing the whole growing history each
  // time. `readOffset` is the byte offset already consumed; `maxTs` is the
  // highest timestamp seen (the monotonic watermark for the rack's `?since=`).
  let readOffset = 0;
  let maxTs = 0;

  async function ensure() {
    await f.mkdir(dir, { recursive: true });
  }

  // Shape one JSONL line. Stable field order for greppability.
  function replyLine(entry) {
    const rec = {
      v: 1,
      id: String((entry && entry.id) || ''),
      ts: Number((entry && entry.ts)) || Date.now(),
      from: (entry && entry.from) || 'kami',
      ref: entry && entry.ref ? String(entry.ref) : null,
      quote: capStr(entry && entry.quote, REPLY_QUOTE_CAP),
      text: capStr(entry && entry.text, REPLY_TEXT_CAP),
    };
    return JSON.stringify(rec);
  }

  /** Append one reply. Atomic per-line append (small, line-buffered). */
  async function appendReply(entry) {
    await ensure();
    await f.appendFile(replyPath, replyLine(entry) + '\n', 'utf8');
  }

  /** Read all replies with ts > since. Malformed lines are skipped, not fatal. */
  async function readRepliesSince(ts) {
    const since = Number(ts) || 0;
    let raw;
    try { raw = await f.readFile(replyPath, 'utf8'); }
    catch { return []; }

    // Append-only invariant broken (external reset/rotation): re-parse from the
    // start, never trust a cursor beyond the current file length.
    if (raw.length < readOffset) {
      readOffset = 0;
      maxTs = 0;
    }

    // A non-monotonic `since` (the poll went backwards) must see history again,
    // so fall back to parsing the whole file in that case only.
    const needHistory = since < maxTs;
    const text = needHistory ? raw : raw.slice(readOffset);
    const out = [];
    let scanMax = 0;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let rec;
      try { rec = JSON.parse(t); } catch { continue; }
      if (!rec || rec.v !== 1) continue;
      const recTs = Number(rec.ts) || 0;
      if (recTs > scanMax) scanMax = recTs;
      if (recTs <= since) continue;
      out.push({
        id: String(rec.id || ''),
        ts: recTs,
        from: rec.from || 'kami',
        ref: rec.ref ? String(rec.ref) : null,
        quote: capStr(rec.quote, REPLY_QUOTE_CAP),
        text: capStr(rec.text, REPLY_TEXT_CAP),
      });
    }

    // Advance the cursor past everything just consumed, and keep the true
    // maximum timestamp as the monotonic watermark.
    readOffset = raw.length;
    maxTs = needHistory ? scanMax : Math.max(maxTs, scanMax);
    return out;
  }

  return { ensure, appendReply, readRepliesSince, replyLine, replyPath, dir };
}

export { capStr };
