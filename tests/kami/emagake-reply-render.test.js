// emagake-reply-render.test.js — ADR-0039. Client render of AI reply rows.
//
// Uses a minimal DOM stub (createElement / getElementById / appendChild) so the
// render path is tested without a browser. Asserts reply rows render with the
// distinct class, use textContent (never innerHTML) so AI reply text cannot
// inject markup into the owner's panel, and that mergeReplies dedupes by id.

import { describe, it, expect } from 'vitest';
import { renderEmagake, mergeReplies } from '../../src/engine/kami/emagakePanel.js';

function dom() {
  const body = { children: [], appendChild(c) { this.children.push(c); return c; }, set textContent(v) { this.children = []; }, get textContent() { return ''; } };
  const count = { set textContent(v) {}, get textContent() { return ''; } };
  return {
    body,
    getElementById(id) {
      if (id === 'emagake-body') return body;
      if (id === 'emagake-count') return count;
      return null;
    },
    createElement(tag) {
      const el = {
        tag, _children: [], _text: '', _html: '', className: '', id: '', title: '', dataset: {},
        style: {},
        appendChild(c) { this._children.push(c); return c; },
        addEventListener() {},
        set textContent(v) { this._text = String(v); },
        get textContent() { return this._text; },
        set innerHTML(v) { this._html = String(v); },
        get innerHTML() { return this._html; },
        set src(v) { this._src = v; },
        get src() { return this._src; },
        set alt(v) { this._alt = v; },
        get alt() { return this._alt; },
        class: '',
      };
      return el;
    },
  };
}

describe('mergeReplies', () => {
  it('dedupes by id, newest-first', () => {
    const out = mergeReplies(
      [{ id: 'a', ts: 1000 }, { id: 'b', ts: 2000 }],
      [{ id: 'b', ts: 2000 }, { id: 'c', ts: 3000 }],
    );
    expect(out.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('caps to 64', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: 'r' + i, ts: i }));
    const out = mergeReplies([], many);
    expect(out).toHaveLength(64);
    expect(out[0].id).toBe('r79'); // newest first
  });

  it('ignores entries without an id', () => {
    const out = mergeReplies([], [{ id: 'a', ts: 1 }, { ts: 2 }, { id: 'b', ts: 3 }]);
    expect(out.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('renderEmagake reply rows', () => {
  it('renders a reply row with the kami-reply class', () => {
    const doc = dom();
    renderEmagake([], { doc, replies: [{ id: 'r1', ts: 1000, text: 'hi from kami', quote: 'orig ema', ref: 'ema-9' }] });
    const row = doc.body.children.find((c) => c.dataset.replyId === 'r1');
    expect(row).toBeTruthy();
    expect(row.className).toBe('ema-row kami-reply');
  });

  it('uses textContent for reply text, never innerHTML — HTML stays as text', () => {
    const doc = dom();
    const evil = '<img src=x onerror=alert(1)>';
    renderEmagake([], { doc, replies: [{ id: 'r1', ts: 1000, text: evil, quote: evil }] });
    const row = doc.body.children.find((c) => c.dataset.replyId === 'r1');
    expect(row).toBeTruthy();
    // The note text must be the literal string, not parsed as HTML.
    const note = row._children.find((c) => c.className === 'ema-main')._children.find((c) => c.className === 'ema-note');
    expect(note._text).toBe(evil);
    expect(note._html).toBe('');
  });

  it('shows the quote line when a quote is present', () => {
    const doc = dom();
    renderEmagake([], { doc, replies: [{ id: 'r1', ts: 1000, text: 'reply', quote: 'original ema text' }] });
    const row = doc.body.children.find((c) => c.dataset.replyId === 'r1');
    const quote = row._children.find((c) => c.className === 'ema-main')._children.find((c) => c.className === 'ema-quote');
    expect(quote._text).toContain('original ema text');
  });

  it('renders replies above ema rows, newest reply first', () => {
    const doc = dom();
    // One ema record + two replies. Replies should appear before the ema row,
    // newest reply first.
    const records = [{ id: 'e1', status: 'OPEN', note: 'ema note', world: null, created: 500 }];
    const replies = [
      { id: 'r1', ts: 1000, text: 'older reply' },
      { id: 'r2', ts: 2000, text: 'newer reply' },
    ];
    renderEmagake(records, { doc, replies });
    const order = doc.body.children.map((c) => c.dataset.replyId || c.dataset.emaId).filter(Boolean);
    expect(order[0]).toBe('r2');
    expect(order[1]).toBe('r1');
    expect(order[order.length - 1]).toBe('e1');
  });

  it('shows the empty state only when both ema and replies are empty', () => {
    const doc = dom();
    renderEmagake([], { doc, replies: [] });
    expect(doc.body.children.some((c) => c.id === 'emagake-empty')).toBe(true);

    const doc2 = dom();
    renderEmagake([], { doc: doc2, replies: [{ id: 'r1', ts: 1, text: 'hi' }] });
    expect(doc2.body.children.some((c) => c.id === 'emagake-empty')).toBe(false);
  });
});
