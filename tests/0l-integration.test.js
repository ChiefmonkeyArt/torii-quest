// tests/0l-integration.test.js — integration sanity for the full 0l component-seam
// stack (0l.1 + 0l.2 + 0l.3) against the real chiefmonkey-template world. Locks
// that the raw manifest uses component instances (not inline crates/gateway), that
// the resolver expands them to the expected objects, and that the runtime host
// mounts the data-shell gateway with zero scene adds.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { createBuiltinRegistry } from '../src/engine/components/registry.js';
import { expandWorldComponents } from '../src/engine/world/worldComponents.js';
import { mountWorldComponents } from '../src/engine/world/worldComponentHost.js';

const WORLD_PATH = new URL('../worlds/chiefmonkey-template/world.json', import.meta.url);
const registry = createBuiltinRegistry();

describe('0l component-seam integration (chiefmonkey-template)', () => {
  it('raw manifest declares the component instances (not inline crates/gateway)', () => {
    const world = JSON.parse(readFileSync(WORLD_PATH, 'utf8'));
    const ids = (world.components || []).map((c) => c.id).sort();
    expect(ids).toEqual(['arena.crates', 'torii.gateway']);
    // The inline crate box objects are gone (replaced by arena.crates).
    const inlineCrates = (world.objects || []).filter(
      (o) => o.type === 'box' && o.collider && /crate/i.test(JSON.stringify(o)),
    );
    expect(inlineCrates).toHaveLength(0);
    // The inline travel-gateway gltf is gone (replaced by torii.gateway).
    const inlineGateway = (world.objects || []).filter(
      (o) => o.type === 'gltf' && o.model === 'torii-gateway-experience.glb',
    );
    expect(inlineGateway).toHaveLength(0);
  });

  it('resolver expands the world to exactly 9 crates + 1 travel gateway', () => {
    const world = validateWorld(JSON.parse(readFileSync(WORLD_PATH, 'utf8'))).world;
    const ex = expandWorldComponents(world, registry);
    expect(ex.errors).toHaveLength(0);
    expect(ex.expanded).toBe(10);
    const crates = ex.world.objects.filter(
      (o) => o.type === 'box' && o.collider && Math.abs(o.position[0]) >= 0,
    ).filter((o) => o.scale && o.color === '#4a4458');
    expect(crates.length).toBe(9);
    const gateway = ex.world.objects.filter(
      (o) => o.type === 'gltf' && o.model === 'torii-gateway-experience.glb',
    );
    expect(gateway).toHaveLength(1);
  });

  it('runtime host mounts torii.gateway with zero scene.add() + no error', () => {
    const world = validateWorld(JSON.parse(readFileSync(WORLD_PATH, 'utf8'))).world;
    const added = [];
    const scene = { add: (o) => added.push(o), remove: () => {} };
    const h = mountWorldComponents(world, registry, scene, {});
    expect(h.errors).toHaveLength(0);
    expect(added.length).toBe(0); // data shell — nothing mounted to the scene
    expect(() => h.unmount()).not.toThrow();
  });
});
