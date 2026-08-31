// tests/character-event.test.js — locks the kind-35100 character-event parser
// (src/engine/character/characterEvent.js): the "smooth experience" seam that
// reads a .glb already attached to an npub. Pure module → fully node-testable.
import { describe, it, expect } from 'vitest';
import {
  CHARACTER_EVENT_KIND, CHARACTER_D_TAG, parseCharacterEvent, hasCharacter,
} from '../src/engine/character/characterEvent.js';
import * as SDK from '../src/sdk/index.js';

const SHA = 'b'.repeat(64);

const characterEvent = () => ({
  kind: CHARACTER_EVENT_KIND,
  pubkey: 'abc123',
  tags: [
    ['d', CHARACTER_D_TAG],
    ['mesh', SHA, 'chiefmonkey6'],
    ['clip', SHA, 'Idle_02'],
    ['sticker', SHA, 'chest', '0.5', '0.5', '0'],
    ['name', 'Chiefmonkey'],
    ['color', 'primary', '#ff8800'],
    ['contrib', 'forge-v1', SHA, 'mesh'],
  ],
});

describe('parseCharacterEvent', () => {
  it('parses a full character event into a manifest', () => {
    const r = parseCharacterEvent(characterEvent());
    expect(r).not.toBe(null);
    expect(r.valid).toBe(true);
    expect(r.manifest.mesh.hash).toBe(SHA);
    expect(r.manifest.mesh.name).toBe('chiefmonkey6');
    expect(r.manifest.name).toBe('Chiefmonkey');
    expect(r.manifest.clips.length).toBe(1);
    expect(r.manifest.stickers[0].zoneId).toBe('chest');
    expect(r.manifest.stickers[0].u).toBe(0.5);
    expect(r.manifest.colors[0].hex).toBe('#ff8800');
    expect(r.manifest.contrib[0].nappletDTag).toBe('forge-v1');
    expect(r.pubkey).toBe('abc123');
  });

  it('returns null for a non-character kind', () => {
    expect(parseCharacterEvent({ kind: 0, tags: [['d', CHARACTER_D_TAG]] })).toBe(null);
  });

  it('returns null when the d tag is missing', () => {
    const e = characterEvent();
    e.tags = [['mesh', SHA, 'x']];
    expect(parseCharacterEvent(e)).toBe(null);
  });

  it('returns null for a non-object', () => {
    expect(parseCharacterEvent(null)).toBe(null);
    expect(parseCharacterEvent(undefined)).toBe(null);
  });

  it('flags an invalid manifest (no mesh) as invalid', () => {
    const e = characterEvent();
    e.tags = [['d', CHARACTER_D_TAG], ['name', 'just a name']];
    const r = parseCharacterEvent(e);
    expect(r).not.toBe(null);
    expect(r.valid).toBe(false);
  });
});

describe('hasCharacter', () => {
  it('is true only when a mesh hash is present', () => {
    expect(hasCharacter(characterEvent())).toBe(true);
    expect(hasCharacter({ kind: CHARACTER_EVENT_KIND, tags: [['d', CHARACTER_D_TAG]] })).toBe(false);
    expect(hasCharacter(null)).toBe(false);
  });
});

describe('SDK exposure', () => {
  it('re-exports characterEvent at the experimental tier', () => {
    expect(SDK.characterEvent.parseCharacterEvent).toBe(parseCharacterEvent);
    expect(SDK.SDK_SURFACE.characterEvent.tier).toBe('experimental');
  });
});
