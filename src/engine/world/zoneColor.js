// engine/world/zoneColor.js — the ARENA's per-zone terrain ground colour, shared by
// the LEGACY terrainMesh.js and the DATA-DRIVEN worldTerrain.js/terrainVisual.js so a
// serialized arena world renders byte-identical to the live arena. PURE + node-safe
// (no THREE, no DOM): every function returns plain { r, g, b } floats in [0,1] (the
// same linear values a THREE.Color from the hex base would hold).
//
// The legacy buildZoneMesh baked these as per-vertex colours via a vary() callback;
// the data-driven path (ADR-0119) builds its heightfields positionally (zone[0] = the
// sandy arena, zone[1] = the green NAP island) and must apply the SAME variation so a
// traveller lands on green NAP + sandy arena + waterline shading, not one flat yellow
// sheet. Serializing the colour also means a later custom colour round-trips without
// touching shader code.

// Hex base colours (match terrainMesh.js buildArenaTerrainMesh / buildNapTerrainMesh).
const ARENA_SAND = 0xb9a06b; // sandy shore
const NAP_GREEN = 0x5a7a3a;  // lighter NAP green

// Terrain datum (mirrors seaConfig.js SEA_LEVEL + heightmap.js ISLAND_BASE_Y). The
// vary functions read these directly so the waterline shading agrees with the legacy
// arena even though the data-driven path has no direct access to those modules.
export const ZONE_SEA_LEVEL = -0.3;
export const ZONE_ISLAND_BASE_Y = 1.0;

/** 'arena' | 'nap' zone-kind constants. */
export const ZONE_ARENA = 'arena';
export const ZONE_NAP = 'nap';

/** The flat base colour for a zone kind, as { r, g, b } floats. */
export function zoneBaseColor(kind) {
  const hex = kind === ZONE_NAP ? NAP_GREEN : ARENA_SAND;
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}

// Cheap deterministic value-noise in [0,1) from world XZ — identical to terrainMesh._hash
// so the speckle pattern matches the live arena exactly.
export function zoneNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function _underwater(base, h) {
  if (h >= ZONE_SEA_LEVEL + 0.3) return null;
  const depth = Math.max(0, ZONE_SEA_LEVEL + 0.3 - h);
  const underwater = Math.min(1, depth * 0.5);
  return {
    r: base.r * (1 - underwater) * 0.15,
    g: base.g * (1 - underwater) * 0.15,
    b: base.b * (1 - underwater) * 0.2,
  };
}

/**
 * Sandy arena ground colour with procedural per-vertex variation — mirrors
 * terrainMesh._arenaGroundColor: a hashed speckle + height tint (lighter dry sand on
 * rises, darker damp earth in dips), going dark below the waterline.
 * @param {number} x world-X
 * @param {number} z world-Z
 * @param {number} h world-Y (height)
 * @returns {{ r:number, g:number, b:number }}
 */
export function arenaGroundColor(x, z, h) {
  const base = zoneBaseColor(ZONE_ARENA);
  const under = _underwater(base, h);
  if (under) return under;
  const n = zoneNoise(x, z);
  const span = (ZONE_ISLAND_BASE_Y - ZONE_SEA_LEVEL) || 1;
  const hf = Math.max(0, Math.min(1, (h - ZONE_SEA_LEVEL) / span));
  const shade = 0.80 + 0.20 * n + 0.14 * hf;
  return { r: base.r * shade, g: base.g * shade, b: base.b * shade };
}

/**
 * NAP island ground colour — lighter green with earth/grit/stone detail, mirrors
 * terrainMesh._napGroundColor (hash speckle + height brightening + sparse earth and
 * stone patches).
 * @returns {{ r:number, g:number, b:number }}
 */
export function napGroundColor(x, z, h) {
  const base = zoneBaseColor(ZONE_NAP);
  const under = _underwater(base, h);
  if (under) return under;
  const n = zoneNoise(x, z);
  const n2 = zoneNoise(x * 3.7 + 11, z * 5.3 + 7);
  const span = (ZONE_ISLAND_BASE_Y - ZONE_SEA_LEVEL) || 1;
  const hf = Math.max(0, Math.min(1, (h - ZONE_SEA_LEVEL) / span));
  const shade = 0.85 + 0.15 * n + 0.12 * hf;
  const earth = n2 > 0.85 ? 0.35 : 0;
  const stone = n > 0.95 ? 0.25 : 0;
  return {
    r: Math.min(1, base.r * shade + earth * 0.25 + stone * 0.15),
    g: Math.min(1, base.g * shade + earth * 0.12 + stone * 0.15),
    b: Math.min(1, base.b * shade + earth * 0.05 + stone * 0.12),
  };
}

/** Resolve the vary() function for a zone kind, or null for a flat colour. */
export function zoneVary(kind) {
  return kind === ZONE_NAP ? napGroundColor : arenaGroundColor;
}