// src/engine/menu/menuSections.test.js — locks the Phase 0c menu sub-partitioner
// (classifySections). Pure vitest: friends = mutual follows (from
// partitionGatewaySections); following = arenas the user follows but are not
// mutual; games = arenas with zoneType 'arena' or a game/experience topic;
// all = the remaining arenas, deduped. No three/DOM — importable in node.
import { describe, it, expect } from 'vitest';
import { classifySections } from './menuSections.js';

const ME = 'a'.repeat(64);
const FRIEND_OWNER = 'b'.repeat(64);   // mutual: I follow them, they follow me
const FOLLOWED_OWNER = 'c'.repeat(64); // I follow them, they do NOT follow me
const STRANGER_OWNER = 'd'.repeat(64); // I don't follow them

function world(pubkey, { zoneType = 'world', topics = [], zoneId = null, title = 'w', created_at = 1 } = {}) {
  return { pubkey, zoneType, topics, zoneId, title, created_at, shortPubkey: pubkey.slice(0, 8), website: 'https://x.example' };
}

const userContacts = new Set([FRIEND_OWNER, FOLLOWED_OWNER]);
// FRIEND_OWNER follows ME back (mutual); FOLLOWED_OWNER does not.
const ownerContacts = new Map([
  [FRIEND_OWNER, new Set([ME])],
  [FOLLOWED_OWNER, new Set(['e'.repeat(64)])],
]);

describe('classifySections — friends (mutuals)', () => {
  it('places a mutual-follow world in friends', () => {
    const worlds = [world(FRIEND_OWNER)];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.friends).toHaveLength(1);
    expect(r.friends[0].pubkey).toBe(FRIEND_OWNER);
  });

  it('excludes the user\'s own world from every section', () => {
    const worlds = [world(ME)];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.friends).toHaveLength(0);
    expect(r.following).toHaveLength(0);
    expect(r.games).toHaveLength(0);
    expect(r.all).toHaveLength(0);
  });
});

describe('classifySections — following (followed, not mutual)', () => {
  it('places a followed-but-not-mutual arena in following', () => {
    const worlds = [world(FOLLOWED_OWNER, { zoneType: 'world' })];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.following).toHaveLength(1);
    expect(r.following[0].pubkey).toBe(FOLLOWED_OWNER);
    // Not duplicated into games/all.
    expect(r.games).toHaveLength(0);
    expect(r.all).toHaveLength(0);
  });

  it('following is empty when logged out (no userPubkey)', () => {
    const worlds = [world(FOLLOWED_OWNER)];
    const r = classifySections({ worlds, userPubkey: '', userContacts: new Set(), ownerContacts: new Map() });
    expect(r.following).toHaveLength(0);
  });
});

describe('classifySections — games (zoneType arena or game topics)', () => {
  it('places an arena zoneType world in games', () => {
    const worlds = [world(STRANGER_OWNER, { zoneType: 'arena' })];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.games).toHaveLength(1);
    expect(r.all).toHaveLength(0);
  });

  it('places a world with a "game" topic in games', () => {
    const worlds = [world(STRANGER_OWNER, { zoneType: 'world', topics: ['torii-gateway', 'game'] })];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.games).toHaveLength(1);
  });

  it('places a world with an "experience" topic in games', () => {
    const worlds = [world(STRANGER_OWNER, { zoneType: 'world', topics: ['experience'] })];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.games).toHaveLength(1);
  });

  it('does NOT place a plain world (no arena zoneType, no game topic) in games', () => {
    const worlds = [world(STRANGER_OWNER, { zoneType: 'world', topics: ['torii-gateway'] })];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.games).toHaveLength(0);
    expect(r.all).toHaveLength(1);
  });
});

describe('classifySections — all (remaining, deduped)', () => {
  it('places a stranger non-game arena in all', () => {
    const worlds = [world(STRANGER_OWNER, { zoneType: 'world' })];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.all).toHaveLength(1);
    expect(r.all[0].pubkey).toBe(STRANGER_OWNER);
  });

  it('a world placed in following is NOT repeated in all', () => {
    const worlds = [world(FOLLOWED_OWNER, { zoneType: 'world' })];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.following).toHaveLength(1);
    expect(r.all).toHaveLength(0);
  });

  it('a world placed in games is NOT repeated in all', () => {
    const worlds = [world(STRANGER_OWNER, { zoneType: 'arena' })];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.games).toHaveLength(1);
    expect(r.all).toHaveLength(0);
  });
});

describe('classifySections — mixed + guards', () => {
  it('partitions a mixed world set across all four sections', () => {
    const worlds = [
      world(FRIEND_OWNER, { zoneType: 'arena', created_at: 4 }),       // friend (mutual) — also a game, but friends wins
      world(FOLLOWED_OWNER, { zoneType: 'world', created_at: 3 }),    // following
      world(STRANGER_OWNER, { zoneType: 'arena', created_at: 2 }),    // games
      world(STRANGER_OWNER, { zoneType: 'world', created_at: 1 }),    // all (different world object, same owner)
    ];
    const r = classifySections({ worlds, userPubkey: ME, userContacts, ownerContacts });
    expect(r.friends).toHaveLength(1);
    expect(r.following).toHaveLength(1);
    expect(r.games).toHaveLength(1);
    expect(r.all).toHaveLength(1);
  });

  it('never throws on garbage input', () => {
    expect(() => classifySections({})).not.toThrow();
    expect(() => classifySections({ worlds: null })).not.toThrow();
    expect(() => classifySections({ worlds: 'x', userContacts: null })).not.toThrow();
  });

  it('returns four empty arrays on no input', () => {
    const r = classifySections({});
    expect(r.friends).toEqual([]);
    expect(r.following).toEqual([]);
    expect(r.games).toEqual([]);
    expect(r.all).toEqual([]);
  });
});
