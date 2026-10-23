// ADR-0147 (v0.2.922): the full Starter Pack catalogue + travel teardown of the
// market boards (Milestone 1).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { STARTER_PACK, STARTER_PACK_IDS, starterPackEntry, starterPackProgress } from '../../src/engine/components/starterPack.js';
import { createBuiltinRegistry } from '../../src/engine/components/registry.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

describe('Starter Pack catalogue (ADR-0147: full pack)', () => {
  it('covers every classic arena piece, with unique well-formed ids', () => {
    expect(new Set(STARTER_PACK_IDS).size).toBe(STARTER_PACK_IDS.length);
    for (const id of STARTER_PACK_IDS) expect(id).toMatch(/^[a-z]+(\.[a-z][a-z-]*)+$/);
    for (const want of ['world.island', 'world.sea', 'world.coastline', 'world.bridge', 'world.foliage', 'torii.gate', 'torii.gateway',
      'nap.zone', 'nap.tree', 'nap.mirror', 'npc.greeter', 'sign.board', 'market.products', 'market.auctions', 'arena.crates', 'game.arena']) {
      expect(STARTER_PACK_IDS).toContain(want);
    }
  });
  it('builtIn matches the registry exactly (no claim without a factory)', () => {
    const reg = createBuiltinRegistry();
    for (const c of STARTER_PACK) expect(reg.load(c.id, {}).ok, c.id).toBe(c.builtIn);
  });
  it('every classic builder it points at really exists (migration map stays true)', () => {
    for (const c of STARTER_PACK) {
      if (!c.classic) continue;
      const [file, fn] = c.classic;
      expect(existsSync(new URL(file, root)), file).toBe(true);
      expect(read(file), `${file} ${fn}`).toMatch(new RegExp(`\\b${fn}\\b`));
    }
  });
  it('market boards read the WORLD OWNER\'s store, and points stay frozen', () => {
    expect(starterPackEntry('market.products').provides).toMatch(/WORLD OWNER/);
    expect(starterPackEntry('game.arena').provides).toMatch(/head 9, body 3/);
    expect(starterPackEntry('nope')).toBeNull();
    const p = starterPackProgress();
    expect(p.total).toBe(STARTER_PACK.length);
    expect(p.builtIn + p.remaining.length).toBe(p.total);
  });
});

describe('ADR-0147 accepted with the owner decisions', () => {
  const adr = read('docs/adr/0147-sovereign-metaverse-architecture.md');
  it('status Accepted; path, full pack, open signed publishing recorded', () => {
    expect(adr).toMatch(/\*\*Status:\*\* Accepted/);
    expect(adr).toMatch(/\/quest\/w\/<npub>\/<world>/);
    expect(adr).toMatch(/full Starter Pack/);
    expect(adr).toMatch(/anyone may publish signed components/i);
  });
});

describe('travel teardown stops the market boards (M1 step 4)', () => {
  const rt = read('src/arenaRuntime.js');
  const m3 = read('src/engine/plebeian/marketBoards3d.js');
  it('legacy teardown disposes the boards and resets the auction prompt first', () => {
    expect(rt).toMatch(/function _teardownLegacyArena\(\) \{\n[^\n]*\n\s*try \{ disposeMarketBoards3d\(\); \} catch \{[^}]*\}\n\s*try \{ _auctionBoardTrigger\.reset\(\); \}/);
  });
  it('dispose stops feeds, frees textures/materials, forgets the boards', async () => {
    expect(m3).toMatch(/export function disposeMarketBoards3d\(\) \{\n\s*_setWanted\(false\);/);
    expect(m3).toMatch(/b\.tex\.dispose\(\)/);
    expect(m3).toMatch(/_boards\.twin\.material\.dispose\(\)/);
    const mod = await import('../../src/engine/plebeian/marketBoards3d.js');
    expect(() => { mod.disposeMarketBoards3d(); mod.disposeMarketBoards3d(); }).not.toThrow(); // idempotent, safe before build
    expect(mod.marketBoards3dBuilt()).toBe(false);
    expect(mod.marketBoards3dState()).toMatchObject({ built: false, wanted: false, products: [], auctions: [] });
  });
});
