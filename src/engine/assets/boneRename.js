// engine/assets/boneRename.js — canonical Mixamo bone-name normalisation.
//
// Torii's Meshy-authored GLBs use Biped-style spine/head names (Spine01,
// Spine02, neck, head_end) that differ from the gaming-industry Mixamo
// convention (Spine1, Spine2, Neck, HeadTop_End). This module renames bones —
// and the animation tracks that reference them by name — to Mixamo-canonical
// form on load, so every asset interoperates with other Mixamo-based worlds.
//
// Pure: no Three/Rapier/DOM import. It relies on the Object3D.traverse +
// Bone.isBone shape and the AnimationClip.tracks shape at runtime, so it is
// unit-testable in plain node with fake objects.

// Meshy → Mixamo rename map. `headfront` is intentionally NOT mapped: it has
// no Mixamo equivalent and is a non-deforming forehead marker, so it is left
// in place rather than removed (removing a bone would disturb skin joint
// indices). Extra bones are harmless to Mixamo consumers, which ignore them.
export const MIXAMO_BONE_RENAME = Object.freeze({
  Spine01: 'Spine1',
  Spine02: 'Spine2',
  neck: 'Neck',
  head_end: 'HeadTop_End',
});

// Map a single bone name to its Mixamo-canonical form (identity if unknown).
export function mixamoBoneName(name) {
  return MIXAMO_BONE_RENAME[name] || name;
}

// Rename a loaded glTF's bones and animation tracks to Mixamo-canonical names.
// Accepts a gltf-like `{ scene, animations }` object or a bare scene. Returns
// the number of names changed (bones + tracks). Idempotent: already-canonical
// assets are a no-op.
export function renameBonesToMixamo(gltf, map = MIXAMO_BONE_RENAME) {
  const scene = gltf && gltf.scene ? gltf.scene : gltf;
  const animations = gltf && gltf.animations ? gltf.animations : [];
  let renamed = 0;

  if (scene && typeof scene.traverse === 'function') {
    scene.traverse((obj) => {
      if (obj.isBone && map[obj.name]) {
        obj.name = map[obj.name];
        renamed += 1;
      }
    });
  }

  for (const clip of animations) {
    if (!clip || !Array.isArray(clip.tracks)) continue;
    for (const track of clip.tracks) {
      const dot = track.name.indexOf('.');
      const bone = dot === -1 ? track.name : track.name.slice(0, dot);
      if (map[bone]) {
        track.name = map[bone] + (dot === -1 ? '' : track.name.slice(dot));
        renamed += 1;
      }
    }
  }

  return renamed;
}
