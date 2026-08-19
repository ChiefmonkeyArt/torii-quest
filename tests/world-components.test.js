// tests/world-components.test.js — locks the 0l.1 component-expansion seam: a
// droppable component contributes static world.objects via expand(config), which
// expandWorldComponents appends to world.objects at manifest-load time. The
// arena.crates reference component proves it end-to-end — its 9 expanded crate
// objects are shape-equivalent to the legacy baked crates.
import { describe, it, expect } from 'vitest';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { defineComponent, isExpandingComponent } from '../src/engine/components/contract.js';
import { createBuiltinRegistry } from '../src/engine/components/registry.js';
import { expandArenaCrates, createArenaCrates, arenaCrates } from '../src/engine/components/arenaCrates.js';
import { expandWorldComponents } from '../src/engine/world/worldComponents.js';
import { CRATES } from '../src/config.js';
import { isArenaPlayArea } from '../src/terrain/tomoeShape.js';
import { sampleArenaHeight } from '../src/terrain/heightmap.js';

const registry = createBuiltinRegistry();

describe('arena.crates component', () => {
  it('is a contract-valid expanding component', () => {
    expect(isExpandingComponent(arenaCrates)).toBe(true);
    expect(arenaCrates.manifest.id).toBe('arena.crates');
    expect(arenaCrates.manifest.mountTarget).toBe('scene');
    expect(arenaCrates.manifest.kind).toBe('scenery');
  });

  it('expand produces exactly the in-zone crates matching the legacy formula', () => {
    const crates = expandArenaCrates();
    const expected = CRATES.filter(([cx, cz]) => isArenaPlayArea(cx, cz));
    expect(crates.length).toBe(expected.length);
    for (const [cx, cz, hw, hd, ch] of expected) {
      const c = crates.find((o) => o.position[0] === cx && o.position[2] === cz);
      expect(c).toBeTruthy();
      expect(c.type).toBe('box');
      expect(c.position[1]).toBeCloseTo(ch / 2 + sampleArenaHeight(cx, cz), 4);
      expect(c.scale).toEqual([hw * 2, ch, hd * 2]);
      expect(c.color).toBe('#4a4458');
      expect(c.collider.size).toEqual([hw * 2, ch, hd * 2]);
    }
  });
});

describe('component registry', () => {
  it('registers + loads arena.crates', () => {
    expect(registry.has('arena.crates')).toBe(true);
    const r = registry.load('arena.crates');
    expect(r.ok).toBe(true);
    expect(isExpandingComponent(r.component)).toBe(true);
  });
});

describe('expandWorldComponents resolver', () => {
  it('expands a component instance into world.objects', () => {
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'arena.crates' }] }).world;
    const r = expandWorldComponents(world, registry);
    expect(r.errors).toHaveLength(0);
    expect(r.expanded).toBe(9);
    // The 9 crates are now in world.objects (appended after the base objects).
    const crates = r.world.objects.filter((o) => o.type === 'box' && o.collider);
    expect(crates.length).toBe(9);
  });

  it('warns + skips an unknown component id (world still valid)', () => {
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'no.such.component' }] }).world;
    const r = expandWorldComponents(world, registry);
    expect(r.expanded).toBe(0);
    expect(r.errors.length).toBeGreaterThanOrEqual(1);
    expect(r.world.objects).toEqual([]);
  });

  it('passes config through to expand (colour override)', () => {
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'arena.crates', config: { color: '#ff0000' } }] }).world;
    const r = expandWorldComponents(world, registry);
    expect(r.expanded).toBe(9);
    expect(r.world.objects.every((o) => o.color === '#ff0000')).toBe(true);
  });

  it('a scene-only component expands to zero objects (no error)', () => {
    // torii.gateway is scene-mounted; its default expand() returns [] — valid,
    // just no static scenery. No error, 0 objects.
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'torii.gateway' }] }).world;
    const r = expandWorldComponents(world, registry);
    expect(r.expanded).toBe(0);
    expect(r.errors).toHaveLength(0);
  });
});

describe('schema — world.components field', () => {
  it('validates component instances + drops malformed entries', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      components: [{ id: 'arena.crates', config: { color: '#fff' } }, { id: '' }, { foo: 1 }, 'bad'],
    });
    expect(v.ok).toBe(true);
    expect(v.world.components).toHaveLength(1);
    expect(v.world.components[0].id).toBe('arena.crates');
    expect(v.world.components[0].config).toEqual({ color: '#fff' });
  });
});
