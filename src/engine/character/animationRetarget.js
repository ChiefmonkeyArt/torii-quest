// engine/character/animationRetarget.js — runtime bone-name retargeting: take
// the animation-library clips (authored on ONE convention, Mixamo) and redrive
// them onto an arbitrary uploaded humanoid skeleton (Tripo / Meshy / Biped /
// generic) by remapping each track's bone through the canonical role contract
// (skeleton.js `mapBonesToRoles`). Pure + node-safe — no THREE import, no DOM.
//
// This is the runtime half of the Character Forge auto-rigger. The validator
// (assessRig) only CONFIRMS a mesh is riggable; this module is what actually
// MAKES it animate. It is deliberately pure so a clip can be retargeted in a
// unit test with plain mock clip/track objects.

import { mapBonesToRoles } from './skeleton.js';

// trackBoneOf('mixamorigHips.position') → 'mixamorigHips'; returns the bone
// component before the trailing property suffix ('.position' / '.quaternion' /
// '.scale'). A name with no property suffix is returned unchanged.
export function trackBoneOf(name) {
  const n = typeof name === 'string' ? name : '';
  const dot = n.lastIndexOf('.');
  return dot > 0 ? n.slice(0, dot) : n;
}

// buildBoneRebind(libraryBoneNames, targetBoneNames) → Map<libBone, targetBone>.
// Maps library-side bone names onto the target skeleton's bone names via their
// shared canonical roles: both are reduced through `mapBonesToRoles`, then each
// role present on BOTH sides yields a library→target name edge. Roles unmapped
// on either side are simply skipped (optional roles like toes/shoulders degrade
// gracefully). Returns an empty Map when nothing intersects (unriggable target).
export function buildBoneRebind(libraryBoneNames, targetBoneNames) {
  const lib = mapBonesToRoles(libraryBoneNames);
  const tgt = mapBonesToRoles(targetBoneNames);
  const rebind = new Map();
  for (const role of Object.keys(lib.mapped)) {
    if (tgt.mapped && tgt.mapped[role]) rebind.set(lib.mapped[role], tgt.mapped[role]);
  }
  return rebind;
}

// remapTrackName('mixamorigHips.position', rebind) → 'Hip.position' (the SAME
// animation data, a DIFFERENT bone name), or null when the bone has no target
// mapping (optional role absent on the target skeleton) — callers drop those.
export function remapTrackName(name, rebind) {
  const bone = trackBoneOf(name);
  if (!bone || !rebind || !rebind.has(bone)) return null;
  const prop = name.slice(bone.length);
  return rebind.get(bone) + prop;
}

// retargetClip(clip, rebind) → a new clip. Duck-typed (no THREE import): calls
// clip.clone() then rewrites each track's name through remapTrackName, dropping
// tracks whose bone has no target. Returns null for a non-cloneable input.
// Track VALUES are untouched — only the bone a property is bound to changes.
export function retargetClip(clip, rebind) {
  if (!clip || typeof clip.clone !== 'function' || !Array.isArray(clip.tracks)) return null;
  const out = clip.clone();
  const kept = [];
  for (const t of out.tracks) {
    const remapped = remapTrackName(t.name, rebind);
    if (remapped) {
      t.name = remapped;
      kept.push(t);
    }
  }
  out.tracks = kept;
  return out;
}

// collectTrackBoneNames(clips) → the distinct bone names referenced by a
// clip collection (an Array, or a Map of name→clip, or a single clip) — used to
// derive the library side of the rebind from the library's own clips rather
// than hardcoding a convention.
export function collectTrackBoneNames(clips) {
  const list = (clips instanceof Map)
    ? [...clips.values()]
    : (Array.isArray(clips) ? clips : [clips]);
  const names = [];
  const seen = new Set();
  for (const clip of list) {
    if (!clip || !Array.isArray(clip.tracks)) continue;
    for (const t of clip.tracks) {
      const bone = trackBoneOf(t.name);
      if (bone && !seen.has(bone)) {
        seen.add(bone);
        names.push(bone);
      }
    }
  }
  return names;
}