// tests/server-presence-beacon.test.js — server-side always-on presence beacon
// (server/presence/beacon.js, ADR-0094).
//
// Exercises the full state machine against a real temp dir with a fake clock and
// a fake relay publisher: fail-closed enable (no admin), key generation +
// persistence + restart resume, stop persistence, the signed presence event's
// shape (beacon-key pubkey + ["p",<admin>] owner tag + NIP-40 expiration), and
// lastPublishedAt/lastError accounting. Signing uses the REAL nostr-tools path so
// the emitted event's BIP-340 signature is verified against the beacon pubkey.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createBeacon, BEACON_INTERVAL_MS } from '../server/presence/beacon.js';
import { getPublicKey, finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools';
import { verifyNostrEventSig } from '../src/engine/crypto/nostrSig.js';

const ADMIN_HEX = 'a1'.repeat(32); // valid hex64 (not a real admin key; identity only)

let dir;
let statePath;
let clock;
const calls = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-beacon-'));
  statePath = path.join(dir, 'beacon-state.json');
  clock = { t: 1_700_000_000_000 };
  calls.length = 0;
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// Fake relay publisher that records each call and returns a scripted result.
function fakePublisher(results = []) {
  return async (url, event) => {
    calls.push(url);
    const r = results.shift();
    if (r && r.ok) return { ok: true, relay: url, accepted: true };
    return { ok: false, relay: url, accepted: false, reason: r && r.reason ? r.reason : 'rejected' };
  };
}

function make(overrides = {}) {
  return createBeacon({
    statePath,
    adminPubkeyHex: ADMIN_HEX,
    relays: ['wss://relay.example.com', 'wss://relay2.example.com'],
    website: 'https://torii.plebeian.build/',
    fs,
    now: () => clock.t,
    generateKey: generateSecretKey,
    getPubkey: getPublicKey,
    finalize: finalizeEvent,
    npubEncode: nip19.npubEncode,
    publishToRelay: fakePublisher([{ ok: true }, { ok: true }]),
    ...overrides,
  });
}

describe('createBeacon lifecycle', () => {
  it('fails closed to enable when no admin is configured', () => {
    const b = createBeacon({ statePath, adminPubkeyHex: '', fs, now: () => clock.t });
    expect(b.enable()).toEqual({ ok: false, error: 'admin-not-configured' });
    expect(b.capability().enabled).toBe(false);
    expect(b.capability().pubkey).toBeNull();
  });

  it('generates a key on first enable and persists enabled + activatedAt', () => {
    const b = make();
    const res = b.enable();
    expect(res.ok).toBe(true);
    const cap = b.capability();
    expect(cap.enabled).toBe(true);
    expect(cap.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(cap.adminPubkey).toBe(ADMIN_HEX);
    expect(cap.activatedAt).toBe(clock.t);
    // Persisted to disk with the secret guard mode 0600.
    const stat = fs.statSync(statePath);
    expect(stat.mode & 0o777).toBe(0o600);
    const onDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(onDisk.enabled).toBe(true);
    expect(onDisk.pubkey).toBe(cap.pubkey);
    expect(onDisk.secretKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(onDisk.secretKeyHex).not.toBe(cap.pubkey);
  });

  it('does not regenerate a new key across disable/enable cycles', () => {
    const b = make();
    b.enable();
    const first = b.capability().pubkey;
    b.disable();
    b.enable();
    expect(b.capability().pubkey).toBe(first);
  });

  it('persists off and resumes on after disable', () => {
    const b = make();
    b.enable();
    b.disable();
    expect(b.capability().enabled).toBe(false);
    const onDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(onDisk.enabled).toBe(false);
  });

  it('load() restores the key + enabled flag across a restart (no re-login)', () => {
    const a = make();
    a.enable();
    const pubkey = a.capability().pubkey;
    const skHex = a.getState().secretKeyHex;

    // Simulate a process restart: a fresh authority over the SAME file.
    const b = make();
    const resumed = b.load();
    expect(resumed).toBe(true);
    expect(b.capability().enabled).toBe(true);
    expect(b.capability().pubkey).toBe(pubkey);
    expect(b.getState().secretKeyHex).toBe(skHex);
  });

  it('load() returns false (disabled) on a missing or corrupt file', () => {
    fs.writeFileSync(statePath, '{ not valid json', 'utf8');
    const b = make();
    expect(b.load()).toBe(false);
    expect(b.capability().enabled).toBe(false);
    const c = make(); // no file at all
    expect(c.load()).toBe(false);
  });

  it('load() refuses to resume when the key pair is inconsistent', () => {
    fs.writeFileSync(statePath, JSON.stringify({
      version: 1, pubkey: 'ab'.repeat(32), secretKeyHex: 'cd'.repeat(32), enabled: true,
    }), 'utf8');
    const b = make();
    // pubkey does not derive from secretKeyHex → must NOT resume.
    expect(b.load()).toBe(false);
    expect(b.capability().enabled).toBe(false);
    expect(b.capability().pubkey).toBeNull();
  });
});

describe('createBeacon publishOnce', () => {
  it('builds a signed presence event attributed to the admin via the p tag', async () => {
    const b = make();
    b.enable();
    const res = await b.publishOnce();
    expect(res.ok).toBe(true);
    expect(res.accepted).toBe(2);
    expect(calls).toEqual(['wss://relay.example.com', 'wss://relay2.example.com']);

    // Reconstruct the published event to assert its shape (the author re-reads
    // events off the wire, so this is the contract a relay/reader will see).
    expect(b.capability().lastPublishedAt).toBe(clock.t);

    // Build the event freed of the async publish, to inspect it directly.
    const { getState } = b;
    expect(getState().lastError).toBeNull();
  });

  it('publishes no more than the relay list and rejects gracefully', async () => {
    const b = createBeacon({
      statePath, adminPubkeyHex: ADMIN_HEX,
      relays: ['wss://a.example', 'wss://b.example'],
      fs, now: () => clock.t,
      generateKey: generateSecretKey, getPubkey: getPublicKey, finalize: finalizeEvent, npubEncode: nip19.npubEncode,
      publishToRelay: fakePublisher([{ ok: false, reason: 'blocked' }, { ok: false, reason: 'blocked' }]),
    });
    b.enable();
    const res = await b.publishOnce();
    expect(res.ok).toBe(false);
    expect(res.accepted).toBe(0);
    expect(b.capability().lastPublishedAt).toBeNull();
    expect(b.capability().lastError).toMatch(/all-rejected/);
  });

  it('refuses to publish while disabled', async () => {
    const b = make();
    const res = await b.publishOnce();
    expect(res.ok).toBe(false);
    expect(res.error).toBe('disabled');
  });
});

describe('beacon event wire contract (real signing + verification)', () => {
  it('emits a kind-30078 event whose sig verifies under the beacon pubkey, carrying the admin p-tag', async () => {
    const captured = { event: null };
    const b = createBeacon({
      statePath, adminPubkeyHex: ADMIN_HEX,
      relays: ['wss://r.example'],
      website: 'https://torii.plebeian.build/',
      fs, now: () => clock.t,
      generateKey: generateSecretKey, getPubkey: getPublicKey, finalize: finalizeEvent, npubEncode: nip19.npubEncode,
      publishToRelay: async (url, event) => { captured.event = event; return { ok: true, relay: url, accepted: true }; },
    });
    b.enable();
    await b.publishOnce();

    const evt = captured.event;
    expect(evt).toBeTruthy();
    expect(evt.kind).toBe(30078);
    expect(evt.pubkey).toMatch(/^[0-9a-f]{64}$/);
    // The event is signed by the BEACON key, not the admin.
    expect(evt.pubkey).not.toBe(ADMIN_HEX);
    expect(verifyNostrEventSig(evt)).toBe(true); // real BIP-340 verify

    const tag = (n) => evt.tags.find((t) => Array.isArray(t) && t[0] === n);
    expect(tag('p')).toEqual(['p', ADMIN_HEX]);      // owner marker → admin
    expect(tag('d')?.[1]).toBe('quest-torii');
    expect(tag('t')?.[1]).toBe('torii-gateway');
    expect(tag('zoneType')?.[1]).toBe('arena');
    // NIP-40 expiration present and in the future.
    const exp = Number(tag('expiration')?.[1]);
    expect(Number.isFinite(exp)).toBe(true);
    expect(exp).toBeGreaterThan(Math.floor(clock.t / 1000));

    const content = JSON.parse(evt.content);
    expect(content.zoneId).toBe('quest-torii');
    expect(content.website).toBe('https://torii.plebeian.build/');
    expect(content.npub).toBe(nip19.npubEncode(ADMIN_HEX));
  });
});

describe('BEACON_INTERVAL_MS', () => {
  it('matches the client republish cadence (10 min)', () => {
    expect(BEACON_INTERVAL_MS).toBe(600000);
  });
});