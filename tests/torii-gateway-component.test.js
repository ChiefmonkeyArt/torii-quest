// tests/torii-gateway-component.test.js — locks the 0l.3 portal/NAP data-shell
// component. torii.gateway is now an EXPANDING component: expandToriiGateway
// returns the travel-gateway's decorative GLTF object as a plain world.object,
// shape-equivalent to the 0k.4 baked inline object. mount/unmount are no-ops —
// no travel, no auth, no click/raycast, no Nostr.
import { describe, it, expect } from 'vitest';
import { defineComponent, isExpandingComponent } from '../src/engine/components/contract.js';
import { createBuiltinRegistry } from '../src/engine/components/registry.js';
import { createToriiGateway, expandToriiGateway, toriiGateway } from '../src/engine/components/toriiGateway.js';
import { expandWorldComponents } from '../src/engine/world/worldComponents.js';
import { mountWorldComponents } from '../src/engine/world/worldComponentHost.js';
import { validateWorld } from '../src/engine/world/worldSchema.js';

const registry = createBuiltinRegistry();

const GATE_CONFIG = {
  model: 'torii-gateway-experience.glb',
  position: [0, 0.885, 32],
  rotation: [0, Math.PI / 2, 0],
  scale: 4.16,
};

describe('torii.gateway component — contract + expand', () => {
  it('is a contract-valid expanding component', () => {
    const c = createToriiGateway(GATE_CONFIG);
    expect(isExpandingComponent(c)).toBe(true);
    expect(c.manifest.id).toBe('torii.gateway');
    expect(c.manifest.kind).toBe('gateway');
    expect(c.manifest.mountTarget).toBe('scene');
  });

  it('expand returns exactly one gltf object matching the baked gateway', () => {
    const objs = expandToriiGateway(GATE_CONFIG);
    expect(objs).toHaveLength(1);
    const o = objs[0];
    expect(o.type).toBe('gltf');
    expect(o.model).toBe('torii-gateway-experience.glb');
    expect(o.position).toEqual([0, 0.885, 32]);
    expect(o.rotation).toEqual([0, Math.PI / 2, 0]);
    expect(o.scale).toBeCloseTo(4.16, 3);
    expect(o.collider).toBeUndefined();
  });

  it('expand returns [] for missing/malformed config (no error)', () => {
    expect(expandToriiGateway({})).toEqual([]);
    expect(expandToriiGateway({ model: 123 })).toEqual([]);
    expect(expandToriiGateway({ model: 'x.glb', position: [0, NaN, 0] })).toEqual([]);
  });
});

describe('torii.gateway — registry + resolver', () => {
  it('registry loads torii.gateway', () => {
    expect(registry.has('torii.gateway')).toBe(true);
    const r = registry.load('torii.gateway', GATE_CONFIG);
    expect(r.ok).toBe(true);
    expect(isExpandingComponent(r.component)).toBe(true);
  });

  it('expandWorldComponents expands torii.gateway into world.objects', () => {
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'torii.gateway', config: GATE_CONFIG }] }).world;
    const ex = expandWorldComponents(world, registry);
    expect(ex.errors).toHaveLength(0);
    expect(ex.expanded).toBe(1);
    const gw = ex.world.objects.filter((o) => o.type === 'gltf');
    expect(gw).toHaveLength(1);
    expect(gw[0].model).toBe('torii-gateway-experience.glb');
  });

  it('expandWorldComponents expands BOTH arena.crates + torii.gateway', () => {
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [
      { id: 'arena.crates' }, { id: 'torii.gateway', config: GATE_CONFIG },
    ] }).world;
    const ex = expandWorldComponents(world, registry);
    expect(ex.errors).toHaveLength(0);
    expect(ex.expanded).toBe(10); // 9 crates + 1 gateway
  });
});

describe('torii.gateway — runtime host (mount is a no-op)', () => {
  it('mountWorldComponents mounts torii.gateway with zero scene.add() + no error', () => {
    const added = [];
    const scene = { add: (o) => added.push(o), remove: () => {} };
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'torii.gateway', config: GATE_CONFIG }] }).world;
    const h = mountWorldComponents(world, registry, scene, {});
    expect(h.mounted).toBe(1);
    expect(h.errors).toHaveLength(0);
    expect(added.length).toBe(0); // data shell — mount adds nothing to the scene
    expect(() => h.unmount()).not.toThrow();
  });

  it('bad gateway config (no model) expands to nothing but does not kill the world', () => {
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'torii.gateway', config: {} }] }).world;
    const ex = expandWorldComponents(world, registry);
    expect(ex.expanded).toBe(0);
    expect(ex.errors).toHaveLength(0); // expand returned [] cleanly — not an error
  });
});
