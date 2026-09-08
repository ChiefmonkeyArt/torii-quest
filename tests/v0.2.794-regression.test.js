// tests/v0.2.794-regression.test.js — Blossom upload now uses the correct
// BUD-11 authorisation event (kind 24242 + `t`/`x`/`expiration` tags) instead
// of the NIP-98 kind 27235 that blossom.primal.net (and any BUD-11 server)
// rejects with 401. That 401 lacked CORS headers, so the browser could not
// read the status, `fetch` threw, and the player saw the opaque "upload-failed"
// instead of a real HTTP error.
//
// Source-locking keeps src/nostr.js honest without importing the entry module
// or hitting a live server.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src', 'nostr.js'), 'utf8');

describe('v0.2.794 — Blossom BUD-11 authorisation', () => {
  it('auth kind is 24242, not NIP-98 27235', () => {
    expect(SRC).toMatch(/BLOSSOM_AUTH_KIND\s*=\s*24242/);
    expect(SRC).not.toMatch(/BLOSSOM_AUTH_KIND\s*=\s*27235/);
  });

  it('the auth event carries the upload action verb (t tag)', () => {
    expect(SRC).toContain("['t', 'upload']");
  });

  it('the auth event is scoped to the blob hash via the x tag', () => {
    expect(SRC).toContain("['x', o.sha256.toLowerCase()]");
  });

  it('a NIP-40 expiration tag is always present', () => {
    expect(SRC).toContain("['expiration', String(exp)]");
  });

  it('uploadBlossom hashes the file bytes and signs with that sha256', () => {
    // The hash is computed from the body, then threaded into the auth event.
    expect(SRC).toContain('bytesToHex(sha256(new Uint8Array(buf)))');
    expect(SRC).toContain("buildBlossomAuthEvent(server, 'PUT', { sha256: shaHex })");
  });

  it('the PUT sends the X-SHA-256 header matching the scoped hash', () => {
    expect(SRC).toContain("'X-SHA-256': shaHex");
  });
});