// kami-reply-route.test.js — ADR-0039. Pure helper tests for the GET route.
// parseSince + shapeReplyResponse are pure and tested without an HTTP server.

import { describe, it, expect } from 'vitest';
import { parseSince, shapeReplyResponse } from '../../server/kami/kamiReplyRoute.js';
import { REPLY_TEXT_CAP, REPLY_QUOTE_CAP } from '../../server/kami/kamiReplyStore.js';

describe('parseSince', () => {
  it('parses a valid timestamp', () => {
    expect(parseSince('123456')).toBe(123456);
  });
  it('missing / null → 0', () => {
    expect(parseSince(null)).toBe(0);
    expect(parseSince(undefined)).toBe(0);
    expect(parseSince('')).toBe(0);
  });
  it('invalid → 0', () => {
    expect(parseSince('abc')).toBe(0);
    expect(parseSince('NaN')).toBe(0);
  });
  it('negative → 0', () => {
    expect(parseSince('-5')).toBe(0);
  });
  it('floors floats', () => {
    expect(parseSince('123.9')).toBe(123);
  });
});

describe('shapeReplyResponse', () => {
  it('returns replies in the wire envelope', () => {
    const out = shapeReplyResponse([{ id: 'a', ts: 1000, text: 'hi', quote: 'q', ref: 'r', from: 'kami' }]);
    expect(out.v).toBe(1);
    expect(out.replies).toHaveLength(1);
    expect(out.replies[0].text).toBe('hi');
  });

  it('caps text and quote length', () => {
    const out = shapeReplyResponse([{
      id: 'a', ts: 1000,
      text: 'x'.repeat(REPLY_TEXT_CAP + 20),
      quote: 'q'.repeat(REPLY_QUOTE_CAP + 20),
    }]);
    expect(out.replies[0].text.length).toBe(REPLY_TEXT_CAP);
    expect(out.replies[0].quote.length).toBe(REPLY_QUOTE_CAP);
  });

  it('treats HTML-looking reply text as plain string, not markup', () => {
    // The route does NOT parse or strip HTML — it caps the string and passes it
    // through. The client renders with textContent (tested in the render suite).
    // This asserts the wire never silently drops or reinterprets the content.
    const evil = '<img src=x onerror=alert(1)> <script>bad()</script>';
    const out = shapeReplyResponse([{ id: 'a', ts: 1000, text: evil, quote: evil }]);
    expect(out.replies[0].text).toBe(evil);
    expect(out.replies[0].quote).toBe(evil);
  });

  it('coerces missing fields to safe defaults', () => {
    const out = shapeReplyResponse([{ id: 'a', ts: 1000 }]);
    expect(out.replies[0].text).toBe('');
    expect(out.replies[0].quote).toBe('');
    expect(out.replies[0].from).toBe('kami');
    expect(out.replies[0].ref).toBeNull();
  });

  it('handles non-array input', () => {
    expect(shapeReplyResponse(null).replies).toEqual([]);
    expect(shapeReplyResponse(undefined).replies).toEqual([]);
  });
});
