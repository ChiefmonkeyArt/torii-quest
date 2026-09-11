// tests/multiplayer/session-cleanup.test.js — audit F12: retained histories are
// bounded hot-path data. The score-ledger reconnect index and bounded top-k, and
// the kami reply poll cursor, landed in v0.2.816 (score-ledger.test.js +
// kami-reply-store.test.js already cover them). The one remaining F12 item was
// the SHOT-pipeline diagnostic rate-limit Map (`_shotLogAt`), keyed by shooter
// id and never cleaned by closeSession — a timestamp-per-departed-shooter leak.
// This locks the cleanup into the teardown path.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const ARENA = readFileSync(join(ROOT, 'server', 'arena-ws.js'), 'utf8');

// Isolate the closeSession body: from `function closeSession(` to the next
// top-level `function `/closing brace at column 0 that ends it.
function closeSessionBody(src) {
  const start = src.indexOf('function closeSession(');
  if (start < 0) return '';
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

describe('F12 — per-session diagnostic state is cleaned on close', () => {
  it('the shot diagnostic rate-limit entry is dropped with the session', () => {
    const body = closeSessionBody(ARENA);
    expect(body).toContain('_shotLogAt.delete(sess.id)');
  });

  it('the cleanup runs alongside the other per-session teardown', () => {
    const body = closeSessionBody(ARENA);
    const del = body.indexOf('_shotLogAt.delete(sess.id)');
    const base = body.indexOf('sessions.delete(sess.id)');
    const rings = body.indexOf('snapshotRings.delete(sess.id)');
    expect(base).toBeGreaterThan(-1);
    expect(rings).toBeGreaterThan(-1);
    // Ordered within teardown: sessions → snapshotRings → shotLogAt.
    expect(base).toBeLessThan(rings);
    expect(rings).toBeLessThan(del);
  });

  it('the F12 score-ledger reconnect index and top-k remain in place', () => {
    // Regression guard: the earlier F12 fixes (O(1) npub→id reconnect index,
    // bounded top-k snapshot) must not be reverted by a later change.
    const ledger = readFileSync(join(ROOT, 'server', 'combat', 'scoreLedger.js'), 'utf8');
    expect(ledger).toContain('retiredByNpub');
    expect(ledger).toContain('function selectTop');
  });

  it('the F12 kami reply poll cursor remains in place', () => {
    const reply = readFileSync(join(ROOT, 'server', 'kami', 'kamiReplyStore.js'), 'utf8');
    expect(reply).toContain('let readOffset = 0');
    expect(reply).toContain('raw.slice(readOffset)');
  });
});