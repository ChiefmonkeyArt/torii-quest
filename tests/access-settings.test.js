import { describe, it, expect, beforeEach } from 'vitest';
import {
  ACCESS_SETTINGS_KIND,
  ACCESS_SETTINGS_SCHEMA_VERSION,
  buildAccessSettingsDTag,
  parseAccessSettingsContent,
  verifyAccessSettingsEvent,
  readLatestAccessSettings,
  publishAccessSettings,
  __resetAccessSettingsCache,
} from '../src/nostr.js';
import { nostrEventId } from '../src/engine/crypto/nostrSig.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

const OWNER_SK = hexToBytes('11'.repeat(32));
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const OTHER_SK = hexToBytes('22'.repeat(32));
const OTHER = bytesToHex(schnorr.getPublicKey(OTHER_SK));
const RELAYS = ['wss://relay.one', 'wss://relay.two'];
const INSTANCE_ID = 'host-b.example.com/quest';

function signEvent(unsigned, sk = OWNER_SK) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const event = { ...unsigned, pubkey };
  const id = nostrEventId(event);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...event, id, sig };
}

function accessEvent({
  sk = OWNER_SK,
  instanceId = INSTANCE_ID,
  ownerPubkey = OWNER,
  arrivalMode = 'public',
  followPolicy = 'visitor-follows-owner',
  createdAt = 100,
  updatedAt = '2026-07-16T12:00:00.000Z',
  dTag = buildAccessSettingsDTag(instanceId),
} = {}) {
  return signEvent({
    kind: ACCESS_SETTINGS_KIND,
    created_at: createdAt,
    tags: [['d', dTag]],
    content: JSON.stringify({
      schemaVersion: ACCESS_SETTINGS_SCHEMA_VERSION,
      instanceId,
      ownerPubkey,
      arrivalMode,
      followPolicy,
      updatedAt,
    }),
  }, sk);
}

beforeEach(() => {
  __resetAccessSettingsCache();
});

describe('access settings content + event verification', () => {
  it('parses the schema-versioned JSON payload', () => {
    const parsed = parseAccessSettingsContent(JSON.stringify({
      schemaVersion: ACCESS_SETTINGS_SCHEMA_VERSION,
      instanceId: INSTANCE_ID,
      ownerPubkey: OWNER,
      arrivalMode: 'follows-only',
      followPolicy: 'visitor-follows-owner',
      updatedAt: '2026-07-16T12:00:00.000Z',
    }));
    expect(parsed.ok).toBe(true);
    expect(parsed.settings.arrivalMode).toBe('follows-only');
    expect(parsed.settings.ownerPubkey).toBe(OWNER);
  });

  it('verifies owner pubkey, exact d-tag, id binding, and signature', () => {
    const event = accessEvent({ arrivalMode: 'follows-only', createdAt: 200 });
    const verified = verifyAccessSettingsEvent(event, { instanceId: INSTANCE_ID, ownerPubkey: OWNER });
    expect(verified.ok).toBe(true);
    expect(verified.settings.arrivalMode).toBe('follows-only');
    expect(verified.settings.dTag).toBe(buildAccessSettingsDTag(INSTANCE_ID));
  });
});

describe('readLatestAccessSettings', () => {
  it('chooses the latest valid owner event', async () => {
    const request = async () => ({
      events: [
        accessEvent({ arrivalMode: 'public', createdAt: 100, updatedAt: '2026-07-16T12:00:00.000Z' }),
        accessEvent({ arrivalMode: 'follows-only', createdAt: 200, updatedAt: '2026-07-16T12:05:00.000Z' }),
      ],
      used: RELAYS,
      failed: [],
    });
    const result = await readLatestAccessSettings({ request, relays: RELAYS, instanceId: INSTANCE_ID, ownerPubkey: OWNER });
    expect(result.ok).toBe(true);
    expect(result.settings.arrivalMode).toBe('follows-only');
    expect(result.settings.createdAt).toBe(200);
  });

  it('ignores an invalid tampered newest event and keeps the older valid restricted setting', async () => {
    const validOld = accessEvent({ arrivalMode: 'follows-only', createdAt: 150 });
    const tamperedNewest = { ...accessEvent({ arrivalMode: 'public', createdAt: 250 }), content: JSON.stringify({ nope: true }) };
    const request = async () => ({ events: [tamperedNewest, validOld], used: RELAYS, failed: [] });
    const result = await readLatestAccessSettings({ request, relays: RELAYS, instanceId: INSTANCE_ID, ownerPubkey: OWNER });
    expect(result.ok).toBe(true);
    expect(result.settings.arrivalMode).toBe('follows-only');
    expect(result.settings.createdAt).toBe(150);
  });

  it('ignores unsigned, wrong-owner, bad-d, and malformed events', async () => {
    const unsigned = {
      kind: ACCESS_SETTINGS_KIND,
      pubkey: OWNER,
      created_at: 300,
      tags: [['d', buildAccessSettingsDTag(INSTANCE_ID)]],
      content: JSON.stringify({
        schemaVersion: ACCESS_SETTINGS_SCHEMA_VERSION,
        instanceId: INSTANCE_ID,
        ownerPubkey: OWNER,
        arrivalMode: 'public',
        followPolicy: 'visitor-follows-owner',
        updatedAt: '2026-07-16T12:06:00.000Z',
      }),
      id: 'a'.repeat(64),
      sig: 'b'.repeat(128),
    };
    const wrongOwner = accessEvent({ sk: OTHER_SK, ownerPubkey: OTHER, createdAt: 301 });
    const badD = accessEvent({ dTag: 'torii:quest:access:someone-else', createdAt: 302 });
    const malformed = accessEvent({ createdAt: 303, updatedAt: '' });
    const request = async () => ({ events: [unsigned, wrongOwner, badD, malformed], used: RELAYS, failed: [] });
    const result = await readLatestAccessSettings({ request, relays: RELAYS, instanceId: INSTANCE_ID, ownerPubkey: OWNER });
    expect(result.ok).toBe(true);
    expect(result.settings).toBe(null);
  });

  it('returns a cached valid mode on relay error, otherwise reports unavailable', async () => {
    let calls = 0;
    const warmRequest = async () => {
      calls++;
      return { events: [accessEvent({ arrivalMode: 'follows-only', createdAt: 400 })], used: RELAYS, failed: [] };
    };
    const warm = await readLatestAccessSettings({
      request: warmRequest,
      relays: RELAYS,
      instanceId: INSTANCE_ID,
      ownerPubkey: OWNER,
      nowMs: 100,
      cacheTtlMs: 10,
    });
    expect(warm.ok).toBe(true);
    expect(warm.settings.arrivalMode).toBe('follows-only');
    const staleCached = await readLatestAccessSettings({
      request: async () => { throw new Error('timeout'); },
      relays: RELAYS,
      instanceId: INSTANCE_ID,
      ownerPubkey: OWNER,
      nowMs: 1000,
      cacheTtlMs: 10,
    });
    expect(staleCached.ok).toBe(true);
    expect(staleCached.cached).toBe(true);
    expect(staleCached.stale).toBe(true);
    expect(staleCached.settings.arrivalMode).toBe('follows-only');
    expect(calls).toBe(1);

    __resetAccessSettingsCache();
    const cold = await readLatestAccessSettings({
      request: async () => { throw new Error('timeout'); },
      relays: RELAYS,
      instanceId: INSTANCE_ID,
      ownerPubkey: OWNER,
    });
    expect(cold.ok).toBe(false);
    expect(cold.settings).toBe(null);
    expect(cold.error).toBe('access-settings-unavailable');
  });
});

describe('publishAccessSettings', () => {
  it('signs and publishes only editable public/follows-only modes', async () => {
    const result = await publishAccessSettings({
      instanceId: INSTANCE_ID,
      ownerPubkey: OWNER,
      arrivalMode: 'follows-only',
      relays: RELAYS,
      sign: async (unsigned) => ({ ok: true, event: signEvent(unsigned) }),
      publish: async (_relays, event) => ({ accepted: 2, used: _relays, failed: event ? [] : _relays }),
    });
    expect(result.ok).toBe(true);
    expect(result.accepted).toBe(2);
    expect(result.settings.arrivalMode).toBe('follows-only');

    const blocked = await publishAccessSettings({
      instanceId: INSTANCE_ID,
      ownerPubkey: OWNER,
      arrivalMode: 'whitelist',
      relays: RELAYS,
      sign: async () => ({ ok: true, event: null }),
      publish: async () => ({ accepted: 0, used: [], failed: RELAYS }),
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('access-settings-mode-not-editable');
  });
});
