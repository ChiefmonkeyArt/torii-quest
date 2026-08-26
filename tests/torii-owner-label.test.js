// tests/torii-owner-label.test.js
// Coverage for resolveToriiOwnerLabel() — the pure helper behind the
// homepage's "This torii belongs to: <label>" caption (v0.2.699-alpha).
import { describe, it, expect } from 'vitest';
import { resolveToriiOwnerLabel } from '../src/engine/identity/toriiOwnerLabel.js';

describe('resolveToriiOwnerLabel (v0.2.699-alpha)', () => {
  it('returns a neutral placeholder when the instance has no configured owner', () => {
    expect(resolveToriiOwnerLabel({})).toBe('not yet claimed');
    expect(resolveToriiOwnerLabel({ adminPubkey: null, viewerPubkey: 'abc' })).toBe('not yet claimed');
    expect(resolveToriiOwnerLabel({ adminPubkey: '' })).toBe('not yet claimed');
    expect(resolveToriiOwnerLabel()).toBe('not yet claimed');
  });

  it('shows a shortened owner npub when nobody is logged in', () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(resolveToriiOwnerLabel({ adminPubkey: owner })).toBe('a1b2c3…a1b2');
  });

  it('shows a shortened owner npub when a DIFFERENT viewer is logged in', () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const someoneElse = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    expect(resolveToriiOwnerLabel({ adminPubkey: owner, viewerPubkey: someoneElse })).toBe('a1b2c3…a1b2');
  });

  it("shows the owner's own displayName when the owner is the current viewer", () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(resolveToriiOwnerLabel({
      adminPubkey: owner,
      viewerPubkey: owner,
      profileDraft: { displayName: 'Chief Monkey', name: 'chiefmonkey' },
    })).toBe('Chief Monkey');
  });

  it('falls back to the draft "name" field when displayName is blank', () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(resolveToriiOwnerLabel({
      adminPubkey: owner,
      viewerPubkey: owner,
      profileDraft: { displayName: '   ', name: 'chiefmonkey' },
    })).toBe('chiefmonkey');
  });

  it('falls back to the shortened npub when the owner-viewer has no draft name at all', () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(resolveToriiOwnerLabel({ adminPubkey: owner, viewerPubkey: owner, profileDraft: {} }))
      .toBe('a1b2c3…a1b2');
    expect(resolveToriiOwnerLabel({ adminPubkey: owner, viewerPubkey: owner, profileDraft: null }))
      .toBe('a1b2c3…a1b2');
  });

  it('never throws on garbage input', () => {
    expect(() => resolveToriiOwnerLabel(undefined)).not.toThrow();
    expect(() => resolveToriiOwnerLabel({ adminPubkey: 123, viewerPubkey: {}, profileDraft: 'nope' })).not.toThrow();
  });

  // v0.2.705-alpha — ownerProfileName: the owner's PUBLISHED Nostr name, fetched
  // read-only by the caller and shown to EVERY visitor (not just the owner
  // viewing their own browser with a local draft).
  it("shows the owner's published Nostr name to a visitor who is NOT logged in", () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(resolveToriiOwnerLabel({ adminPubkey: owner, ownerProfileName: 'Chief Monkey' }))
      .toBe('Chief Monkey');
  });

  it("shows the owner's published Nostr name to a DIFFERENT logged-in visitor", () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const someoneElse = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    expect(resolveToriiOwnerLabel({
      adminPubkey: owner,
      viewerPubkey: someoneElse,
      ownerProfileName: 'Chief Monkey',
    })).toBe('Chief Monkey');
  });

  it('falls back to the shortened npub when ownerProfileName is blank/whitespace', () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(resolveToriiOwnerLabel({ adminPubkey: owner, ownerProfileName: '' })).toBe('a1b2c3…a1b2');
    expect(resolveToriiOwnerLabel({ adminPubkey: owner, ownerProfileName: '   ' })).toBe('a1b2c3…a1b2');
    expect(resolveToriiOwnerLabel({ adminPubkey: owner, ownerProfileName: null })).toBe('a1b2c3…a1b2');
  });

  it("prefers the owner-viewer's OWN local draft over ownerProfileName (unpublished edits win)", () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(resolveToriiOwnerLabel({
      adminPubkey: owner,
      viewerPubkey: owner,
      profileDraft: { displayName: 'Draft Name' },
      ownerProfileName: 'Published Name',
    })).toBe('Draft Name');
  });

  it('falls back to ownerProfileName when the owner is viewing but has no local draft name', () => {
    const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(resolveToriiOwnerLabel({
      adminPubkey: owner,
      viewerPubkey: owner,
      profileDraft: {},
      ownerProfileName: 'Published Name',
    })).toBe('Published Name');
  });
});
