// tests/napplets/arena-napplet-registration.test.js — arena-as-game-napplet
// wiring contract (ADR-0084). Pure — no Three, no relays.
import { describe, it, expect } from 'vitest';
import {
  createArenaGameNappletRegistration,
  ARENA_NAPPLET_IDENTITY,
} from '../../src/engine/napplets/arenaNappletRegistration.js';

function build(overrides = {}) {
  return createArenaGameNappletRegistration(Object.assign({
    worldNpub: 'npub1shellhost',
    worldLabel: 'Cornish Torii',
  }, overrides));
}

describe('arena napplet identity', () => {
  it('advertises a stable dTag + aggregateHash', () => {
    expect(ARENA_NAPPLET_IDENTITY.dTag).toBe('torii-arena');
    expect(ARENA_NAPPLET_IDENTITY.aggregateHash).toMatch(/^torii-arena@/);
  });
  it('requires a worldNpub', () => {
    expect(() => createArenaGameNappletRegistration({})).toThrow(/worldNpub/);
  });
});

describe('game.host.info under the arena registration', () => {
  it('carries the arena surfaceId and the shell world identity', () => {
    const reg = build();
    const out = reg.dispatch('game.host.info', {}, 'r1');
    expect(out.type).toBe('game.host.info.result');
    expect(out.result.surfaceId).toBe('arena-local');
    expect(out.result.worldNpub).toBe('npub1shellhost');
    expect(out.result.worldLabel).toBe('Cornish Torii');
    expect(out.result.capabilities).toContain('game.event.publish');
  });
});

describe('player.get is bound to the local player', () => {
  it('returns unsupported without a getLocalPlayer callback', () => {
    const reg = build();
    const out = reg.dispatch('game.player.get', {}, 'r1');
    expect(out.error.code).toBe('unsupported');
  });
  it('returns the live pubkey/character', () => {
    const reg = build({
      getLocalPlayer: () => ({ pubkey: 'pk', npub: 'np', display: 'chief' }),
    });
    const out = reg.dispatch('game.player.get', {}, 'r1');
    expect(out.result).toEqual({ pubkey: 'pk', npub: 'np', display: 'chief' });
  });
});

describe('event.publish is shell-brokered', () => {
  it('never signs — forwards the unsigned event to signAndPublishEvent', async () => {
    let seen = null;
    const reg = build({
      signAndPublishEvent: (ev) => { seen = ev; return Promise.resolve({ id: 'e1', ok: true, relays: ['wss://r.a'] }); },
    });
    const out = reg.dispatch('game.event.publish', { event: { kind: 30078, content: 'score' } }, 'r1');
    expect(out.__async).toBe(true);
    const env = await out.promise;
    expect(env.type).toBe('game.event.publish.result');
    expect(env.result.id).toBe('e1');
    expect(seen).toEqual({ kind: 30078, content: 'score' });
  });
  it('is unsupported when no publish callback is bound', () => {
    const reg = build();
    const out = reg.dispatch('game.event.publish', { event: { kind: 1 } }, 'r1');
    expect(out.error.code).toBe('unsupported');
  });
});

describe('event.subscribe funnels through the shell fanout', () => {
  it('opens and closes a subscription via the shell callback', () => {
    let opened = null, closed = false;
    const reg = build({
      openRelaySubscription: (filter) => {
        opened = filter;
        return { subscriptionId: 'sub-1', close: () => { closed = true; } };
      },
    });
    const sub = reg.dispatch('game.event.subscribe', { filter: { kinds: [1] } }, 'r1');
    expect(sub.result.subscriptionId).toBe('sub-1');
    expect(opened).toEqual({ kinds: [1] });
    const un = reg.dispatch('game.event.unsubscribe', { subscriptionId: 'sub-1' }, 'r2');
    expect(un.result.ok).toBe(true);
    expect(closed).toBe(true);
  });
});

describe('exit clears the arena', () => {
  it('calls onArenaExit and reports ok', () => {
    let reason = null;
    const reg = build({ onArenaExit: (r) => { reason = r; return true; } });
    const out = reg.dispatch('game.exit', { reason: 'travel' }, 'r1');
    expect(out.result.ok).toBe(true);
    expect(reason).toBe('travel');
  });
});
