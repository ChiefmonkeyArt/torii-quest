import { describe, it, expect } from 'vitest';
import {
  WRITE_POLICY_OWNER_ONLY,
  WRITE_POLICY_DELEGATES,
  WRITE_POLICY_FOLLOWS_WRITE,
  decideWriteAuthority,
  assertWriteAuthority,
} from '../src/engine/gateway/writeAuthority.js';

const OWNER = 'a'.repeat(64);
const FOLLOWER = 'b'.repeat(64);
const DELEGATE = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);

function visitorBase(overrides = {}) {
  return {
    actorPubkey: OTHER,
    actorTrust: 'crypto-verified',
    ownerPubkey: OWNER,
    writePolicy: WRITE_POLICY_OWNER_ONLY,
    delegateSet: new Set(),
    followsOwner: false,
    ...overrides,
  };
}

describe('decideWriteAuthority', () => {
  it('owner-only allows the owner but denies follower delegate and anon visitors', () => {
    expect(decideWriteAuthority(visitorBase({ actorPubkey: OWNER }))).toEqual({ allowed: true, reason: 'owner' });
    expect(decideWriteAuthority(visitorBase({ actorTrust: 'owner-session', actorPubkey: '' }))).toEqual({ allowed: true, reason: 'owner-session' });
    expect(decideWriteAuthority(visitorBase({ actorPubkey: FOLLOWER }))).toEqual({ allowed: false, reason: 'owner-only' });
    expect(decideWriteAuthority(visitorBase({ actorPubkey: DELEGATE, delegateSet: new Set([DELEGATE]) }))).toEqual({ allowed: false, reason: 'owner-only' });
    expect(decideWriteAuthority(visitorBase({ actorTrust: 'anon', actorPubkey: '' }))).toEqual({ allowed: false, reason: 'anon-denied' });
  });

  it('delegates allows the owner and listed delegates but denies non-delegates', () => {
    expect(decideWriteAuthority(visitorBase({ writePolicy: WRITE_POLICY_DELEGATES, actorPubkey: OWNER }))).toEqual({ allowed: true, reason: 'owner' });
    expect(decideWriteAuthority(visitorBase({ writePolicy: WRITE_POLICY_DELEGATES, actorPubkey: DELEGATE, delegateSet: new Set([DELEGATE]) }))).toEqual({ allowed: true, reason: 'delegate' });
    expect(decideWriteAuthority(visitorBase({ writePolicy: WRITE_POLICY_DELEGATES, actorPubkey: OTHER, delegateSet: new Set([DELEGATE]) }))).toEqual({ allowed: false, reason: 'delegate-required' });
  });

  it('follows-write allows a verified follower but denies non-followers and anon visitors', () => {
    expect(decideWriteAuthority(visitorBase({ writePolicy: WRITE_POLICY_FOLLOWS_WRITE, actorPubkey: FOLLOWER, followsOwner: true }))).toEqual({ allowed: true, reason: 'follows-owner' });
    expect(decideWriteAuthority(visitorBase({ writePolicy: WRITE_POLICY_FOLLOWS_WRITE, actorPubkey: OTHER, followsOwner: false }))).toEqual({ allowed: false, reason: 'follow-required' });
    expect(decideWriteAuthority(visitorBase({ writePolicy: WRITE_POLICY_FOLLOWS_WRITE, actorTrust: 'anon', actorPubkey: '', followsOwner: true }))).toEqual({ allowed: false, reason: 'anon-denied' });
  });

  it('follows-write denies visitor writes when follow resolution is unavailable', () => {
    expect(decideWriteAuthority(visitorBase({ writePolicy: WRITE_POLICY_FOLLOWS_WRITE, followsOwner: 'unknown' }))).toEqual({ allowed: false, reason: 'follow-check-unavailable' });
  });

  it('missing delegate sets fail closed to owner-only behaviour for visitor writes', () => {
    expect(decideWriteAuthority(visitorBase({ writePolicy: WRITE_POLICY_DELEGATES, delegateSet: null }))).toEqual({ allowed: false, reason: 'delegate-set-missing' });
  });

  it('unknown missing malformed and open write policies fail closed to owner-only', () => {
    for (const writePolicy of [undefined, null, '', 'open', 'unsupported', 42]) {
      expect(decideWriteAuthority(visitorBase({ writePolicy }))).toEqual({ allowed: false, reason: 'owner-only' });
    }
  });
});

describe('assertWriteAuthority', () => {
  it('throws a tagged error when a visitor write is denied', () => {
    expect(() => assertWriteAuthority(visitorBase())).toThrowError(/write authority denied: owner-only/);
    try {
      assertWriteAuthority(visitorBase());
    } catch (error) {
      expect(error.code).toBe('WRITE_AUTHORITY_DENIED');
      expect(error.reason).toBe('owner-only');
      expect(error.verdict).toEqual({ allowed: false, reason: 'owner-only' });
    }
  });
});
