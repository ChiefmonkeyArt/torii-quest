import { assetUrl } from '../assetUrl.js';

const ANIMATION_LIBRARY_URL = '/models/animation-library.glb';

let _libraryPromise = null;
let _clips = null;

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
    for (const clip of gltf.animations || []) {
      const stripped = clip.clone();
      stripped.tracks = stripped.tracks.filter((track) => !track.name.endsWith('.scale'));
      _clips.set(stripped.name, stripped);
    }
    return _clips;
  });

  return _libraryPromise;
}

export function getClip(name) {
  return _clips?.get(name) || null;
}

export function getAllClipNames() {
  return _clips ? [..._clips.keys()] : [];
}
