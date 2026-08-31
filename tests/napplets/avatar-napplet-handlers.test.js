// tests/napplets/avatar-napplet-handlers.test.js — nap-torii-avatar v0 dispatcher
// contract (ADR-0083). Pure — no DOM, no relays, no signing.
import { describe, it, expect } from 'vitest';
import { createAvatarHandlers } from '../../src/engine/napplets/avatarNappletHandlers.js';

function makeHandlers(overrides = {}) {
  return createAvatarHandlers(Object.assign({}, overrides));
}

describe('namespace guard', () => {
  it('returns null for non-avatar namespaces', () => {
    const h = makeHandlers();
    expect(h.dispatch('world.attach.get', {}, 'surf-a', 'r1')).toBeNull();
    expect(h.dispatch('game.host.info', {}, 'surf-a', 'r2')).toBeNull();
  });
});

describe('avatar.get', () => {
  it('returns unsupported when no getCharacter is bound', () => {
    const h = makeHandlers();
    const out = h.dispatch('avatar.get', {}, 'surf-a', 'r1');
    expect(out.type).toBe('avatar.get.error');
    expect(out.error.code).toBe('unsupported');
  });
  it('returns the character view + contrib chain', () => {
    const h = makeHandlers({
      getCharacter: () => ({
        characterKey: 'banker',
        contrib: [{ dTag: 'face-forge', aggregateHash: 'hash-a' }],
      }),
    });
    const out = h.dispatch('avatar.get', {}, 'surf-a', 'r1');
    expect(out.result.characterKey).toBe('banker');
    expect(out.result.contrib).toEqual([{ dTag: 'face-forge', aggregateHash: 'hash-a' }]);
  });
  it('returns no-character when the callback yields null', () => {
    const h = makeHandlers({ getCharacter: () => null });
    const out = h.dispatch('avatar.get', {}, 'surf-a', 'r1');
    expect(out.error.code).toBe('no-character');
  });
});

describe('avatar.propose — requires-tag gating', () => {
  it('is unsupported without the torii-avatar-write requires tag', () => {
    const h = makeHandlers({
      getSurfaceConfig: () => ({ requires: [] }),
      proposeCharacterChange: () => ({ proposalId: 'p1', ok: true }),
    });
    const out = h.dispatch('avatar.propose', { patch: { characterKey: 'ninja' } }, 'surf-a', 'r1');
    expect(out.type).toBe('avatar.propose.error');
    expect(out.error.code).toBe('unsupported');
  });
  it('dispatches to proposeCharacterChange when requires tag is present', async () => {
    const seen = { patch: null, identity: null };
    const h = makeHandlers({
      getSurfaceConfig: () => ({ requires: ['torii-avatar-write'] }),
      proposeCharacterChange: (surf, patch, id) => {
        seen.patch = patch; seen.identity = id;
        return Promise.resolve({ proposalId: 'p1', ok: true });
      },
    });
    const out = h.dispatch(
      'avatar.propose',
      { patch: { characterKey: 'ninja' } },
      'surf-a', 'r1',
      { dTag: 'sticker-studio', aggregateHash: 'ss-v1' },
    );
    expect(out.__async).toBe(true);
    const env = await out.promise;
    expect(env.type).toBe('avatar.propose.result');
    expect(env.result.proposalId).toBe('p1');
    expect(env.result.ok).toBe(true);
    expect(seen.patch).toEqual({ characterKey: 'ninja' });
    expect(seen.identity.dTag).toBe('sticker-studio');
  });
  it('rejects without a patch', () => {
    const h = makeHandlers({
      getSurfaceConfig: () => ({ requires: ['torii-avatar-write'] }),
      proposeCharacterChange: () => ({ ok: true }),
    });
    const out = h.dispatch('avatar.propose', {}, 'surf-a', 'r1');
    expect(out.type).toBe('avatar.propose.error');
    expect(out.error.code).toBe('bad-request');
  });
  it('surfaces callback rejections as propose-failed', async () => {
    const h = makeHandlers({
      getSurfaceConfig: () => ({ requires: ['torii-avatar-write'] }),
      proposeCharacterChange: () => Promise.reject(new Error('denied by owner')),
    });
    const out = h.dispatch('avatar.propose', { patch: {} }, 'surf-a', 'r1');
    const env = await out.promise;
    expect(env.type).toBe('avatar.propose.error');
    expect(env.error.code).toBe('propose-failed');
  });
});

describe('avatar.subscribe / unsubscribe', () => {
  it('registers a subscription and can unsubscribe it', () => {
    let closed = false;
    const h = makeHandlers({
      subscribeCharacter: () => ({ subscriptionId: 'sub1', close: () => { closed = true; } }),
    });
    const sub = h.dispatch('avatar.subscribe', {}, 'surf-a', 'r1');
    expect(sub.result.subscriptionId).toBe('sub1');
    const un = h.dispatch('avatar.unsubscribe', { subscriptionId: 'sub1' }, 'surf-a', 'r2');
    expect(un.result.ok).toBe(true);
    expect(closed).toBe(true);
  });
  it('scopes subscription ids per surface', () => {
    let closedA = false;
    const h = makeHandlers({
      subscribeCharacter: (surf) => ({
        subscriptionId: 'sub-' + surf,
        close: () => { if (surf === 'a') closedA = true; },
      }),
    });
    h.dispatch('avatar.subscribe', {}, 'a', 'r1');
    h.dispatch('avatar.subscribe', {}, 'b', 'r2');
    const cross = h.dispatch('avatar.unsubscribe', { subscriptionId: 'sub-a' }, 'b', 'r3');
    expect(cross.error.code).toBe('unknown-subscription');
    expect(closedA).toBe(false);
    h.releaseSurface('a');
    expect(closedA).toBe(true);
  });
});

describe('avatar.revert — requires-tag gating', () => {
  it('is unsupported without torii-avatar-write', () => {
    const h = makeHandlers({
      getSurfaceConfig: () => ({ requires: [] }),
      revertProposal: () => ({ ok: true }),
    });
    const out = h.dispatch('avatar.revert', { proposalId: 'p1' }, 'surf-a', 'r1');
    expect(out.error.code).toBe('unsupported');
  });
  it('rejects without a proposalId', () => {
    const h = makeHandlers({
      getSurfaceConfig: () => ({ requires: ['torii-avatar-write'] }),
      revertProposal: () => ({ ok: true }),
    });
    const out = h.dispatch('avatar.revert', {}, 'surf-a', 'r1');
    expect(out.error.code).toBe('bad-request');
  });
  it('dispatches to revertProposal when requires tag is present', async () => {
    const h = makeHandlers({
      getSurfaceConfig: () => ({ requires: ['torii-avatar-write'] }),
      revertProposal: () => Promise.resolve({ ok: true }),
    });
    const out = h.dispatch('avatar.revert', { proposalId: 'p1' }, 'surf-a', 'r1');
    const env = await out.promise;
    expect(env.type).toBe('avatar.revert.result');
    expect(env.result.ok).toBe(true);
  });
});
