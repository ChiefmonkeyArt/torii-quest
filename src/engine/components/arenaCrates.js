// engine/components/arenaCrates.js — first EXPANDING component (0l.1). Proves
// the data-expansion seam: a droppable component contributes STATIC scenery
// objects (the 9 legacy arena crates) via expand(config), which the host
// resolver appends to world.objects at manifest-load time. The existing
// buildWorldObjects + buildWorldObjectColliders then build them as if authored
// inline — byte/shape-equivalent to the baked crate objects.
//
// Pure + node-safe: imports only the contract + the same pure terrain helpers
// bake-crates.mjs uses (CRATES, sampleArenaHeight, isArenaPlayArea). NO Three /
// Rapier / DOM / Nostr. The expand output matches bake-crates.mjs exactly.
import { defineComponent, COMPONENT_CONTRACT_VERSION } from './contract.js';
import { CRATES } from '../../config.js';
import { sampleArenaHeight } from '../../terrain/heightmap.js';
import { isArenaPlayArea } from '../../terrain/tomoeShape.js';

export const ARENA_CRATES_VERSION = '0.1.0';
const CRATE_COLOR = '#4a4458'; // C_CRATE from arena.js (0x4a4458)

// expand(config) → the 9 legacy crate box objects. Mirrors bake-crates.mjs +
// arena.js:144 / physics.js:152 exactly: center Y = ch/2 + sampleArenaHeight;
// crates outside the play zone (isArenaPlayArea) are skipped so they never
// land in water/bridge/NAP. config may override the colour or filter crates.
export function expandArenaCrates(config = {}) {
  const color = typeof config.color === 'string' ? config.color : CRATE_COLOR;
  const out = [];
  for (const [cx, cz, hw, hd, ch] of CRATES) {
    if (!isArenaPlayArea(cx, cz)) continue;
    const y = ch / 2 + sampleArenaHeight(cx, cz);
    out.push({
      type: 'box',
      position: [cx, y, cz],
      scale: [hw * 2, ch, hd * 2],
      color,
      collider: { shape: 'box', size: [hw * 2, ch, hd * 2] },
    });
  }
  return out;
}

// createArenaCrates(config) → a contract-valid expanding component. mount/unmount
// are symmetric no-ops (the scenery is data-driven, not runtime-mounted); the
// expand path is what the host resolver uses. A real props component might ALSO
// mount runtime effects (glow, animation) — both paths coexist on one component.
export function createArenaCrates(config = {}) {
  return defineComponent({
    manifest: {
      id: 'arena.crates',
      name: 'Arena Crates',
      version: ARENA_CRATES_VERSION,
      author: { npub: 'npub1torii0arena0crates0component0placeholder0author0xxxxxx' },
      mountTarget: 'scene',
      contract: COMPONENT_CONTRACT_VERSION,
      kind: 'scenery',
    },
    expand: () => expandArenaCrates(config),
    mount() { /* data-driven — nothing to mount at runtime */ },
    unmount() { /* symmetric no-op */ },
  });
}

export const arenaCrates = createArenaCrates();
