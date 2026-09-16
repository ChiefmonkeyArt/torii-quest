// world-directory-label.test.js — the world directory row is labelled by the OWNER'S
// display name, not the app `title` (\"Torii Quest\" is identical across every resident,
// so a title-first label renders every card the same). Locks worldDirectoryLabel.
import { describe, it, expect } from 'vitest';
import { worldDirectoryLabel } from '../src/engine/gateway/gatewayRead.js';

describe('worldDirectoryLabel', () => {
  it('prefers the owner display name over the app title', () => {
    expect(worldDirectoryLabel({ displayName: 'Bekka', title: 'Torii Quest', zoneId: 'cm' })).toBe('Bekka');
  });

  it('falls back to title, then short pubkey, then zone id, then plain word', () => {
    expect(worldDirectoryLabel({ title: 'Torii Quest', shortPubkey: 'npub1abc', zoneId: 'z1' })).toBe('Torii Quest');
    expect(worldDirectoryLabel({ shortPubkey: 'npub1abc', zoneId: 'z1' })).toBe('npub1abc');
    expect(worldDirectoryLabel({ zoneId: 'z1' })).toBe('z1');
    expect(worldDirectoryLabel({})).toBe('world');
    expect(worldDirectoryLabel(null)).toBe('world');
  });

  it('ignores a blank display name (falls through to title)', () => {
    expect(worldDirectoryLabel({ displayName: '', title: 'Torii Quest' })).toBe('Torii Quest');
  });
});