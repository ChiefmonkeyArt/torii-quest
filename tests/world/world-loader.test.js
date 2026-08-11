import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_WORLD,
  loadWorld,
  validateWorld,
} from '../../src/engine/world/worldLoader.js';

describe('world loader', () => {
  it('validateWorld accepts a valid world object', () => {
    const result = validateWorld(DEFAULT_WORLD);

    expect(result).toEqual({
      ok: true,
      errors: [],
      data: DEFAULT_WORLD,
    });
  });

  it.each(['terrain', 'spawns', 'combat'])(
    'validateWorld rejects a missing %s field',
    (field) => {
      const world = structuredClone(DEFAULT_WORLD);
      delete world[field];

      const result = validateWorld(world);

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(`${field} is required`);
    },
  );

  it('validateWorld ignores unknown fields', () => {
    const world = { ...DEFAULT_WORLD, futureFeature: { enabled: true } };

    expect(validateWorld(world)).toEqual({
      ok: true,
      errors: [],
      data: world,
    });
  });

  it('DEFAULT_WORLD matches worlds/default/world.json', async () => {
    const path = new URL('../../worlds/default/world.json', import.meta.url);
    const fileWorld = JSON.parse(await readFile(path, 'utf8'));

    expect(DEFAULT_WORLD).toEqual(fileWorld);
  });

  it('loadWorld returns parsed and validated world data', async () => {
    const world = structuredClone(DEFAULT_WORLD);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(world)),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadWorld('/worlds/default/world.json');

    expect(result).toEqual(world);
    expect(fetchMock).toHaveBeenCalledWith('/worlds/default/world.json');
    vi.unstubAllGlobals();
  });
});
