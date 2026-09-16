// tests/world-config-path.test.js — the candidate world.json path resolution
// (server/world/worldConfigPath.js, ADR-0119 slice 4). Pure; no server entry import,
// no fs — just assert the precedence of the paths the beacon will try. path.join
// normalises `..`, so sibling-dir candidates collapse to a clean absolute path.
import { describe, it, expect } from 'vitest';
import { resolveLegacyWorldConfigPaths } from '../server/world/worldConfigPath.js';

describe('resolveLegacyWorldConfigPaths', () => {
  it('puts the env override first, then bare-metal, Suite data, Suite current', () => {
    const p = resolveLegacyWorldConfigPaths('/srv/quest', { QUEST_WORLD_JSON_PATH: '/custom/world.json' });
    expect(p[0]).toBe('/custom/world.json');
    expect(p[1]).toBe('/srv/quest/worlds/default/world.json');
    expect(p[2]).toBe('/srv/data/worlds/default/world.json');   // ../ from /srv/quest
    expect(p[3]).toBe('/srv/current/worlds/default/world.json');
  });

  it('resolves from the MP server dir to the sibling data dir on the Suite layout', () => {
    // Suite: cwd = /apps/quest/mp → ../data/worlds/default/world.json
    const p = resolveLegacyWorldConfigPaths('/apps/quest/mp', {});
    expect(p).toHaveLength(3); // no env override → 3 fallback candidates
    expect(p[0]).toBe('/apps/quest/mp/worlds/default/world.json');
    expect(p[1]).toBe('/apps/quest/data/worlds/default/world.json');
    expect(p[2]).toBe('/apps/quest/current/worlds/default/world.json');
  });

  it('omits a blank env override but keeps the default candidates', () => {
    const p = resolveLegacyWorldConfigPaths('/x', { QUEST_WORLD_JSON_PATH: '   ' });
    expect(p).toHaveLength(3); // blank override filtered, 3 fallback candidates
    expect(p[0]).toBe('/x/worlds/default/world.json');
  });
});