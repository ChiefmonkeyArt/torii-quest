// tests/admin-update.test.js — QUEST-side admin "Update Now" request authority
// (server/auth/adminUpdate.js, UPD-2, v0.2.387-alpha).
//
// The gate NEVER runs a shell — on a verified admin intent it writes ONE atomic
// JSON request file that a separate root runner consumes. These tests exercise the
// full fail-closed surface against a real temp dir with a fake clock: capability
// signalling, a real schnorr-verified happy path, freshness/replay + pubkey +
// content + kind rejections, and single-flight (409) via a pending file / running
// status. The install TARGET is never client-supplied — asserted by inspecting the
// written file's fields.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createAdminUpdate, UPDATE_ACTION, DEFAULT_FRESHNESS_MS } from '../server/auth/adminUpdate.js';
import { nostrEventId } from '../src/engine/crypto/nostrSig.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

const SK = hexToBytes('b2'.repeat(32));
const ADMIN = bytesToHex(schnorr.getPublicKey(SK)); // x-only hex64
const OTHER_SK = hexToBytes('c3'.repeat(32));

// A real schnorr-signed intent event (kind:1, content torii-quest:update-now:<nonce>).
function signIntent({ sk = SK, nonce = 'a'.repeat(16), createdAtSec }) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const evt = {
    pubkey,
    kind: 1,
    created_at: createdAtSec,
    content: `torii-quest:update-now:${nonce}`,
    tags: [],
  };
  const id = nostrEventId(evt);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, id, sig };
}

let dir;
let requestsDir;
let statusPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-upd-'));
  requestsDir = path.join(dir, 'update-requests');
  statusPath = path.join(dir, 'update-status.json');
  fs.mkdirSync(requestsDir);
});
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function make(overrides = {}) {
  return createAdminUpdate({
    adminPubkeyHex: ADMIN,
    requestsDir,
    statusPath,
    installedVersion: 'v0.2.387-alpha',
    now: () => 1_000_000_000_000, // fixed ms clock
    ...overrides,
  });
}

describe('capability', () => {
  it('reports autoUpdate=true + the admin pubkey when configured and dir writable', () => {
    const c = make().capability();
    expect(c.autoUpdate).toBe(true);
    expect(c.adminPubkey).toBe(ADMIN);
  });

  it('reports autoUpdate=false and null pubkey when admin is unset', () => {
    const c = createAdminUpdate({ adminPubkeyHex: '', requestsDir, statusPath }).capability();
    expect(c.autoUpdate).toBe(false);
    expect(c.adminPubkey).toBeNull();
  });

  it('reports autoUpdate=false when the requests dir is missing', () => {
    const c = createAdminUpdate({ adminPubkeyHex: ADMIN, requestsDir: path.join(dir, 'nope'), statusPath }).capability();
    expect(c.autoUpdate).toBe(false);
    expect(c.adminPubkey).toBe(ADMIN); // pubkey is public, still surfaced
  });
});

describe('isAdmin', () => {
  it('matches the configured admin hex only', () => {
    const a = make();
    expect(a.isAdmin(ADMIN)).toBe(true);
    expect(a.isAdmin(ADMIN.toUpperCase())).toBe(true);
    expect(a.isAdmin(bytesToHex(schnorr.getPublicKey(OTHER_SK)))).toBe(false);
    expect(a.isAdmin('')).toBe(false);
    expect(a.isAdmin('zz')).toBe(false);
  });
});

describe('requestUpdate — happy path (real signature)', () => {
  it('writes ONE atomic request file and reports state=requested', () => {
    const nowSec = Math.floor(1_000_000_000_000 / 1000);
    const event = signIntent({ nonce: 'deadbeefdeadbeef', createdAtSec: nowSec });
    const res = make().requestUpdate({ event });
    expect(res.ok).toBe(true);
    expect(res.code).toBe(200);
    expect(res.state).toBe('requested');
    expect(res.nonce).toBe('deadbeefdeadbeef');

    const files = fs.readdirSync(requestsDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
    expect(files.length).toBe(1);
    const body = JSON.parse(fs.readFileSync(path.join(requestsDir, files[0]), 'utf8'));
    expect(body.action).toBe(UPDATE_ACTION);
    expect(body.nonce).toBe('deadbeefdeadbeef');
    expect(body.adminPubkey).toBe(ADMIN);
    expect(body.installedVersion).toBe('v0.2.387-alpha');
    // The install TARGET is NEVER carried from the client.
    expect(body.ref).toBeUndefined();
    expect(body.target).toBeUndefined();
    // No stray temp files left behind.
    expect(fs.readdirSync(requestsDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('requestUpdate — rejections (fail-closed)', () => {
  const nowSec = Math.floor(1_000_000_000_000 / 1000);

  it('503 when admin is not configured', () => {
    const a = createAdminUpdate({ adminPubkeyHex: '', requestsDir, statusPath, now: () => 1_000_000_000_000 });
    const res = a.requestUpdate({ event: signIntent({ createdAtSec: nowSec }) });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(503);
  });

  it('403 for a missing / non-object event', () => {
    expect(make().requestUpdate({}).code).toBe(403);
    expect(make().requestUpdate({ event: 'x' }).code).toBe(403);
  });

  it('403 for the wrong kind', () => {
    const event = signIntent({ createdAtSec: nowSec });
    const res = make({ verifyEventSig: () => true }).requestUpdate({ event: { ...event, kind: 27235 } });
    expect(res.code).toBe(403);
    expect(res.error).toMatch(/kind/);
  });

  it('403 when the event pubkey is not the admin', () => {
    const event = signIntent({ sk: OTHER_SK, createdAtSec: nowSec });
    const res = make().requestUpdate({ event });
    expect(res.code).toBe(403);
    expect(res.error).toMatch(/not admin/);
  });

  it('403 for bad content shape (wrong action / short nonce)', () => {
    const a = make({ verifyEventSig: () => true });
    const base = signIntent({ createdAtSec: nowSec });
    expect(a.requestUpdate({ event: { ...base, content: 'torii-quest:update-now:short' } }).code).toBe(403);
    expect(a.requestUpdate({ event: { ...base, content: 'hello' } }).code).toBe(403);
  });

  it('403 for a stale intent (>120s old)', () => {
    const staleSec = Math.floor((1_000_000_000_000 - DEFAULT_FRESHNESS_MS - 5000) / 1000);
    const event = signIntent({ createdAtSec: staleSec });
    const res = make().requestUpdate({ event });
    expect(res.code).toBe(403);
    expect(res.error).toMatch(/stale/);
  });

  it('403 for a future-skewed intent beyond the window', () => {
    const futureSec = Math.floor((1_000_000_000_000 + DEFAULT_FRESHNESS_MS + 5000) / 1000);
    const event = signIntent({ createdAtSec: futureSec });
    expect(make().requestUpdate({ event }).code).toBe(403);
  });

  it('403 for a bad signature (real verifier rejects a tampered event)', () => {
    const event = signIntent({ createdAtSec: nowSec });
    // Tamper the content AFTER signing → id/sig no longer match.
    const tampered = { ...event, content: 'torii-quest:update-now:ffffffffffffffff' };
    const res = make().requestUpdate({ event: tampered });
    expect(res.code).toBe(403);
  });
});

describe('requestUpdate — single-flight (409)', () => {
  const nowSec = Math.floor(1_000_000_000_000 / 1000);

  it('refuses when a request file already exists', () => {
    fs.writeFileSync(path.join(requestsDir, '123-abc.json'), '{}');
    const res = make().requestUpdate({ event: signIntent({ createdAtSec: nowSec }) });
    expect(res.code).toBe(409);
    expect(res.error).toMatch(/already requested/);
  });

  it('refuses when the status file reports running', () => {
    fs.writeFileSync(statusPath, JSON.stringify({ state: 'running' }));
    const res = make().requestUpdate({ event: signIntent({ createdAtSec: nowSec }) });
    expect(res.code).toBe(409);
    expect(res.error).toMatch(/already running/);
  });
});

describe('readStatus', () => {
  it('returns unavailable when the status file is absent', () => {
    expect(make().readStatus()).toEqual({ state: 'unavailable' });
  });
  it('reads a well-formed status file', () => {
    fs.writeFileSync(statusPath, JSON.stringify({ state: 'succeeded', version: 'v0.2.387-alpha' }));
    expect(make().readStatus()).toMatchObject({ state: 'succeeded' });
  });
  it('returns unavailable for malformed JSON', () => {
    fs.writeFileSync(statusPath, 'not json');
    expect(make().readStatus()).toEqual({ state: 'unavailable' });
  });
});
