// engine/character/characterManifest.js — the `torii.character` manifest schema
// + validator. Pure, node-safe.
//
// A character is a signed Nostr event (kind 35100, d tag "torii-character") that
// references a mesh GLB by Blossom sha256, plus clips, stickers, name, colors,
// and a contribution lineage. This module owns the manifest SHAPE and its
// validation — the "validator-first, not generator-first" contract from the
// Torii Asset Forge principle, applied to characters. See nap-torii-avatar-v0.md.

export const CHARACTER_MANIFEST_VERSION = 1;

// ── shape helpers ───────────────────────────────────────────────────────────

export function isSha256(s) {
  return typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
}

export function isHexColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

// emptyCharacterManifest() → a fresh, valid-shaped (but empty) manifest.
export function emptyCharacterManifest() {
  return {
    version: CHARACTER_MANIFEST_VERSION,
    mesh: null,
    clips: [],
    stickers: [],
    name: '',
    colors: [],
    contrib: [],
  };
}

// ── validation ──────────────────────────────────────────────────────────────

// validateCharacterManifest(manifest) → { valid, errors, warnings }.
// Structural validation only — it checks the manifest is well-formed, NOT that
// the referenced hashes resolve (that is a host/relay concern). Never throws.
export function validateCharacterManifest(manifest) {
  const errors = [];
  const warnings = [];
  const m = (manifest && typeof manifest === 'object') ? manifest : null;

  if (!m) {
    return { valid: false, errors: ['manifest is not an object'], warnings: [] };
  }

  if (m.version !== undefined && m.version !== CHARACTER_MANIFEST_VERSION) {
    warnings.push(`version ${m.version} != ${CHARACTER_MANIFEST_VERSION}`);
  }

  // mesh — the base GLB (required for a playable character).
  if (!m.mesh || typeof m.mesh !== 'object') {
    errors.push('mesh is required (blossom-sha256 + name)');
  } else {
    if (!isSha256(m.mesh.hash)) errors.push('mesh.hash must be a 64-hex sha256');
    if (typeof m.mesh.name !== 'string' || m.mesh.name.length === 0) {
      errors.push('mesh.name is required');
    }
  }

  // clips — animation clips (0..n).
  if (m.clips !== undefined) {
    if (!Array.isArray(m.clips)) {
      errors.push('clips must be an array');
    } else {
      m.clips.forEach((c, i) => {
        if (!c || typeof c !== 'object') { errors.push(`clips[${i}] must be an object`); return; }
        if (!isSha256(c.hash)) errors.push(`clips[${i}].hash must be a 64-hex sha256`);
        if (typeof c.name !== 'string' || c.name.length === 0) errors.push(`clips[${i}].name is required`);
      });
    }
  }

  // stickers — placed decals (0..n).
  if (m.stickers !== undefined) {
    if (!Array.isArray(m.stickers)) {
      errors.push('stickers must be an array');
    } else {
      m.stickers.forEach((s, i) => {
        if (!s || typeof s !== 'object') { errors.push(`stickers[${i}] must be an object`); return; }
        if (!isSha256(s.hash)) errors.push(`stickers[${i}].hash must be a 64-hex sha256`);
        if (typeof s.zoneId !== 'string' || s.zoneId.length === 0) errors.push(`stickers[${i}].zoneId is required`);
        if (typeof s.u !== 'number' || typeof s.v !== 'number') errors.push(`stickers[${i}].u/v must be numbers`);
        if (typeof s.rot !== 'number') errors.push(`stickers[${i}].rot must be a number`);
      });
    }
  }

  // colors — per-slot tints (0..n).
  if (m.colors !== undefined) {
    if (!Array.isArray(m.colors)) {
      errors.push('colors must be an array');
    } else {
      m.colors.forEach((c, i) => {
        if (!c || typeof c !== 'object') { errors.push(`colors[${i}] must be an object`); return; }
        if (typeof c.slot !== 'string' || c.slot.length === 0) errors.push(`colors[${i}].slot is required`);
        if (!isHexColor(c.hex)) errors.push(`colors[${i}].hex must be #rrggbb`);
      });
    }
  }

  // contrib — creation-lineage records (0..n).
  if (m.contrib !== undefined) {
    if (!Array.isArray(m.contrib)) {
      errors.push('contrib must be an array');
    } else {
      m.contrib.forEach((c, i) => {
        if (!c || typeof c !== 'object') { errors.push(`contrib[${i}] must be an object`); return; }
        if (typeof c.nappletDTag !== 'string' || c.nappletDTag.length === 0) {
          errors.push(`contrib[${i}].nappletDTag is required`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
