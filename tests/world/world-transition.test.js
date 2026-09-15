// world-transition.test.js — locks the seamless "torii threshold" handoff order
// (resolve → fade-out → stop → render → join → spawn → fade-in) and its fail-closed
// behaviour. Pure; every side effect is a spy so no renderer/socket is touched.
import { describe, it, expect } from 'vitest';
import { transitionToWorld, TRANSITION_PHASES } from '../../src/engine/world/worldTransition.js';

const WORLD = { id: 'bekka-world', name: 'Bekka World' };

// Build a full hook set whose phases all succeed, recording call order.
function hooks() {
  const order = [];
  return {
    order,
    args: {
      target: 'npub1…',
      resolve: async () => { order.push('resolve'); return { ok: true, world: WORLD, relays: ['wss://bekka.world/mp'] }; },
      fadeOut: async () => { order.push('fade-out'); },
      stopMultiplayer: async (r) => { order.push('stop'); expect(r).toBe('travel'); },
      renderWorld: async (w) => { order.push('render'); expect(w).toBe(WORLD); },
      joinWorld: async (relays) => { order.push('join'); expect(relays).toContain('wss://bekka.world/mp'); return { ok: true }; },
      spawnAt: async () => { order.push('spawn'); },
      fadeIn: async () => { order.push('fade-in'); },
    },
  };
}

describe('transitionToWorld', () => {
  it('runs the full handoff in the exact phase order', async () => {
    const h = hooks();
    const r = await transitionToWorld(h.args);
    expect(r.ok).toBe(true);
    expect(r.world).toBe(WORLD);
    expect(h.order).toEqual(['resolve', 'fade-out', 'stop', 'render', 'join', 'spawn', 'fade-in']);
    expect(h.order).toEqual([...TRANSITION_PHASES]);
  });

  it('fails closed at resolve when resolution fails', async () => {
    const h = hooks();
    h.args.resolve = async () => { h.order.push('resolve'); return { ok: false, reason: 'no-reference' }; };
    const r = await transitionToWorld(h.args);
    expect(r.phase).toBe('resolve');
    expect(r.reason).toBe('no-reference');
    expect(h.order).toEqual(['resolve']);
  });

  it('aborts at the first failing phase and does not continue', async () => {
    const h = hooks();
    h.args.renderWorld = async () => { h.order.push('render'); throw new Error('boom'); };
    const r = await transitionToWorld(h.args);
    expect(r.phase).toBe('render');
    expect(h.order).toEqual(['resolve', 'fade-out', 'stop', 'render']); // join onward never runs
  });

  it('fails closed on a failed join and never spawns', async () => {
    const h = hooks();
    h.args.joinWorld = async () => { h.order.push('join'); return { ok: false }; };
    const r = await transitionToWorld(h.args);
    expect(r.phase).toBe('join');
    expect(h.order).toEqual(['resolve', 'fade-out', 'stop', 'render', 'join']);
  });

  it('rejects a missing required hook before any work', async () => {
    const r = await transitionToWorld({ resolve: async () => ({}) });
    expect(r.ok).toBe(false);
    expect(r.phase).toBe('resolve');
    expect(r.reason).toBe('missing-hook:fadeOut');
  });
});