// engine/components/starterPack.js — ADR-0147 (v0.2.922): the full Starter
// Pack. Every piece of the classic arena becomes a built-in component a world
// description can include, so home and visitors draw the SAME world.
//
// PURE catalogue (no THREE/DOM). `builtIn: true` means the component is
// registered in createBuiltinRegistry() today. The rest are being migrated
// from the classic builder named in `classic` (Milestone 1). Built-in
// components are vetted engine code shipped in the build; components that
// anyone publishes are third-party and only ever run as sandboxed napplets
// after the COMPONENTS.md §7 checks (signature, bundle hash, asset hashes,
// declared capabilities).
export const STARTER_PACK = Object.freeze([
  { id: 'world.island', title: 'Island terrain', provides: 'arena + NAP ground meshes and their physics heightfields', builtIn: false, classic: ['src/terrain/terrainMesh.js', 'buildArenaTerrainMesh'] },
  { id: 'world.sea', title: 'Sea', provides: 'animated ocean around the land', builtIn: false, classic: ['src/terrain/sea.js', 'buildSeaMesh'] },
  { id: 'world.coastline', title: 'Coastline wall', provides: 'glass ribbon + neon edge along the shore', builtIn: false, classic: ['src/arena.js', '_buildCoastlineWall'] },
  { id: 'world.bridge', title: 'Bridge', provides: 'deck across the river', builtIn: false, classic: ['src/bridge.js', 'buildBridge'] },
  { id: 'world.foliage', title: 'Grass and trees', provides: 'instanced grass, flowers and trees', builtIn: false, classic: ['src/arena-foliage.js', 'buildFoliage'] },
  { id: 'torii.gate', title: 'Torii gate', provides: 'the arena torii arch', builtIn: false, classic: ['src/arena.js', '_buildToriiGate'] },
  { id: 'torii.gateway', title: 'Gateway Experience', provides: 'the travel torii: directory, peek, enter, arrival (ADR-0147 §1)', builtIn: true, classic: ['src/arena.js', '_buildTravelGateway'] },
  { id: 'nap.zone', title: 'NAP Zone', provides: 'safe social/commerce floor (no combat, stickers on)', builtIn: false, classic: ['src/arena.js', '_buildNapZone'] },
  { id: 'nap.tree', title: 'NAP tree', provides: 'the tree past the torii', builtIn: false, classic: ['src/arena.js', '_buildNapTree'] },
  { id: 'nap.mirror', title: 'Mirror', provides: 'the NAP Zone mirror', builtIn: false, classic: ['src/mirror.js', 'buildMirror'] },
  { id: 'npc.greeter', title: 'Greeter NPC', provides: "the world owner's character in the NAP Zone", builtIn: false, classic: ['src/napNpc.js', 'buildNapNpc'] },
  { id: 'sign.board', title: 'Signs', provides: 'NAP Zone signboards', builtIn: false, classic: ['src/engine/world/proofSurfaceMeshes.js', 'buildProofSurfaceMeshes'] },
  { id: 'market.products', title: 'PRODUCT board', provides: "live product slides from the WORLD OWNER's store setting (own, another npub, a mix, or none)", builtIn: false, classic: ['src/engine/plebeian/marketBoards3d.js', 'initMarketBoards3d'] },
  { id: 'market.auctions', title: 'AUCTION board', provides: "live auction slides (countdown, bids) from the WORLD OWNER's store setting", builtIn: false, classic: ['src/engine/plebeian/marketBoards3d.js', 'initMarketBoards3d'] },
  { id: 'plebeian.product-display', title: 'Product display', provides: 'a single in-world product display', builtIn: true, classic: null },
  { id: 'arena.crates', title: 'Crates', provides: 'arena cover crates', builtIn: true, classic: ['src/arena.js', '_buildCrates'] },
  { id: 'game.arena', title: 'Arena game zone', provides: 'bots, combat and scoring (points frozen: head 9, body 3)', builtIn: false, classic: ['src/arenaRuntime.js', 'createGameZone'] },
]);

/** Starter Pack ids in catalogue order. */
export const STARTER_PACK_IDS = Object.freeze(STARTER_PACK.map((c) => c.id));

/** → catalogue entry or null. */
export function starterPackEntry(id) { return STARTER_PACK.find((c) => c.id === id) || null; }

/** Migration progress: { builtIn, total, remaining: [ids] }. */
export function starterPackProgress() {
  const remaining = STARTER_PACK.filter((c) => !c.builtIn).map((c) => c.id);
  return { builtIn: STARTER_PACK.length - remaining.length, total: STARTER_PACK.length, remaining };
}
