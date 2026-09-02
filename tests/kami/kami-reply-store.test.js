// kami-reply-store.test.js — ADR-0039. Tests for the AI reply on-disk store.
//
// A tiny in-memory fs implements the node:fs/promises subset the store uses, so
// the append/read logic is tested without touching disk.

import { describe, it, expect } from 'vitest';
import { makeReplyStore, REPLY_TEXT_CAP, REPLY_QUOTE_CAP } from '../../server/kami/kamiReplyStore.js';

function memFs() {
  const files = new Map();
  return {
    async mkdir() {},
    async appendFile(p, s) {
      const ex = files.get(p);
      if (ex) ex.content += s;
      else files.set(p, { content: s });
    },
    async readFile(p) {
      const f = files.get(p);
      if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return f.content;
    },
  };
}

describe('kamiReplyStore', () => {
  it('appends a reply and reads it back with ts > since', async () => {
    const fs = memFs();
    const store = makeReplyStore({ dir: '/k', fs });
    await store.appendReply({ id: 'a', ts: 1000, text: 'hello' });
    const out = await store.readRepliesSince(0);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    expect(out[0].text).toBe('hello');
    expect(out[0].from).toBe('kami');
  });

  it('readRepliesSince only returns rows newer than the high-water mark', async () => {
    const fs = memFs();
    const store = makeReplyStore({ dir: '/k', fs });
    await store.appendReply({ id: 'a', ts: 1000, text: 'one' });
    await store.appendReply({ id: 'b', ts: 2000, text: 'two' });
    await store.appendReply({ id: 'c', ts: 3000, text: 'three' });
    const out = await store.readRepliesSince(1500);
    expect(out.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('returns [] when the file does not exist yet', async () => {
    const store = makeReplyStore({ dir: '/k', fs: memFs() });
    const out = await store.readRepliesSince(0);
    expect(out).toEqual([]);
  });

  it('ignores malformed lines without failing the read', async () => {
    const fs = memFs();
    const store = makeReplyStore({ dir: '/k', fs });
    // Manually write a file with a good line, a junk line, and another good line.
    await store.appendReply({ id: 'a', ts: 1000, text: 'good1' });
    await fs.appendFile(store.replyPath, 'not json at all\n');
    await store.appendReply({ id: 'b', ts: 2000, text: 'good2' });
    const out = await store.readRepliesSince(0);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('caps text and quote length', async () => {
    const fs = memFs();
    const store = makeReplyStore({ dir: '/k', fs });
    const longText = 'x'.repeat(REPLY_TEXT_CAP + 50);
    const longQuote = 'q'.repeat(REPLY_QUOTE_CAP + 50);
    await store.appendReply({ id: 'a', ts: 1000, text: longText, quote: longQuote });
    const [r] = await store.readRepliesSince(0);
    expect(r.text.length).toBe(REPLY_TEXT_CAP);
    expect(r.quote.length).toBe(REPLY_QUOTE_CAP);
  });

  it('preserves ref and from fields through a round trip', async () => {
    const fs = memFs();
    const store = makeReplyStore({ dir: '/k', fs });
    await store.appendReply({ id: 'a', ts: 1000, from: 'kami', ref: 'ema-123', text: 'hi', quote: 'orig' });
    const [r] = await store.readRepliesSince(0);
    expect(r.ref).toBe('ema-123');
    expect(r.from).toBe('kami');
    expect(r.quote).toBe('orig');
  });
});
