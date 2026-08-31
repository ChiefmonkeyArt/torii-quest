// tests/character-event-build.test.js — locks buildCharacterEvent, the write
// half of the kind-35100 character event (the reverse of parseCharacterEvent).
// The key invariant: build→parse round-trips losslessly for every field the
// manifest carries.
import { describe, it, expect } from 'vitest';
import {
  buildCharacterEvent, parseCharacterEvent, CHARACTER_EVENT_KIND, CHARACTER_D_TAG,
} from '../src/engine/character/characterEvent.js';

const SHA = 'a'.repeat(64);

const fullManifest = {
  version: 1,
  mesh: { hash: SHA, name: 'chiefmonkey7.glb' },
  clips: [{ hash: 'b'.repeat(64), name: 'idle' }],
  stickers: [{ hash: 'c'.repeat(64), zoneId: 'chest', u: 0.5, v: 0.25, rot: 90 }],
  name: 'Chiefmonkey',
  colors: [{ slot: 'skin', hex: '#ff8800' }],
  contrib: [{ nappletDTag: 'mesh-gen', aggregateHash: 'd'.repeat(64), tags: ['meshy', 'v1'] }],
};

describe('buildCharacterEvent', () => {
  it('emits the d tag and kind', () => {
    const e = buildCharacterEvent(fullManifest, { pubkey: 'e'.repeat(64), createdAt: 1700000000 });
    expect(e.kind).toBe(CHARACTER_EVENT_KIND);
    expect(e.created_at).toBe(1700000000);
    expect(e.pubkey).toBe('e'.repeat(64));
    expect(e.tags[0]).toEqual(['d', CHARACTER_D_TAG]);
  });

  it('round-trips every field through parseCharacterEvent', () => {
    const e = buildCharacterEvent(fullManifest);
    const parsed = parseCharacterEvent(e);
    expect(parsed.valid).toBe(true);
    expect(parsed.manifest.mesh.hash).toBe(SHA);
    expect(parsed.manifest.mesh.name).toBe('chiefmonkey7.glb');
    expect(parsed.manifest.clips[0]).toEqual({ hash: 'b'.repeat(64), name: 'idle' });
    expect(parsed.manifest.stickers[0]).toEqual({ hash: 'c'.repeat(64), zoneId: 'chest', u: 0.5, v: 0.25, rot: 90 });
    expect(parsed.manifest.name).toBe('Chiefmonkey');
    expect(parsed.manifest.colors[0]).toEqual({ slot: 'skin', hex: '#ff8800' });
    expect(parsed.manifest.contrib[0].nappletDTag).toBe('mesh-gen');
    expect(parsed.manifest.contrib[0].tags).toEqual(['meshy', 'v1']);
  });

  it('defaults created_at to now and pubkey to empty', () => {
    const before = Math.floor(Date.now() / 1000);
    const e = buildCharacterEvent(fullManifest);
    expect(e.created_at).toBeGreaterThanOrEqual(before);
    expect(e.pubkey).toBe('');
  });

  it('skips empty/invalid optional fields without throwing', () => {
    const e = buildCharacterEvent({ version: 1, mesh: null, clips: [null], stickers: [{}], colors: [{}] });
    expect(e.tags).toEqual([['d', CHARACTER_D_TAG]]);
  });
});
