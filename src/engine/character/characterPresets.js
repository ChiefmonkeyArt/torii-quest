// engine/character/characterPresets.js — curated base characters for the
// Character Forge create flow (slice 1: presets + stickers, zero AI).
//
// Each preset references a mesh by Blossom sha256 (content-addressed). The
// operator uploads the corresponding GLB to a Blossom server ONCE; the hash is
// then stable and portable across worlds. Until a mesh is uploaded, a preset
// still builds a valid manifest but its mesh won't resolve on other worlds.
// Pure + node-safe: no DOM, no socket, no deps.

import { CHARACTER_MANIFEST_VERSION } from './characterManifest.js';

// Curated base characters. `mesh.hash` is the sha256 of the shipped GLB
// (content-addressed, so it is the Blossom hash once the file is uploaded).
export const CHARACTER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'chiefmonkey',
    label: 'Chiefmonkey',
    mesh: Object.freeze({
      hash: '0de4f645a45b5ff5a0ca334d3a905e81e1185b3554bebe5f40fdb32ea194c7c5',
      name: 'animation-library.glb',
    }),
    name: 'Chiefmonkey',
    colors: Object.freeze([]),
    stickers: Object.freeze([]),
  }),
  Object.freeze({
    id: 'nostrich',
    label: 'Nostrich',
    mesh: Object.freeze({
      hash: '07566cdfaf2431e1abb534803b9cf2d151f97595afe14f7793a1b130f1d09c11',
      name: 'nostrich-master.glb',
    }),
    name: 'Nostrich',
    colors: Object.freeze([]),
    stickers: Object.freeze([]),
  }),
]);

// getCharacterPreset(id) → the preset, or null. Never throws.
export function getCharacterPreset(id) {
  if (typeof id !== 'string') return null;
  return CHARACTER_PRESETS.find((p) => p.id === id) || null;
}

// presetToManifest(preset) → a `torii.character` manifest (v1) built from a
// preset. Clips/contrib are empty (a preset is a fresh base, not a remix);
// stickers/colors are copied through so a preset may carry tints/decals.
export function presetToManifest(preset) {
  const p = (preset && typeof preset === 'object') ? preset : {};
  return {
    version: CHARACTER_MANIFEST_VERSION,
    mesh: (p.mesh && typeof p.mesh === 'object') ? { hash: p.mesh.hash || '', name: p.mesh.name || '' } : null,
    clips: [],
    stickers: Array.isArray(p.stickers)
      ? p.stickers.map((s) => ({ hash: s.hash || '', zoneId: s.zoneId || '', u: s.u || 0, v: s.v || 0, rot: s.rot || 0 }))
      : [],
    name: typeof p.name === 'string' ? p.name : '',
    colors: Array.isArray(p.colors) ? p.colors.map((c) => ({ slot: c.slot || '', hex: c.hex || '' })) : [],
    contrib: [],
  };
}
