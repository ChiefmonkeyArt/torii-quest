// tests/character-relay-read.test.js — locks the kind-35100 character relay-read
// module (src/engine/character/characterRelayRead.js): the filter builder, the
// read/reduce report, newest-per-author selection, and the findCharacterFor
// helper. Pure module → fully node-testable, no relay/socket needed.
import { describe, it, expect } from 'vitest';
import {
  buildCharacterFilter, readCharacters, findCharacterFor,
} from '../src/engine/character/characterRelayRead.js';
import { CHARACTER_EVENT_KIND, CHARACTER_D_TAG } from '../src/engine/character/characterEvent.js';
import * as SDK from '../src/sdk/index.js';

const SHA = 'a'.repeat(64);
const PK = 'b'.repeat(64);

const characterEvent = (createdAt = 1700000000) => ({
  id: 'c'.repeat(64),
  pubkey: PK,
  created_at: createdAt,
  kind: CHARACTER_EVENT_KIND,
  tags: [
    ['d', CHARACTER_D_TAG],
    ['mesh', SHA, 'chiefmonkey6'],
    ['name', 'Chiefmonkey'],
    ['sticker', SHA, 'chest', '0.5', '0.5', '0'],
  ],
  content: '',
  sig: null,
});

describe('buildCharacterFilter', () => {
  it('builds a kind-35100 + d-tag filter', () => {
    const f = buildCharacterFilter();
    expect(f.kinds).toEqual([CHARACTER_EVENT_KIND]);
    expect(f['#d']).toEqual([CHARACTER_D_TAG]);
  });

  it('includes authors/since/until/limit only when well-formed', () => {
    const f = buildCharacterFilter({ authors: [PK, ''], since: 1, until: 2, limit: 5 });
    expect(f.authors).toEqual([PK]);
    expect(f.since).toBe(1);
    expect(f.until).toBe(2);
    expect(f.limit).toBe(5);
    const g = buildCharacterFilter({ authors: 'nope', since: 'x', limit: -1 });
    expect(g.authors).toBeUndefined();
    expect(g.since).toBeUndefined();
    expect(g.limit).toBeUndefined();
  });
});

describe('readCharacters', () => {
  it('reads a valid character event into a report', () => {
    const r = readCharacters([characterEvent()]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
    expect(r.characters[0].pubkey).toBe(PK);
    expect(r.characters[0].valid).toBe(true);
    expect(r.characters[0].manifest.mesh.name).toBe('chiefmonkey6');
    expect(r.readOnly).toBe(true);
    expect(r.signed).toBe(false);
  });

  it('selects the newest character per author and counts duplicates', () => {
    const r = readCharacters([characterEvent(100), characterEvent(200)]);
    expect(r.count).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.characters[0].created_at).toBe(200);
  });

  it('skips non-character events', () => {
    const r = readCharacters([{ ...characterEvent(), kind: 0 }]);
    expect(r.count).toBe(0);
    expect(r.skipped.length).toBe(1);
  });

  it('keeps a parsed-but-invalid character with valid:false', () => {
    const bad = characterEvent();
    bad.tags = [['d', CHARACTER_D_TAG], ['name', 'no mesh']];
    const r = readCharacters([bad]);
    expect(r.count).toBe(1);
    expect(r.characters[0].valid).toBe(false);
  });

  it('degrades to ok:false on an unusable input shape', () => {
    const r = readCharacters(null);
    expect(r.ok).toBe(false);
    expect(r.count).toBe(0);
  });

  it('accepts a relayRead { events } result shape', () => {
    const r = readCharacters({ events: [characterEvent()] });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });
});

describe('findCharacterFor', () => {
  it('finds a character by pubkey', () => {
    const r = readCharacters([characterEvent()]);
    expect(findCharacterFor(r, PK).manifest.mesh.name).toBe('chiefmonkey6');
    expect(findCharacterFor(r, 'd'.repeat(64))).toBe(null);
    expect(findCharacterFor(r, '')).toBe(null);
  });
});

describe('SDK exposure', () => {
  it('re-exports characterRelayRead at the experimental tier', () => {
    expect(SDK.characterRelayRead.readCharacters).toBe(readCharacters);
    expect(SDK.SDK_SURFACE.characterRelayRead.tier).toBe('experimental');
  });
});
