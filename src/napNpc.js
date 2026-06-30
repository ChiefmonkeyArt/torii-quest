// napNpc.js — peaceful Chiefmonkey NPC standing in the NAP zone (v0.2.107).
// Past the torii gate the player is disarmed and bots can't follow; a friendly
// Chiefmonkey idles there as a landmark. No collider — purely decorative.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene } from './scene.js';

let _root  = null;
let _mixer = null;

// Placed clear of the bonsai trunk (which sits at x=NAP_X+6=26, z=0) so the NPC
// no longer reads as walking into the tree. Off the central walkway, facing the
// gate to greet the incoming player.
const NPC_X = 30;
const NPC_Z = 5;

export function buildNapNpc() {
  if (_root) return; // already built

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load('/chiefmonkey6.glb', gltf => {
    _root = gltf.scene;

    // Metre-scale GLB — render at 1.0 like the player model. Measure geometry-only
    // minY (Box3.setFromObject is wrong for SkinnedMesh) to seat the feet exactly.
    let minY = Infinity;
    _root.traverse(o => {
      if (o.isMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) minY = Math.min(minY, b.min.y);
        o.castShadow = true;
        o.frustumCulled = false;
        // v0.2.111: same opaque material patch the player/FP body use. Without it
        // the GLB's alphaMode:BLEND made the skinned mesh split/tear at distance.
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m.transparent = false;
            m.depthWrite  = true;
            m.alphaTest   = 0;
            m.needsUpdate = true;
          }
        }
      }
    });
    if (!Number.isFinite(minY)) minY = 0;

    _root.scale.setScalar(1.0);
    _root.position.set(NPC_X, -minY, NPC_Z);
    _root.rotation.y = -Math.PI / 2; // face back toward the gate
    scene.add(_root);

    _mixer = new THREE.AnimationMixer(_root);
    const byName = {};
    gltf.animations.forEach(c => { byName[c.name] = c; });
    // Prefer a standing idle so the peaceful NPC is no longer churning its legs
    // (which read as "walking into the tree"). Fall back to the in-place walk,
    // then any clip, so it's never frozen in a T-pose.
    const clip = byName['Idle_03'] || byName['Idle_11'] || byName['Idle'] ||
                 byName['Stylish_Walk_inplace'] || gltf.animations[0];
    if (clip) {
      const a = _mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
    }
  }, undefined, err => {
    console.warn('[napNpc] load failed:', err);
  });
}

export function tickNapNpc(dt) {
  if (_mixer) _mixer.update(dt);
}
