import { describe, it, expect, beforeEach } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  deriveWriteAuthorityInstanceId,
  resolveWriteAuthorityFacts,
  assertResolvedWriteAuthority,
} from '../../server/access/writeMutationGuard.js';
import {
  WRITE_POLICY_OWNER_ONLY,
  WRITE_POLICY_DELEGATES,
  WRITE_POLICY_FOLLOWS_WRITE,
} from '../../src/engine/gateway/writeAuthority.js';
import { nostrEventId } from '../../src/engine/crypto/nostrSig.js';
import { __resetAccessSettingsCache } from '../../src/nostr.js';
import { __resetFollowGraphCache } from '../../src/engine/gateway/handoffArrival.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARENA_WS_PATH = resolve(HERE, '../../server/arena-ws.js');
const OWNER_SK = hexToBytes('11'.repeat(32));
const VISITOR_SK = hexToBytes('22'.repeat(32));
const DELEGATE_SK = hexToBytes('33'.repeat(32));
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const VISITOR = bytesToHex(schnorr.getPublicKey(VISITOR_SK));
const DELEGATE = bytesToHex(schnorr.getPublicKey(DELEGATE_SK));
const INSTANCE_ID = 'torii.example/quest';
const RELAYS = ['wss://relay.one'];


function signEvent(unsigned, sk) {
  const event = { ...unsigned, pubkey: bytesToHex(schnorr.getPublicKey(sk)) };
  const id = nostrEventId(event);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...event, id, sig };
}

function signedAccessEvent(settings) {
  return signEvent({
    kind: 30078,
    created_at: 200,
    tags: [['d', `torii:quest:access:${INSTANCE_ID}`]],
    content: JSON.stringify({
      schemaVersion: 1,
      instanceId: INSTANCE_ID,
      ownerPubkey: OWNER,
      arrivalMode: 'public',
      followPolicy: 'visitor-follows-owner',
      writePolicy: settings.writePolicy,
      delegateSet: settings.delegateSet || [],
      updatedAt: '2026-07-16T12:00:00.000Z',
    }),
  }, OWNER_SK);
}

beforeEach(() => {
  __resetAccessSettingsCache();
  __resetFollowGraphCache();
});

function requestWithAccessSettings(settings, followResult = null) {
  return async (_relays, filters) => {
    if (Array.isArray(filters) && filters[0] && filters[0].kinds && filters[0].kinds.includes(30078)) {
      return {
        events: [signedAccessEvent(settings)],
        used: RELAYS,
        failed: [],
      };
    }
    if (Array.isArray(filters) && filters[0] && filters[0].kinds && filters[0].kinds.includes(3)) {
      if (followResult instanceof Error) throw followResult;
      const followedPubkeys = Array.isArray(followResult) ? followResult : [];
      return {
        events: [{
          kind: 3,
          pubkey: VISITOR,
          created_at: 201,
          tags: followedPubkeys.map((pubkey) => ['p', pubkey]),
          content: '',
          id: '3'.repeat(64),
          sig: '4'.repeat(128),
        }],
        used: RELAYS,
        failed: [],
      };
    }
    return { events: [], used: RELAYS, failed: [] };
  };
}

describe('deriveWriteAuthorityInstanceId', () => {
  it('prefers explicit env vars and otherwise derives host plus path from an origin', () => {
    expect(deriveWriteAuthorityInstanceId({ QUEST_INSTANCE_ID: INSTANCE_ID })).toBe(INSTANCE_ID);
    expect(deriveWriteAuthorityInstanceId({ PUBLIC_ORIGIN: 'https://torii.example/quest/' })).toBe('torii.example/quest');
    expect(deriveWriteAuthorityInstanceId({ PUBLIC_HOST: 'torii.example', BASE_PATH: '/quest/' })).toBe('torii.example/quest');
  });
});

describe('resolveWriteAuthorityFacts', () => {
  it('keeps owner-only as the effective default when settings cannot be read', async () => {
    const result = await resolveWriteAuthorityFacts({
      actorPubkey: VISITOR,
      ownerPubkey: OWNER,
      instanceId: INSTANCE_ID,
      relays: RELAYS,
      request: async () => { throw new Error('relay down'); },
    });
    expect(result.facts.writePolicy).toBe(WRITE_POLICY_OWNER_ONLY);
    expect(result.facts.followsOwner).toBe('unknown');
    expect(result.meta.accessSettingsError).toBe('access-settings-unavailable');
  });

  it('loads delegates and follows-write facts from verified relay data', async () => {
    const delegates = await resolveWriteAuthorityFacts({
      actorPubkey: VISITOR,
      ownerPubkey: OWNER,
      instanceId: INSTANCE_ID,
      relays: RELAYS,
      request: requestWithAccessSettings({ writePolicy: WRITE_POLICY_DELEGATES, delegateSet: [DELEGATE, VISITOR] }),
    });
    expect(delegates.facts.writePolicy).toBe(WRITE_POLICY_DELEGATES);
    expect([...delegates.facts.delegateSet]).toEqual([DELEGATE, VISITOR]);

    __resetAccessSettingsCache();
    __resetFollowGraphCache();
    const followsWrite = await resolveWriteAuthorityFacts({
      actorPubkey: VISITOR,
      ownerPubkey: OWNER,
      instanceId: INSTANCE_ID,
      relays: RELAYS,
      request: requestWithAccessSettings({ writePolicy: WRITE_POLICY_FOLLOWS_WRITE }, [OWNER]),
    });
    expect(followsWrite.facts.writePolicy).toBe(WRITE_POLICY_FOLLOWS_WRITE);
    expect(followsWrite.facts.followsOwner).toBe(true);
  });
});

describe('assertResolvedWriteAuthority', () => {
  it('the arena-ws MOVE mutation seam rejects an unauthorized visitor under owner-only', async () => {
    await expect(assertResolvedWriteAuthority({
      actorPubkey: VISITOR,
      ownerPubkey: OWNER,
      instanceId: INSTANCE_ID,
      relays: RELAYS,
      request: requestWithAccessSettings({ writePolicy: WRITE_POLICY_OWNER_ONLY }),
    })).rejects.toMatchObject({ code: 'WRITE_AUTHORITY_DENIED', reason: 'owner-only' });
  });

  it('the arena-ws SHOT mutation seam rejects an unauthorized non-delegate visitor', async () => {
    await expect(assertResolvedWriteAuthority({
      actorPubkey: VISITOR,
      ownerPubkey: OWNER,
      instanceId: INSTANCE_ID,
      relays: RELAYS,
      request: requestWithAccessSettings({ writePolicy: WRITE_POLICY_DELEGATES, delegateSet: [DELEGATE] }),
    })).rejects.toMatchObject({ code: 'WRITE_AUTHORITY_DENIED', reason: 'delegate-required' });
  });

  it('follows-write denies visitors when relay follow resolution fails', async () => {
    await expect(assertResolvedWriteAuthority({
      actorPubkey: VISITOR,
      ownerPubkey: OWNER,
      instanceId: INSTANCE_ID,
      relays: RELAYS,
      request: requestWithAccessSettings({ writePolicy: WRITE_POLICY_FOLLOWS_WRITE }, new Error('relay failed')),
    })).rejects.toMatchObject({ code: 'WRITE_AUTHORITY_DENIED', reason: 'follow-check-unavailable' });
  });
});

describe('arena-ws wiring', () => {
  it('guards the authoritative MOVE and SHOT handlers with assertSessionWriteAuthority', () => {
    const code = readFileSync(ARENA_WS_PATH, 'utf8');
    expect(code).toMatch(/case MSG\.MOVE:[\s\S]*assertSessionWriteAuthority\(sess, 'MOVE'\)/);
    expect(code).toMatch(/case MSG\.SHOT:[\s\S]*assertSessionWriteAuthority\(sess, 'SHOT'\)/);
  });
});
