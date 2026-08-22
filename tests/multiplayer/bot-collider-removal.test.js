// tests/multiplayer/bot-collider-removal.test.js
// ADR-0019 (v0.2.629-alpha): removeBotColliders tears down a bot's body/head/bone
// colliders and clears the collider→bot/part lookups. This is the physics half of
// the stale-bot cleanup (the other half, _clearAllBots, disposes the THREE.js
// model + nameplate). Asserts REAL behaviour against the actual bodies.js module
// with a mocked Rapier world (no mirror of the logic under test).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initBodies, removeBotColliders, colliderToBot, colliderToPart,
} from '../../src/engine/physics/bodies.js';

function makeWorld() {
  const removedColliders = [];
  const removedBodies = [];
  return {
    world: {
      removeCollider: (c) => removedColliders.push(c),
      removeRigidBody: (b) => removedBodies.push(b),
    },
    removedColliders,
    removedBodies,
  };
}

beforeEach(() => {
  colliderToBot.clear();
  colliderToPart.clear();
  vi.restoreAllMocks();
});

describe('removeBotColliders (ADR-0019 stale-bot cleanup)', () => {
  it('removes body + head colliders and clears their lookups', () => {
    const { world, removedColliders, removedBodies } = makeWorld();
    initBodies(world, {});
    const bot = {
      rapierBody: { handle: 1 },
      rapierCollider: { handle: 10 },
      rapierHeadBody: { handle: 2 },
      rapierHeadCollider: { handle: 20 },
      boneColliders: [],
    };
    colliderToBot.set(10, bot);
    colliderToPart.set(10, 'body');
    colliderToBot.set(20, bot);
    colliderToPart.set(20, 'head');

    removeBotColliders(bot);

    expect(removedColliders).toHaveLength(2);
    expect(removedBodies).toHaveLength(2);
    expect(colliderToBot.size).toBe(0);
    expect(colliderToPart.size).toBe(0);
    expect(bot.rapierBody).toBe(null);
    expect(bot.rapierCollider).toBe(null);
    expect(bot.rapierHeadBody).toBe(null);
    expect(bot.rapierHeadCollider).toBe(null);
    expect(bot.boneColliders).toEqual([]);
  });

  it('is a safe no-op when the physics world is not initialised', () => {
    initBodies(null, {});
    const bot = {
      rapierBody: { handle: 1 }, rapierCollider: { handle: 10 },
      rapierHeadBody: { handle: 2 }, rapierHeadCollider: { handle: 20 },
      boneColliders: [],
    };
    expect(() => removeBotColliders(bot)).not.toThrow();
  });

  it('removes bone colliders too when present', () => {
    const { world, removedColliders, removedBodies } = makeWorld();
    initBodies(world, {});
    const boneColliders = [
      { collider: { handle: 30 }, body: { handle: 3 } },
      { collider: { handle: 31 }, body: { handle: 4 } },
    ];
    const bot = {
      rapierBody: null, rapierCollider: null,
      rapierHeadBody: null, rapierHeadCollider: null,
      boneColliders,
    };
    removeBotColliders(bot);
    expect(removedColliders).toHaveLength(2); // the two bone colliders
    expect(removedBodies).toHaveLength(2);
    expect(bot.boneColliders).toEqual([]);
  });
});
