// engine/components/starterPackComponents.js — ADR-0147 Milestone 1: Starter
// Pack pieces as BUILT-IN, HOST-BACKED components.
//
// The registry stays pure (no THREE): a host-backed component's mount() calls
// the builder the host supplies in ctx.hostBuilders[id], which returns an
// optional undo(). With no host builder (e.g. an engine that doesn't provide
// this piece), mount is a reported no-op, never a crash.
//
// Group 1 (v0.2.923): world.island, world.sea, world.coastline.
import { defineComponent, COMPONENT_CONTRACT_VERSION } from './contract.js';

export const STARTER_PACK_COMPONENT_VERSION = '0.1.0';
const AUTHOR = 'npub1torii0starter0pack0component0placeholder0author0xxxxxx';

function hostBacked({ id, name, kind }) {
  return function create(config = {}) {
    let undo = null;
    return defineComponent({
      manifest: { id, name, version: STARTER_PACK_COMPONENT_VERSION, author: { npub: AUTHOR }, mountTarget: 'scene', contract: COMPONENT_CONTRACT_VERSION, kind },
      mount(scene, ctx = {}) {
        const fn = ctx.hostBuilders && typeof ctx.hostBuilders[id] === 'function' ? ctx.hostBuilders[id] : null;
        if (!fn) return false;
        const r = fn(scene, ctx.config || config);
        undo = typeof r === 'function' ? r : null;
        return true;
      },
      unmount() { if (undo) { try { undo(); } finally { undo = null; } } },
    });
  };
}

export const createWorldIsland = hostBacked({ id: 'world.island', name: 'Island terrain', kind: 'terrain' });
export const createWorldSea = hostBacked({ id: 'world.sea', name: 'Sea', kind: 'scenery' });
export const createWorldCoastline = hostBacked({ id: 'world.coastline', name: 'Coastline wall', kind: 'scenery' });
// Group 2 (v0.2.925).
export const createNapZone = hostBacked({ id: 'nap.zone', name: 'NAP Zone', kind: 'zone' });
export const createNapTree = hostBacked({ id: 'nap.tree', name: 'NAP tree', kind: 'scenery' });
export const createNapMirror = hostBacked({ id: 'nap.mirror', name: 'Mirror', kind: 'scenery' });
export const createNpcGreeter = hostBacked({ id: 'npc.greeter', name: 'Greeter NPC', kind: 'npc' });
// Group 3 (v0.2.926).
export const createSignBoard = hostBacked({ id: 'sign.board', name: 'Signs', kind: 'scenery' });
export const createMarketProducts = hostBacked({ id: 'market.products', name: 'PRODUCT board', kind: 'commerce' });
export const createMarketAuctions = hostBacked({ id: 'market.auctions', name: 'AUCTION board', kind: 'commerce' });

/** Every host-backed Starter Pack factory shipped so far. */
export const STARTER_PACK_FACTORIES = Object.freeze([createWorldIsland, createWorldSea, createWorldCoastline, createNapZone, createNapTree, createNapMirror, createNpcGreeter, createSignBoard, createMarketProducts, createMarketAuctions]);
