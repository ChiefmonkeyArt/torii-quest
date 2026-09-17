// world-directory-label.test.js — the world directory row is labelled by the OWNER'S
// display name, not the app `title` (\"Torii Quest\" is identical across every resident,
// so a title-first label renders every card the same). Locks worldDirectoryLabel.
import { describe, it, expect } from 'vitest';
import { worldDirectoryLabel } from '../src/engine/gateway/gatewayRead.js';

describe('worldDirectoryLabel', () => {
  it('prefers the owner display name over the app title', () => {
    expect(worldDirectoryLabel({ displayName: 'Bekka', title: 'Torii Quest', zoneId: 'cm' })).toBe('Bekka');
  });

  it('prefers the owner short pubkey over the generic app title (label fallback)', () => {
    // A fresh operator with no displayName yet must NOT render as "Torii Quest"
    // (the app name). Their unique identity (shortPubkey) wins over the title.
    expect(worldDirectoryLabel({ title: 'Torii Quest', shortPubkey: 'npub1abc', zoneId: 'z1' })).toBe('npub1abc');
  });

  it('falls back to short pubkey, then title, then zone id, then plain word', () => {
    expect(worldDirectoryLabel({ shortPubkey: 'npub1abc', zoneId: 'z1' })).toBe('npub1abc');
    expect(worldDirectoryLabel({ title: 'The Nap Garden', zoneId: 'nap' })).toBe('The Nap Garden');
    expect(worldDirectoryLabel({ zoneId: 'z1' })).toBe('z1');
    expect(worldDirectoryLabel({})).toBe('world');
    expect(worldDirectoryLabel(null)).toBe('world');
  });

  it('ignores a blank display name (falls through to the identity, not the title)', () => {
    expect(worldDirectoryLabel({ displayName: '', shortPubkey: 'npub1abc', title: 'Torii Quest' })).toBe('npub1abc');
  });
});