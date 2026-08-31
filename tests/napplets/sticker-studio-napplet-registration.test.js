// tests/napplets/sticker-studio-napplet-registration.test.js — sticker-studio-as-
// avatar-napplet wiring contract (ADR-0085). Pure — no Three, no relays.
import { describe, it, expect } from 'vitest';
import {
  createStickerStudioAvatarNappletRegistration,
  STICKER_STUDIO_NAPPLET_IDENTITY,
  REQUIRES_AVATAR_WRITE,
} from '../../src/engine/napplets/stickerStudioNappletRegistration.js';

function build(overrides = {}) {
  return createStickerStudioAvatarNappletRegistration(overrides);
}

describe('sticker studio napplet identity', () => {
  it('advertises a stable dTag + aggregateHash', () => {
    expect(STICKER_STUDIO_NAPPLET_IDENTITY.dTag).toBe('sticker-studio');
    expect(STICKER_STUDIO_NAPPLET_IDENTITY.aggregateHash).toMatch(/^sticker-studio@/);
  });
  it('declares the torii-avatar-write requires tag as a constant', () => {
    expect(REQUIRES_AVATAR_WRITE).toBe('torii-avatar-write');
  });
});

describe('avatar.get is bound to the live character view', () => {
  it('returns unsupported without a getCharacterView callback', () => {
    const reg = build();
    const out = reg.dispatch('avatar.get', {}, 'r1');
    expect(out.error.code).toBe('unsupported');
  });
  it('returns characterKey + contrib chain', () => {
    const reg = build({
      getCharacterView: () => ({
        characterKey: 'banker',
        contrib: [{ dTag: 'face-forge', aggregateHash: 'ff-v1' }],
      }),
    });
    const out = reg.dispatch('avatar.get', {}, 'r1');
    expect(out.result.characterKey).toBe('banker');
    expect(out.result.contrib).toEqual([{ dTag: 'face-forge', aggregateHash: 'ff-v1' }]);
  });
});

describe('avatar.propose — requires gate is enforced by the handlers', () => {
  it('the studio surface carries the torii-avatar-write requires tag', async () => {
    let seen = { patch: null, id: null };
    const reg = build({
      proposeCharacterPatch: (patch, id) => {
        seen = { patch, id };
        return Promise.resolve({ proposalId: 'p1', ok: true });
      },
    });
    const out = reg.dispatch('avatar.propose', { patch: { sticker: 'crown' } }, 'r1');
    expect(out.__async).toBe(true);
    const env = await out.promise;
    expect(env.type).toBe('avatar.propose.result');
    expect(env.result.ok).toBe(true);
    expect(seen.patch).toEqual({ sticker: 'crown' });
    // Contrib identity is stamped from the studio's own identity, not from the surface.
    expect(seen.id.dTag).toBe(STICKER_STUDIO_NAPPLET_IDENTITY.dTag);
    expect(seen.id.aggregateHash).toBe(STICKER_STUDIO_NAPPLET_IDENTITY.aggregateHash);
  });
  it('propose is unsupported when no proposeCharacterPatch is bound', () => {
    const reg = build();
    const out = reg.dispatch('avatar.propose', { patch: {} }, 'r1');
    expect(out.error.code).toBe('unsupported');
  });
  it('surfaces callback rejections as propose-failed', async () => {
    const reg = build({
      proposeCharacterPatch: () => Promise.reject(new Error('owner declined')),
    });
    const out = reg.dispatch('avatar.propose', { patch: {} }, 'r1');
    const env = await out.promise;
    expect(env.type).toBe('avatar.propose.error');
    expect(env.error.code).toBe('propose-failed');
  });
});

describe('avatar.revert — same requires gate applies', () => {
  it('rejects without a proposalId', () => {
    const reg = build({
      revertCharacterProposal: () => Promise.resolve({ ok: true }),
    });
    const out = reg.dispatch('avatar.revert', {}, 'r1');
    expect(out.error.code).toBe('bad-request');
  });
  it('rolls a proposal back when the callback resolves', async () => {
    let rolled = null;
    const reg = build({
      revertCharacterProposal: (pid) => { rolled = pid; return Promise.resolve({ ok: true }); },
    });
    const out = reg.dispatch('avatar.revert', { proposalId: 'p1' }, 'r1');
    const env = await out.promise;
    expect(env.result.ok).toBe(true);
    expect(rolled).toBe('p1');
  });
});

describe('avatar.subscribe scopes per surface', () => {
  it('opens and closes a subscription via the shell callback', () => {
    let closed = false;
    const reg = build({
      subscribeCharacterChanges: () => ({ subscriptionId: 'sub-1', close: () => { closed = true; } }),
    });
    const sub = reg.dispatch('avatar.subscribe', {}, 'r1');
    expect(sub.result.subscriptionId).toBe('sub-1');
    const un = reg.dispatch('avatar.unsubscribe', { subscriptionId: 'sub-1' }, 'r2');
    expect(un.result.ok).toBe(true);
    expect(closed).toBe(true);
  });
});
