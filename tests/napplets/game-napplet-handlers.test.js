// tests/napplets/game-napplet-handlers.test.js — nap-torii-game v0 dispatcher
// contract (ADR-0082). Pure — no DOM, no relays, no network.
import { describe, it, expect } from 'vitest';
import { createGameHandlers } from '../../src/engine/napplets/gameNappletHandlers.js';

function makeHandlers(overrides = {}) {
  return createGameHandlers(Object.assign({
    worldNpub: 'npub1shellhost',
    worldLabel: 'Cornish Torii',
    hostVersion: '0.1.0',
  }, overrides));
}

describe('game.host.info', () => {
  it('returns the shell identity + capability list', () => {
    const h = makeHandlers();
    const out = h.dispatch('game.host.info', {}, 'surf-a', 'r1');
    expect(out.type).toBe('game.host.info.result');
    expect(out.id).toBe('r1');
    expect(out.result.worldNpub).toBe('npub1shellhost');
    expect(out.result.worldLabel).toBe('Cornish Torii');
    expect(out.result.surfaceId).toBe('surf-a');
    expect(out.result.capabilities).toContain('game.event.publish');
  });
});

describe('namespace guard', () => {
  it('returns null for non-game namespaces (silently ignored)', () => {
    const h = makeHandlers();
    expect(h.dispatch('world.attach.get', {}, 'surf-a', 'r1')).toBeNull();
    expect(h.dispatch('avatar.get', {}, 'surf-a', 'r2')).toBeNull();
  });
  it('returns null for unknown game.* actions (forward-compat)', () => {
    const h = makeHandlers();
    expect(h.dispatch('game.does.not.exist', {}, 'surf-a', 'r3')).toBeNull();
  });
});

describe('game.player.get', () => {
  it('returns unsupported when no getPlayer callback is bound', () => {
    const h = makeHandlers();
    const out = h.dispatch('game.player.get', {}, 'surf-a', 'r1');
    expect(out.type).toBe('game.player.get.error');
    expect(out.error.code).toBe('unsupported');
  });
  it('returns the player identity when the callback resolves', () => {
    const h = makeHandlers({
      getPlayer: () => ({ pubkey: 'pk1', npub: 'npub1', display: 'chief' }),
    });
    const out = h.dispatch('game.player.get', {}, 'surf-a', 'r1');
    expect(out.result).toEqual({ pubkey: 'pk1', npub: 'npub1', display: 'chief' });
  });
  it('returns no-player when the callback yields null', () => {
    const h = makeHandlers({ getPlayer: () => null });
    const out = h.dispatch('game.player.get', {}, 'surf-a', 'r1');
    expect(out.type).toBe('game.player.get.error');
    expect(out.error.code).toBe('no-player');
  });
});

describe('game.player.subscribe / visit — deferred', () => {
  it('player.subscribe returns unsupported', () => {
    const h = makeHandlers();
    expect(h.dispatch('game.player.subscribe', {}, 'surf-a', 'r1').error.code).toBe('unsupported');
  });
  it('visit returns unsupported', () => {
    const h = makeHandlers();
    expect(h.dispatch('game.visit', { npub: 'npub2' }, 'surf-a', 'r1').error.code).toBe('unsupported');
  });
});

describe('game.event.publish', () => {
  it('rejects without an event', () => {
    const h = makeHandlers({ publishEvent: () => ({ id: 'e1', ok: true }) });
    const out = h.dispatch('game.event.publish', {}, 'surf-a', 'r1');
    expect(out.type).toBe('game.event.publish.error');
    expect(out.error.code).toBe('bad-request');
  });
  it('forwards to publishEvent and resolves async', async () => {
    const h = makeHandlers({
      publishEvent: (surfaceId, ev) => Promise.resolve({
        id: 'e1', ok: true, relays: ['wss://relay.a'],
      }),
    });
    const out = h.dispatch('game.event.publish', { event: { kind: 1, content: 'hi' } }, 'surf-a', 'r1');
    expect(out.__async).toBe(true);
    const env = await out.promise;
    expect(env.type).toBe('game.event.publish.result');
    expect(env.result).toEqual({ id: 'e1', ok: true, relays: ['wss://relay.a'] });
  });
  it('surfaces callback rejections as publish-failed', async () => {
    const h = makeHandlers({ publishEvent: () => Promise.reject(new Error('relay down')) });
    const out = h.dispatch('game.event.publish', { event: { kind: 1 } }, 'surf-a', 'r1');
    const env = await out.promise;
    expect(env.type).toBe('game.event.publish.error');
    expect(env.error.code).toBe('publish-failed');
  });
});

describe('game.event.subscribe / unsubscribe', () => {
  it('registers a subscription and can unsubscribe it', () => {
    let closed = false;
    const h = makeHandlers({
      subscribeEvents: () => ({ subscriptionId: 'sub1', close: () => { closed = true; } }),
    });
    const sub = h.dispatch('game.event.subscribe', { filter: { kinds: [1] } }, 'surf-a', 'r1');
    expect(sub.result.subscriptionId).toBe('sub1');
    const un = h.dispatch('game.event.unsubscribe', { subscriptionId: 'sub1' }, 'surf-a', 'r2');
    expect(un.result.ok).toBe(true);
    expect(closed).toBe(true);
  });
  it('unknown subscription is a clean error', () => {
    const h = makeHandlers({
      subscribeEvents: () => ({ subscriptionId: 'sub1', close: () => {} }),
    });
    const un = h.dispatch('game.event.unsubscribe', { subscriptionId: 'nope' }, 'surf-a', 'r1');
    expect(un.error.code).toBe('unknown-subscription');
  });
  it('scopes subscriptions per surface', () => {
    let closedA = false, closedB = false;
    const h = makeHandlers({
      subscribeEvents: (surf) => ({
        subscriptionId: 'sub-' + surf,
        close: () => { if (surf === 'a') closedA = true; else closedB = true; },
      }),
    });
    h.dispatch('game.event.subscribe', { filter: {} }, 'a', 'r1');
    h.dispatch('game.event.subscribe', { filter: {} }, 'b', 'r2');
    // Surface B trying to close A's subscription must fail.
    const cross = h.dispatch('game.event.unsubscribe', { subscriptionId: 'sub-a' }, 'b', 'r3');
    expect(cross.error.code).toBe('unknown-subscription');
    expect(closedA).toBe(false);
    // releaseSurface tears down its own scope only.
    h.releaseSurface('a');
    expect(closedA).toBe(true);
    expect(closedB).toBe(false);
  });
});

describe('game.exit', () => {
  it('calls exitGame and tears down subscriptions for the surface', () => {
    let exited = null, closed = false;
    const h = makeHandlers({
      subscribeEvents: () => ({ subscriptionId: 's1', close: () => { closed = true; } }),
      exitGame: (surf, reason) => { exited = { surf, reason }; return true; },
    });
    h.dispatch('game.event.subscribe', { filter: {} }, 'surf-a', 'r1');
    const out = h.dispatch('game.exit', { reason: 'user-quit' }, 'surf-a', 'r2');
    expect(out.result.ok).toBe(true);
    expect(exited).toEqual({ surf: 'surf-a', reason: 'user-quit' });
    expect(closed).toBe(true);
  });
  it('is safe with no exitGame callback bound', () => {
    const h = makeHandlers();
    const out = h.dispatch('game.exit', {}, 'surf-a', 'r1');
    expect(out.type).toBe('game.exit.result');
    expect(out.result.ok).toBe(true);
  });
});
