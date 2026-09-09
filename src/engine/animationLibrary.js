import { assetUrl } from '../assetUrl.js';

const ANIMATION_LIBRARY_URL = '/models/animation-library.glb';

let _libraryPromise = null;
let _clips = null;
let _bones = null; // THREE.Bone[] of the library rig (master bind pose) — see getAnimationLibraryBones()

export const GAME_STATE_TO_CLIP = Object.freeze({
  IDLE: 'Idle_02',
  WALK: 'Stylish_Walk_inplace',
  WALK_BACK: 'Walk_Backward',
  RUN: 'Running',
  RUN_SHOOT: 'Run_Forward_Firing',
  RUN_BACK: 'Run_Backward',
  STRAFE_LEFT: 'Run_Forward_Firing',
  STRAFE_RIGHT: 'Run_Forward_Firing',
  RUN_BACK_SHOOT: 'Walk_Backward_with_Gun_1',
  JUMP: 'Jump_Over_Obstacle_2',
  RELOAD: 'Reload_Hand_Gun',
  HIT: 'Hit_Reaction_to_Waist',
  DEATH: 'Knock_Down',
  DANCE: 'FunnyDancing_02',
  VICTORY: 'Victory_Cheer',
  MELEE: 'Melee_Left_Hand',
  LAND: 'Fall_from_Bar',
  FALL: 'Fall2',
  SPAWN: 'Fall_from_Bar',
});

export async function loadAnimationLibrary(loader) {
  if (_libraryPromise) return _libraryPromise;

  _libraryPromise = loader.loadAsync(assetUrl(ANIMATION_LIBRARY_URL)).then((gltf) => {
    _clips = new Map();
    _bones = _collectBones(gltf.scene);
    for (const clip of gltf.animations || []) {
      const stripped = clip.clone();
      stripped.tracks = stripped.tracks.filter((track) => !track.name.endsWith('.scale'));
      _clips.set(stripped.name, stripped);
    }
    return _clips;
  });

  return _libraryPromise;
}

// getAnimationLibraryBones() → the library rig's THREE.Bone[] (master bind pose),
// or null until loadAnimationLibrary resolves. Used by the world-delta retargeter
// (retargetWorldDelta.buildRigBind) to cancel the master's Z-up rest.
export function getAnimationLibraryBones() {
  return _bones;
}

function _collectBones(scene) {
  const bones = [];
  const seen = new Set();
  if (scene && typeof scene.traverse === 'function') {
    scene.traverse((o) => {
      if (o && o.isSkinnedMesh && o.skeleton && Array.isArray(o.skeleton.bones)) {
        for (const b of o.skeleton.bones) if (b && !seen.has(b)) { seen.add(b); bones.push(b); }
      }
    });
  }
  return bones;
}

export function getClip(name) {
  return _clips?.get(name) || null;
}

export function getAllClipNames() {
  return _clips ? [..._clips.keys()] : [];
}
