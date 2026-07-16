// tests/gateway-sections.test.js — pure gateway-card partitioning (v0.2.403-alpha).
// The gateway card splits online worlds into "your friends" (mutual follows) and
// "arenas" (everything else, created_at DESC). These tests lock the pure classifier:
// partitioning, mutual detection (followed-but-not-mutual → arenas; mutual → friends;
// own world excluded), and the created_at-desc sort.
import { describe, it, expect } from 'vitest';
import {
  partitionGatewaySections, candidateFriendOwners, contactSetFromEvent,
  newestContactEvent, SECTION_ROW_CAP,
} from '../src/engine/gateway/gatewaySections.js';

const hex = (c) => c.repeat(64);
const USER = hex('1');
const ALICE = hex('a'); // mutual friend
const BOB = hex('b');   // user follows, but does NOT follow back
const CAROL = hex('c'); // stranger (no relation)

const world = (pubkey, created_at, extra = {}) => ({
  pubkey, created_at, zoneId: `z-${pubkey.slice(0, 4)}`,
  title: `world-${pubkey.slice(0, 4)}`, zoneType: 'arena', ...extra,
});
const kind3 = (author, follows, created_at = 100) => ({
  kind: 3, pubkey: author, created_at,
  tags: follows.map((p) => ['p', p]),
});

describe('gatewaySections — contactSetFromEvent', () => {
  it('extracts hex64 p-tags into a Set', () => {
    const set = contactSetFromEvent(kind3(USER, [ALICE, BOB]));
    expect(set.has(ALICE)).toBe(true);
    expect(set.has(BOB)).toBe(true);
    expect(set.size).toBe(2);
  });
  it('ignores malformed tags and non-events, never throws', () => {
    expect(contactSetFromEvent(null).size).toBe(0);
    expect(contactSetFromEvent({ tags: [['p', 'not-hex'], ['e', ALICE], ['p']] }).size).toBe(0);
  });
});

describe('gatewaySections — newestContactEvent', () => {
  it('returns the newest kind:3 for the author (replaceable event)', () => {
    const events = [kind3(USER, [ALICE], 100), kind3(USER, [ALICE, BOB], 200), kind3(BOB, [USER], 999)];
    const newest = newestContactEvent(events, USER);
    expect(newest.created_at).toBe(200);
    expect(contactSetFromEvent(newest).size).toBe(2);
  });
  it('returns null when no kind:3 for the author', () => {
    expect(newestContactEvent([kind3(BOB, [USER])], USER)).toBe(null);
    expect(newestContactEvent(null, USER)).toBe(null);
  });
});

describe('gatewaySections — candidateFriendOwners', () => {
  it('returns only followed, deduped, non-self world owners', () => {
    const worlds = [world(ALICE, 1), world(BOB, 2), world(CAROL, 3), world(ALICE, 4), world(USER, 5)];
    const userContacts = new Set([ALICE, BOB]); // user follows Alice + Bob, not Carol
    const out = candidateFriendOwners({ worlds, userContacts, userPubkey: USER });
    expect(out).toEqual([ALICE, BOB]); // Carol not followed; USER is self; Alice deduped
  });
  it('is empty when the user follows nobody', () => {
    const worlds = [world(ALICE, 1)];
    expect(candidateFriendOwners({ worlds, userContacts: new Set(), userPubkey: USER })).toEqual([]);
  });
});

describe('gatewaySections — partitionGatewaySections', () => {
  it('mutual follow → friends; followed-but-not-mutual + stranger → arenas', () => {
    const worlds = [world(ALICE, 10), world(BOB, 20), world(CAROL, 30)];
    const userContacts = new Set([ALICE, BOB]); // follows Alice + Bob
    const ownerContacts = new Map([
      [ALICE, new Set([USER])], // Alice follows back → mutual
      [BOB, new Set([CAROL])],  // Bob does NOT follow user back → arena
    ]);
    const { friends, arenas } = partitionGatewaySections({ worlds, userPubkey: USER, userContacts, ownerContacts });
    expect(friends.map((w) => w.pubkey)).toEqual([ALICE]);
    expect(arenas.map((w) => w.pubkey)).toEqual([CAROL, BOB]); // created_at DESC: 30, 20
  });

  it('excludes the user own world from both sections', () => {
    const worlds = [world(USER, 50), world(ALICE, 10)];
    const userContacts = new Set([USER, ALICE]); // even if self-followed
    const ownerContacts = new Map([[ALICE, new Set([USER])]]);
    const { friends, arenas } = partitionGatewaySections({ worlds, userPubkey: USER, userContacts, ownerContacts });
    const all = [...friends, ...arenas].map((w) => w.pubkey);
    expect(all).not.toContain(USER);
    expect(friends.map((w) => w.pubkey)).toEqual([ALICE]);
  });

  it('sorts each section by created_at DESC (latest signal first)', () => {
    const worlds = [world(CAROL, 5), world(hex('d'), 40), world(hex('e'), 25)];
    const { arenas } = partitionGatewaySections({ worlds, userPubkey: USER, userContacts: new Set(), ownerContacts: new Map() });
    expect(arenas.map((w) => w.created_at)).toEqual([40, 25, 5]);
  });

  it('logged out (no userPubkey): no friends, every world is an arena', () => {
    const worlds = [world(ALICE, 10), world(BOB, 20)];
    const { friends, arenas } = partitionGatewaySections({ worlds, userPubkey: '', userContacts: new Set(), ownerContacts: new Map() });
    expect(friends).toEqual([]);
    expect(arenas.map((w) => w.pubkey)).toEqual([BOB, ALICE]);
  });

  it('relay failure (empty ownerContacts): followed owner unconfirmed → arena, not friend', () => {
    const worlds = [world(ALICE, 10)];
    const userContacts = new Set([ALICE]);
    const { friends, arenas } = partitionGatewaySections({ worlds, userPubkey: USER, userContacts, ownerContacts: new Map() });
    expect(friends).toEqual([]);
    expect(arenas.map((w) => w.pubkey)).toEqual([ALICE]);
  });

  it('is safe on absent/garbage input', () => {
    expect(partitionGatewaySections()).toEqual({ friends: [], arenas: [] });
    expect(partitionGatewaySections({ worlds: null })).toEqual({ friends: [], arenas: [] });
  });

  it('exposes a positive row cap', () => {
    expect(Number.isInteger(SECTION_ROW_CAP)).toBe(true);
    expect(SECTION_ROW_CAP).toBeGreaterThan(0);
  });
});
