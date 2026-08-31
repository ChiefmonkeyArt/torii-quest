// engine/character/rigAssessment.js — assess whether a humanoid GLB's skeleton
// can be auto-rigged onto the canonical Torii skeleton. Pure, node-safe.
//
// This is the "validator" half of the Character Forge: it takes a list of bone
// names (read from a third-party GLB) and reports whether the auto-rigger can
// map it, what's missing, and what convention it is. It does NOT touch the
// mesh — it only reasons about the skeleton contract (skeleton.js).

import { mapBonesToRoles, REQUIRED_ROLES } from './skeleton.js';

export const RIG_ASSESSMENT_VERSION = 1;

// Verdicts:
//   'riggable'           — every required role maps; auto-rig can proceed.
//   'partial'            — a known convention but some required roles missing.
//   'unknown-convention' — bones present but no known name table matches.
//   'no-bones'           — no bones at all (unrigged/static mesh).

// assessRig(boneNames, opts) → verdict object. `boneNames` is an array of
// strings (the GLB skeleton's bone names). Pure and allocation-safe.
export function assessRig(boneNames, opts = {}) {
  const names = Array.isArray(boneNames) ? boneNames.map((n) => String(n)) : [];
  const { convention, mapped, missing, requiredMissing, extra } = mapBonesToRoles(names);
  const notes = [];
  let verdict;

  if (names.length === 0) {
    verdict = 'no-bones';
    notes.push('No bones found — the mesh is unrigged/static. Auto-rig would need a generated skeleton, which is out of scope for v1.');
  } else if (convention === 'unknown') {
    verdict = 'unknown-convention';
    notes.push('Bone names do not match a known convention (Mixamo/Biped). Cannot auto-map without a custom name table.');
  } else if (requiredMissing.length === 0) {
    verdict = 'riggable';
    notes.push(`All ${REQUIRED_ROLES.length} required roles present (${convention} convention).`);
  } else {
    verdict = 'partial';
    notes.push(`Missing required roles: ${requiredMissing.join(', ')}.`);
  }

  if (extra.length > 0) {
    notes.push(`${extra.length} bone(s) matched no role and will be ignored.`);
  }
  if (missing.length > requiredMissing.length) {
    notes.push(`${missing.length - requiredMissing.length} optional role(s) absent (will degrade gracefully).`);
  }

  return {
    verdict,
    convention,
    mapped,
    missing,
    requiredMissing,
    extra,
    notes,
    boneCount: names.length,
  };
}

// canAutoRig(boneNames) → boolean. Convenience: true only for a clean 'riggable'.
export function canAutoRig(boneNames) {
  return assessRig(boneNames).verdict === 'riggable';
}
