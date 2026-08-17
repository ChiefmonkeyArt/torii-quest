// arenaRuntime.js — the THREE-dependent arena runtime (v0.2.264, R2).
//
// R2 (lazy-load THREE behind ENTER ARENA): everything that imports three —
// scene/renderer, arena geometry, the game loop, players/bots/weapons/physics
// viewmodels, the in-world portal mesh + ToriiDebug — lives here, NOT in main.js.
// main.js (the shell / title screen) is three-free; it `await import()`s THIS
// module ONLY inside the ENTER ARENA handler, so the ~610 KB three-vendor chunk
// is deferred off first paint and paid on demand when the player actually enters.
//
// The module exports a factory: createArenaRuntime(hooks). The shell calls it
// once on first ENTER, then drives it via { boot, bootstrapPhysics, enter }.
// Shell-owned concerns (gateway-card worlds/handshake state, the ENTER button,
// the entry-status line) are injected as `hooks` so this runtime never reaches
// back into the shell's module scope.
import { state, isPlaying, isPaused, isLive, needsPointerLock, isReloading, transition, GAME_EVENT, resetRun } from './state.js';
import { emit, on, EV } from './events.js';
import { renderer, renderFrame, scene, camera, composer, bloomPass, sun } from './scene.js';
import { createQualityTier } from './engine/render/qualityTier.js';
import { createPerfHud } from './engine/render/perfHud.js';
import { createMuzzleFlashPool } from './engine/render/muzzleFlash.js';
import { initAtmosphere, tickAtmosphere } from './atmosphere.js';
import { buildArena } from './arena.js';
import { buildFoliage, tickFoliage, getGrassMat, getFlowerMat } from './arena-foliage.js';
import { tickSea } from './terrain/sea.js';
import { buildMirror, tickMirror, getMirror } from './mirror.js';
import { initLoop, startLoop } from './loop.js';
import { onKeyDown, requestLock, setYaw, setPitch, keys } from './input.js';
import { initPlayer, tickPlayer, tickDeath, playerObj, setPlayerBody, spawnPlayerBody, takeDamage, killPlayer, setNextSpawn, getPlayerCollider, resetPlayerPos, pickRespawnCorner, isPlayerOnGround, flyToggleFromInput, SPAWN_X, SPAWN_Z, SPAWN_YAW } from './player.js';
import { loadPlayerModel, tickPlayerModel, triggerHit, triggerDeath, triggerReload, setCharacter, getCharacter, setFlyHidden as setFlyHiddenPlayerModel } from './playerModel.js';
import { initPhysics, stepPhysics, buildArenaColliders, getWorld, castRay, castRayStatic, hasLineOfSight } from './physics.js';
import { bots, initBots, tickBots, hitBot, setBotNetMode, isBotNetMode, ingestBotState, applyBotShot, applyBotHit, applyBotKill } from './bots.js';
import { initWeapons, spawnBullet, tickWeapons, triggerRecoil, getLastHit, recordPlayerShot, getLastShot, getLastMiss } from './weapons.js';
import { buildDynamicCrates, tickDynamicCrates, getCrateSummary } from './dynamicCrates.js';
import { buildNapNpc, tickNapNpc } from './napNpc.js';
import { loadFirstPersonBody, tickFirstPersonBody, setFlyHidden as setFlyHiddenFirstPersonBody } from './firstPersonBody.js';
import { initTargetReticle, tickTargetReticle } from './targetReticle.js';
import { initHUD, tickHUD, flashCross, addKill, drawMinimap, setNapMode, showPortalPrompt, hidePortalPrompt, showFlyNotice } from './hud.js';
import { openGatewayScreen, closeGatewayScreen, isGatewayScreenOpen } from './engine/gateway/gatewayScreen.js';
import {
  ARENA_HALF, WALL_H, NAP_X, TRAVEL_GATE_X, TRAVEL_GATE_Z, VERSION, TUNING,
  MP_ENABLED, PLAYER_HP, SCORE_PUBLISH_ENABLED,
} from './config.js';
import { createMultiplayerHost } from './engine/multiplayer/multiplayerHost.js';
import { WS_STATE } from './engine/multiplayer/wsClient.js';
import { computeMoveVelocity } from './engine/multiplayer/moveVelocity.js';
import { shouldSendShot, buildShotPayload, createPeerCombat } from './engine/multiplayer/peerCombat.js';
import { getStoredToken, clearStoredToken } from './engine/multiplayer/sessionAuth.js';
import { createArenaLeaderboard } from './engine/multiplayer/arenaLeaderboard.js';
import { readLeaderboardEvents, buildScoreFilter } from './engine/nostr/leaderboardRelayRead.js';
import { RELAYS, fanoutReq } from './nostr.js';
import { assetUrl } from './assetUrl.js';
import { GAME_STATE_TO_CLIP } from './engine/animationLibrary.js';
import { spawnSpark, spawnRicochet } from './fx.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { createGatewayPortalBoundary } from './engine/gateway/gatewayPortalActivation.js';
import { createPortalTrigger } from './engine/gateway/portalTrigger.js';
import { buildPortalMesh, tickPortalMesh, setPortalApproach } from './engine/gateway/portalMesh.js';
import { portalApproachState } from './engine/gateway/portalApproach.js';
import { portalPromptLabel } from './engine/gateway/zoneLabel.js';
import { playShoot, playFootstep, playJumpLand, playSplash } from './audio.js';
import { sampleArenaHeight, sampleNapHeight } from './terrain/heightmap.js';
import { isNapLand } from './terrain/tomoeShape.js';
import { SEA_LEVEL } from './terrain/seaConfig.js';
import { initPlayerStats } from './playerStats.js';
import { installToriiDebug } from './engine/debug/toriiDebug.js';
import { getTimings as getBootTimings } from './engine/debug/bootTiming.js';
import { initFlyCamera, tickFly, enableFly, isFlyEnabled } from './engine/debug/flyCamera.js';
import { createToriiGateway } from './engine/components/toriiGateway.js';
import { mark, startPhase, endPhase } from './engine/debug/bootTiming.js';

// setCharacter is re-exported so the shell's character selector (three-free) can
// pick the player model WITHOUT statically importing playerModel.js (→ three).
// getCharacter is re-exported so main.js can apply the selection before boot(),
// and the MP host can read it when sending AUTH.
export { setCharacter, getCharacter };

// ── MP-1 peer-avatar template + factory ─────────────────────────────────────
// The peer avatar is loaded per-character (chiefmonkey6.glb or nostrich3.glb).
// Each character's template is loaded ONCE and cloned per peer (mirroring
// botModel.js): a single scene can't be added to multiple parents simultaneously,
// and SkinnedMesh needs its own bone binding per instance. All per-peer setup
// (feet offset, π facing, opaque materials, AnimationMixer + IDLE clip) is
// applied here.
const MP_PEER_IDLE_CLIP = 'Idle_03'; // chiefmonkey6 IDLE (see playerModel.js CHARACTERS.chiefmonkey)
const MP_EYE_OFFSET     = 1.7;       // sendMove sends eye-height Y; drop model feet to ground

// Per-character remote avatar config: GLB file + all clip names.
const MP_PEER_CHARACTERS = Object.freeze({
  chiefmonkey: {
    file: '/models/animation-library.glb',
    idle: 'Idle_02', walk: 'Stylish_Walk_inplace', run: 'Running',
    back: 'Walk_Backward', strafeL: 'Run_Forward_Firing', strafeR: 'Run_Forward_Firing',
    jump: 'Jump_Over_Obstacle_2',
    shoot: 'Run_Forward_Firing', hit: 'Hit_Reaction_to_Waist', death: 'Knock_Down',
    reload: 'Reload_Hand_Gun', melee: 'Melee_Left_Hand',
    victory: 'Victory_Cheer', land: 'Fall_from_Bar', fall: 'Fall2',
  },
  // nostrich uses the SAME master clip names as chiefmonkey: nostrich-master.glb
  // carries all 18 animation-library.glb clips retargeted onto the dense nostrich
  // rig (tools/glb_retarget.py). Natively Y-up, so no zup-to-yup axisFix applies.
  nostrich: {
    file: '/models/nostrich-master.glb',
    idle: 'Idle_02', walk: 'Stylish_Walk_inplace', run: 'Running',
    back: 'Walk_Backward', strafeL: 'Run_Forward_Firing', strafeR: 'Run_Forward_Firing',
    jump: 'Jump_Over_Obstacle_2',
    shoot: 'Run_Forward_Firing', hit: 'Hit_Reaction_to_Waist', death: 'Knock_Down',
    reload: 'Reload_Hand_Gun', melee: 'Melee_Left_Hand',
    victory: 'Victory_Cheer', land: 'Fall_from_Bar', fall: 'Fall2',
  },
});

// Scratch vectors for the relayed-peer-shot VISUAL cue (mp_shot). Reused each
// event so the inbound bridge stays allocation-free.
const _mpShotOrigin = new THREE.Vector3();
const _mpShotDir    = new THREE.Vector3();

// Cache: character key → { scene, clips, gMinY, promise }
const _mpTemplateCache = new Map();

// Shared gun GLB for remote avatars (loaded once, cloned per peer).
let _gunTemplate = null;
let _gunPromise = null;
function _loadGunTemplate() {
  if (_gunPromise) return _gunPromise;
  _gunPromise = new Promise((resolve, reject) => {
    const draco = new DRACOLoader();
    draco.setDecoderPath(assetUrl('/draco/'));
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(assetUrl('/gun-steampunk.glb'), (gltf) => {
      _gunTemplate = gltf.scene;
      resolve();
    }, undefined, reject);
  });
  return _gunPromise;
}

function _loadPeerTemplate(character) {
  character = character || 'chiefmonkey';
  if (_mpTemplateCache.has(character)) return _mpTemplateCache.get(character).promise;
  const cfg = MP_PEER_CHARACTERS[character] || MP_PEER_CHARACTERS.chiefmonkey;
  const entry = { scene: null, clips: [], gMinY: 0, axisFix: null, promise: null };
  _mpTemplateCache.set(character, entry);
  entry.promise = (async () => {
    const draco = new DRACOLoader();
    draco.setDecoderPath(assetUrl('/draco/'));
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    try {
      const gltf = await loader.loadAsync(assetUrl(cfg.file));
      entry.scene = gltf.scene;
      // Strip scale tracks from character clips.
      const availableClips = new Map((gltf.animations || []).map(clip => {
        const stripped = clip.clone();
        stripped.tracks = stripped.tracks.filter(t => t.name.endsWith('.scale') === false);
        return [stripped.name, stripped];
      }));
      entry.clips = [...availableClips.values()];
      // Compute geometry bounding box and detect Z-up coordinate system.
      let gMinY = Infinity, gMaxY = -Infinity;
      let gMinZ = Infinity, gMaxZ = -Infinity;
      entry.scene.traverse((o) => {
        if (o.isMesh && o.geometry) {
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          if (b) {
            gMinY = Math.min(gMinY, b.min.y); gMaxY = Math.max(gMaxY, b.max.y);
            gMinZ = Math.min(gMinZ, b.min.z); gMaxZ = Math.max(gMaxZ, b.max.z);
          }
        }
      });
      const isZUp = (gMaxZ - gMinZ) > (gMaxY - gMinY) * 1.2;
      if (isZUp) {
        entry.axisFix = 'zup-to-yup';
        gMinY = -gMaxZ; // after +90° X rotation, old Z range becomes Y
      }
      entry.gMinY = Number.isFinite(gMinY) ? gMinY : 0;
    } catch (err) {
      _mpTemplateCache.delete(character);
      throw err;
    }
  })();
  _mpTemplateCache.set(character, entry);
  return entry.promise;
}

// Pre-warm every peer character as soon as MP is up: fetch + Draco-decode the
// GLB (via _loadPeerTemplate) AND fully build one avatar into _mpWarmPool so a
// peer JOIN is shown on the very next frame instead of after seconds of
// clone/material/mixer/gun work. Fire-and-forget: a failure just leaves the
// pool empty and the join path builds cold (the pre-refactor behaviour).
function _prewarmPeerTemplates() {
  for (const key of Object.keys(MP_PEER_CHARACTERS)) {
    if (_mpWarmPool.has(key)) continue;
    _mpWarmPool.set(key, _buildPeerAvatarObject(key, null).catch((err) => {
      console.warn('[mp] avatar prewarm failed for', key, err);
      _mpWarmPool.delete(key); // let the join path build cold
      throw err;
    }));
  }
}

// Warm pool of FULLY-BUILT peer avatars (one per character), assembled in the
// background during _prewarmPeerTemplates so a peer JOIN can be shown on the
// very next frame. The expensive part of showing a peer is NOT the GLB fetch
// (SW cache-first, and warm after the first load) — it's the per-avatar build
// that used to run synchronously on the join path: skeletonClone, a full
// traverse re-materialising every mesh, computeBoundingBox, mixer.clipAction()
// for all 18 clips, and the gun bone-attach. That is several seconds of main-
// thread work AFTER the download. Pooling the built avatar moves it off the
// critical path; _createPeerAvatar then just hands the pooled instance over.
const _mpWarmPool = new Map(); // character -> ready Promise<obj>

// Build one peer avatar: a wrapper Group (remoteAvatars sets its position/rotation)
// containing a SkeletonUtils-cloned model offset so feet land on the ground given
// the eye-height Y peers broadcast, faced game-forward (-Z), with an IDLE mixer.
// peer is used ONLY for obj.userData.peerId; omit it for the anonymous warm
// instance (the join path stamps the real id in _createPeerAvatar).
async function _buildPeerAvatarObject(character, peer) {
  character = character || 'chiefmonkey';
  await _loadPeerTemplate(character);
  const tpl = _mpTemplateCache.get(character);
  const model = skeletonClone(tpl.scene);
  model.scale.setScalar(1.0);
  // Feet on ground: peers broadcast eye-height Y (playerObj.position.y ~= 1.7),
  // so the wrapper sits at eye height; drop the model by gMinY + eye offset.
  model.position.y = -tpl.gMinY - MP_EYE_OFFSET;
  // Face -Z (game forward). Use quaternions when Z-up fix is needed to avoid
  // Euler XYZ applying Y rotation in the wrong (post-X) frame.
  if (tpl.axisFix === 'zup-to-yup') {
    const standUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI/2);
    const turnAround = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI);
    model.quaternion.copy(turnAround).multiply(standUp);
  } else {
    model.rotation.y = Math.PI; // GLB faces +Z, game forward is -Z
  }

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      m.transparent = false;
      m.depthWrite  = true;
      m.alphaTest   = 0;
      if (m.flatShading) m.flatShading = false;
      m.needsUpdate = true;
    }
  });

  const mixer = new THREE.AnimationMixer(model);
  const cfg = MP_PEER_CHARACTERS[character] || MP_PEER_CHARACTERS.chiefmonkey;
  const FADE = 0.15;

  // Build action map from available clips.
  const actions = {};
  for (const c of tpl.clips) {
    actions[c.name] = mixer.clipAction(c);
    actions[c.name].setLoop(THREE.LoopRepeat, Infinity);
  }

  // Resolve idle + walk + run/back/strafe + one-shot actions (shoot/hit/death).
  // chiefmonkey AND nostrich both carry the master clip names, so both resolve
  // through GAME_STATE_TO_CLIP; cfg is the fallback for any clip not present.
  const useMasterTable = character === 'chiefmonkey' || character === 'nostrich';
  const resolveClip = (state) => {
    const libName = useMasterTable ? GAME_STATE_TO_CLIP[state] : null;
    return (libName && actions[libName]) || null;
  };
  const idleAction = resolveClip('IDLE') || actions[cfg.idle] || (tpl.clips.length ? actions[tpl.clips[0].name] : null);
  const walkAction = resolveClip('WALK') || actions[cfg.walk] || idleAction;
  const runAction = resolveClip('RUN') || actions[cfg.run] || null;
  const backAction = resolveClip('WALK_BACK') || actions[cfg.back] || null;
  const strafeLAction = resolveClip('STRAFE_LEFT') || actions[cfg.strafeL] || null;
  const strafeRAction = resolveClip('STRAFE_RIGHT') || actions[cfg.strafeR] || null;
  const jumpAction = resolveClip('JUMP') || actions[cfg.jump] || null;
  const shootAction = resolveClip('RUN_SHOOT') || actions[cfg.shoot] || null;
  const hitAction = resolveClip('HIT') || actions[cfg.hit] || null;
  const deathAction = resolveClip('DEATH') || actions[cfg.death] || null;
  if (!idleAction) {
    console.warn('[mp] no clips for', character);
  } else {
    idleAction.play();
    mixer.update(0.016); // leave bind-pose
  }

  // Locomotion state — switch between idle/walk/run/back/strafe based on
  // the anim hint from the MOVE message (mirrors local player's keyboard state).
  let currentClip = 'idle';
  let oneShot = null; // when set, overrides locomotion until it finishes

  // Map anim hint → action. Falls back to idle if the clip doesn't exist.
  function _actionFor(anim) {
    if (anim === 'walk') return walkAction;
    if (anim === 'runShoot') return shootAction || walkAction;
    if (anim === 'run') return runAction || walkAction;
    if (anim === 'back') return backAction || walkAction;
    if (anim === 'strafeL') return strafeLAction || walkAction;
    if (anim === 'strafeR') return strafeRAction || walkAction;
    if (anim === 'jump') return jumpAction || idleAction;
    return idleAction;
  }

  function _playRemote(anim) {
    if (oneShot || anim === currentClip) return;
    const next = _actionFor(anim);
    if (!next) return;
    const prev = _actionFor(currentClip);
    if (prev && prev !== next) prev.fadeOut(FADE);
    // Restore LoopRepeat: a clip previously used as a one-shot (shoot/hit)
    // keeps LoopOnce on its action and would freeze on its last frame here.
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.reset().fadeIn(FADE).play();
    currentClip = anim;
  }

  // One-shot animation (shoot/hit/death) — plays once, then returns to locomotion.
  function _playOneShot(action, returnTo) {
    if (!action) return;
    if (oneShot) { oneShot.fadeOut(0.1); }
    // Fade out locomotion
    const loco = currentClip === 'walk' ? walkAction : idleAction;
    if (loco) loco.fadeOut(FADE);
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(FADE).play();
    oneShot = action;
    // Schedule return to locomotion after the clip finishes (mixer.update will
    // eventually stop it; we check in obj.update via action.isRunning()).
    _oneShotReturn = returnTo || 'idle';
  }
  let _oneShotReturn = 'idle';

  // Find RightHand bone and attach a gun clone (same logic as playerModel.js
  // + weapons.js _attachWorldGun, but self-contained for remote avatars).
  _loadGunTemplate().then(() => {
    let rhBone = null;
    model.traverse(o => {
      if (rhBone || !o.isBone) return;
      const n = (o.name || '').toLowerCase();
      if (n.endsWith('righthand') || n.endsWith('right_hand') || n === 'righthand') rhBone = o;
    });
    if (!rhBone || !_gunTemplate) return;
    rhBone.updateWorldMatrix(true, false);
    const ws = new THREE.Vector3();
    rhBone.getWorldScale(ws);
    const inv = 1 / Math.max(ws.x, 1e-6);
    const wrap = new THREE.Group();
    wrap.scale.setScalar(inv);
    rhBone.add(wrap);
    const gun = _gunTemplate.clone(true);
    gun.scale.setScalar(0.22);
    gun.position.set(0.0, 0.16, -0.03);
    gun.rotation.set(Math.PI, -Math.PI / 2, Math.PI / 2);
    gun.rotateX(Math.PI);
    gun.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          m.transparent = false;
          m.depthWrite = true;
          m.alphaTest = 0;
          m.needsUpdate = true;
        }
      }
    });
    wrap.add(gun);
  }).catch(() => { /* gun is cosmetic — ignore load errors */ });

  const obj = new THREE.Group();
  obj.add(model);
  obj.userData.peerId = peer ? peer.id : null;
  // Driven per-frame by remoteAvatars.tick: position is set BEFORE update(),
  // and the sampled snapshot (with vel) is passed as the second arg.
  obj.update = (dt, snap) => {
    // Check if one-shot has finished → return to locomotion.
    if (oneShot && !oneShot.isRunning()) {
      oneShot = null;
      const ret = _oneShotReturn;
      currentClip = ''; // force re-evaluation
      _playRemote(snap && snap.anim ? snap.anim : ret);
    }
    // Non-death one-shots (shoot/hit) yield INSTANTLY to the peer's locomotion
    // hint — the avatar must track the peer's keyboard state, not play out its
    // full duration while the peer has already moved elsewhere. Death (and an
    // idle peer's hit reaction) still plays to completion. A hint that maps to
    // the SAME action (runShoot while the shoot one-shot runs) is left alone.
    if (oneShot && oneShot !== deathAction && snap && snap.anim && snap.anim !== 'idle') {
      const hinted = _actionFor(snap.anim);
      if (hinted && hinted !== oneShot) {
        oneShot.fadeOut(FADE);
        oneShot = null;
        currentClip = ''; // force re-evaluation
        _playRemote(snap.anim);
      }
    }
    if (dt > 0 && !oneShot && snap && snap.anim) {
      _playRemote(snap.anim);
    }
    mixer.update(dt);
  };
  // Event-driven one-shot animation triggers (called from _mpEmit).
  obj.triggerAnim = (type) => {
    if (type === 'shoot') _playOneShot(shootAction, 'idle');
    else if (type === 'hit') _playOneShot(hitAction, 'idle');
    else if (type === 'death') _playOneShot(deathAction, 'idle');
  };
  obj.dispose = () => {
    obj.update = null;
    obj.triggerAnim = null;
    model.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of mats) m.dispose?.();
      }
    });
  };
  return obj;
}

// Hand a peer avatar to the roster. Prefer a fully-built warm instance (built
// during prewarm) so the peer appears THIS frame; only build cold when the pool
// for that character is empty (two peers sharing one character, or prewarm still
// in flight). peerId is stamped onto the pooled object here.
async function _createPeerAvatar(peer) {
  const character = (peer && peer.character) || 'chiefmonkey';
  const warm = _mpWarmPool.get(character);
  if (warm) {
    _mpWarmPool.delete(character);
    const obj = await warm;
    obj.userData.peerId = peer.id;
    return obj;
  }
  return _buildPeerAvatarObject(character, peer);
}

// createArenaRuntime(hooks) — build the arena runtime. `boot()` runs the one-time
// three scene/loop bootstrap; `bootstrapPhysics()` lazy-loads Rapier + spawns the
// player body/models once; `enter()` starts a fresh run. Hooks (shell-owned):
//   showEntryStatus(msg)      — paint the title-screen entry-status line
//   resetEnterButton()        — restore the ENTER button to its idle label
//   getGatewayScreenState()   — { worlds, scanStatus, canTravel, onTravel } for the
//                               in-world (KeyF) gateway screen, sourced from the
//                               shell's live presence scan + handshake controller
export function createArenaRuntime(hooks = {}) {
  const showEntryStatus = typeof hooks.showEntryStatus === 'function' ? hooks.showEntryStatus : () => {};
  const resetEnterButton = typeof hooks.resetEnterButton === 'function' ? hooks.resetEnterButton : () => {};
  const onBootProgress = typeof hooks.onBootProgress === 'function' ? hooks.onBootProgress : () => {};
  const getGatewayScreenState = typeof hooks.getGatewayScreenState === 'function'
    ? hooks.getGatewayScreenState
    : () => ({ worlds: [], scanStatus: 'idle', canTravel: false, onTravel: () => {} });

  let _booted = false;
  // MP-1 multiplayer host — null unless MP_ENABLED is true at boot() time.
  // Ships false by default (see MP_1_SPEC.md §6): zero side effects, no ws dial,
  // no scene mutations. When enabled, the host owns the ws lifecycle + peer avatar
  // roster; the render loop only calls `_mp.tick(now)` and (throttled) `_mp.sendMove()`.
  let _mp = null;
  let _mpMoveAccum = 0;
  let _lastMovePos = null;
  let _mpMoveDt = 0;
  const MP_MOVE_HZ = 20;
  const MP_MOVE_INTERVAL = 1 / MP_MOVE_HZ;

  // v0.2.379-alpha: adaptive render-quality tier — a rolling frame-time monitor
  // that steps DPR, bloom, shadows, and muzzle-light budgets with hysteresis to
  // weaker hardware. Independent of MP (single-player + multiplayer behave the
  // same); no gameplay effect. The debug perf HUD reads its metrics snapshot but
  // only touches the DOM when window.__toriiPerf (or ToriiDebug.perf) is set.
  const _quality = createQualityTier({
    renderer,
    composer,
    bloomPass,
    window,
    onTierChange: (def) => {
      const size = def.shadowMapSize;
      renderer.shadowMap.enabled = size > 0;
      if (size <= 0) return;
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    },
  });
  let _muzzleFlashes = null;
  const _perfHud = createPerfHud({
    window,
    getMetrics: () => _quality.metrics(),
    getCounts: () => ({ bots: bots.length, peers: _mp ? _mp.roster.size : 0 }),
  });

  // v0.2.380-alpha: live in-arena leaderboard overlay (toggle: L / Tab).
  //  • LOCAL tab — server-authoritative live tallies fed from the mp_score frames
  //    the server now broadcasts on kill + a ~5s tick. 0 signer prompts, session-
  //    scoped, works with NO Nostr login (npubs come from the server).
  //  • GLOBAL tab — read-only Nostr relay read-back of published kind-30000 score
  //    events (fanoutReq over RELAYS → pure leaderboardRelayRead). No prompts.
  //  • PUBLISH footer — a proxy click on the already-wired #leaderboard-publish-btn
  //    (main.js). Opt-in only: one NIP-07 sign on click, never auto.
  const _arenaLb = createArenaLeaderboard({
    document,
    onPublish: () => {
      if (!SCORE_PUBLISH_ENABLED) return;
      try { document.getElementById('leaderboard-publish-btn')?.click(); } catch { /* noop */ }
    },
    canPublish: () => SCORE_PUBLISH_ENABLED
      && /^[0-9a-f]{64}$/.test(state.nostrPubkey || ''),
    fetchGlobal: async () => {
      try {
        const filter = buildScoreFilter({ limit: 50 });
        const { events, used } = await fanoutReq(RELAYS, filter, { timeoutMs: 4000, graceMs: 300 });
        const report = readLeaderboardEvents({ events });
        return { ok: used.length > 0 || report.rows.length > 0, rows: report.rows, count: report.count };
      } catch {
        return { ok: false, offline: true, rows: [] };
      }
    },
  });

  // ── In-world GATEWAY PORTAL trigger (v0.2.181) ───────────────────────────────
  // The composition-root boundary: the ONE place a real `window` is injected into
  // the v0.2.180 portal-activation seam. Proximity only ARMS the inert boundary +
  // raises the HUD prompt; the explicit KeyF interact opens the gateway screen.
  const _portalGateway = createToriiGateway({
    target: 'plebeian-market-bazaar',
    relay: 'wss://relay.example.com',
    position: { x: TRAVEL_GATE_X, y: sampleNapHeight(TRAVEL_GATE_X, TRAVEL_GATE_Z), z: TRAVEL_GATE_Z },
  });
  const _portalBoundary = createGatewayPortalBoundary({
    window,
    routeAllowlist: ['/#/zone/'],
    hostContext: {
      currentRoute: `${window.location?.pathname || '/'}${window.location?.hash || ''}`,
      rollbackRoute: `${window.location?.pathname || '/'}${window.location?.hash || ''}`,
    },
    home: '/',
  });
  const _portalTrigger = createPortalTrigger({
    boundary: _portalBoundary,
    component: _portalGateway,
    context: { title: 'Plebeian Market Bazaar', zoneType: 'shop', from: 'torii-quest' },
    portalPos: { x: TRAVEL_GATE_X, y: sampleNapHeight(TRAVEL_GATE_X, TRAVEL_GATE_Z), z: TRAVEL_GATE_Z },
    range: 3,
    promptText: portalPromptLabel({ slug: 'plebeian-market-bazaar' }),
    onPrompt: (show, text) => { if (show) showPortalPrompt(text); else hidePortalPrompt(); },
  });
  // Stable portal geometry reused each frame to drive the approach glow without
  // allocating (portalTrigger.portalPos() returns a fresh copy, so cache one here).
  const _portalPos = { x: TRAVEL_GATE_X, y: sampleNapHeight(TRAVEL_GATE_X, TRAVEL_GATE_Z), z: TRAVEL_GATE_Z };
  const _portalRange = 3;

  // ── In-world gateway screen (KeyF) ───────────────────────────────────────────
  function _openGatewayScreen() {
    if (isGatewayScreenOpen()) return;
    if (!transition(GAME_EVENT.PAUSE)) return; // PLAYING → PAUSED
    document.exitPointerLock?.();
    const gw = getGatewayScreenState();
    openGatewayScreen({
      worlds: gw.worlds,
      scanStatus: gw.scanStatus,
      canTravel: gw.canTravel,
      onTravel: (w) => gw.onTravel(w),
      onClose: () => _resume(),
    });
  }
  function _closeGatewayScreen() {
    closeGatewayScreen(); // triggers its onClose → _resume
  }

  function _openPause() {
    if (!transition(GAME_EVENT.PAUSE)) return;
    document.exitPointerLock?.();
  }
  function _resume() {
    if (!transition(GAME_EVENT.RESUME)) return;
    requestLock(renderer.domElement);
  }

  function _onLoopFatal() {
    showEntryStatus('⚠ Engine error — the arena stopped unexpectedly. Please reload the page.');
    resetEnterButton();
  }

  // ── Game loop state ──────────────────────────────────────────────────────────
  let _minimapTick = 0;
  let _firstFrameMarked = false;
  let _firstFrameEnded = false;
  // Sticky shoot-anim window: EV.SHOOT pushes this timestamp forward; the
  // shooting flag stays up for SHOOT_ANIM_WINDOW_MS after the last shot so
  // RUN_SHOOT actually reads (a single-frame flag was preempted by run/walk
  // on the very next frame, so the clip never played).
  let _shootUntil  = 0;
  const SHOOT_ANIM_WINDOW_MS = 400;
  let _isJumping   = false;
  let _prevOnGround = true;
  let _footAccum  = 0;
  const FOOT_WALK_INTERVAL = 0.45;
  const FOOT_RUN_INTERVAL  = 0.30;
  let _prevFootX = 0, _prevFootZ = 0, _footInit = false;
  const FOOT_MIN_SPEED = 1.5;

  function update(dt, frame) {
    // v0.2.112: step AFTER tickPlayer/tickBots set their kinematic targets but
    // BEFORE tickWeapons raycasts, so the bullet raycast hits THIS frame's poses.
    tickPlayer(dt);
    tickFly(dt);   // dev free-fly: no-op unless ToriiDebug.fly is enabled
    tickDeath(dt, renderer);
    tickBots(dt);
    if (isPlaying()) { stepPhysics(); tickDynamicCrates(); }
    tickWeapons(dt, playerObj.position);
    tickTargetReticle();
    // Grounded state comes straight from the Rapier character controller
    // (result.grounded), NOT an eye-height guess — the latter broke once the
    // terrain rose to ISLAND_BASE_Y + hills (eye Y was permanently above the old
    // EYE+0.12 threshold, so footsteps/jump-land never fired). The controller's
    // grounded flag already respects the slope-climb angle, so it stays correct
    // on the undulating heightfield and the bridge deck.
    const onGround = isPlayerOnGround();
    _isJumping = !onGround;
    if (onGround && !_prevOnGround) playJumpLand();
    _prevOnGround = onGround;

    const keyHeld =
      keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
      keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'];
    const pdx = playerObj.position.x - _prevFootX;
    const pdz = playerObj.position.z - _prevFootZ;
    const horizSpeed = _footInit && dt > 0 ? Math.sqrt(pdx*pdx + pdz*pdz) / dt : 0;
    _prevFootX = playerObj.position.x; _prevFootZ = playerObj.position.z; _footInit = true;
    if (isPlaying() && !isFlyEnabled() && onGround && keyHeld && horizSpeed > FOOT_MIN_SPEED) {
      const running = keys['ShiftLeft'] || keys['ShiftRight'];
      const interval = running ? FOOT_RUN_INTERVAL : FOOT_WALK_INTERVAL;
      _footAccum += dt;
      if (_footAccum >= interval) {
        _footAccum = 0;
        // On submerged ground (≤ SEA_LEVEL: the wadeable shelf / river) the step
        // is a splash; on dry land it's a footstep.
        const px = playerObj.position.x, pz = playerObj.position.z;
        const groundY = isNapLand(px, pz) ? sampleNapHeight(px, pz) : sampleArenaHeight(px, pz);
        if (groundY <= SEA_LEVEL) playSplash(); else playFootstep();
      }
    } else {
      _footAccum = 0;
    }

    const shootingNow = performance.now() < _shootUntil;
    tickPlayerModel(dt, shootingNow, isReloading(), _isJumping, !_isJumping);
    tickFirstPersonBody(dt);
    tickNapNpc(dt);
    setNapMode(isNapLand(playerObj.position.x, playerObj.position.z));
    if (isPlaying()) {
      _portalTrigger.tick(playerObj.position);
      // Drive the torii-frame glow from the graded approach affordance (pure scalar).
      const ap = portalApproachState({
        playerPos: playerObj.position, portalPos: _portalPos, range: _portalRange,
      });
      setPortalApproach(ap.intensity);
    } else {
      _portalTrigger.reset();
    }
    tickPortalMesh(dt);
    tickHUD(dt);
    tickAtmosphere(dt);
    tickMirror(dt);
    tickFoliage(dt);
    tickSea(dt);
    if (_muzzleFlashes) _muzzleFlashes.tick(dt);
    if (++_minimapTick >= 4) { _minimapTick = 0; drawMinimap(playerObj.position, bots); }
    // v0.2.264 (R2): the title-screen n2n handshake + presence polling moved to the
    // shell's own rAF ticker (main.js) — it must keep running before the arena (and
    // thus this loop) is ever booted. The game loop no longer polls them.
    // MP-1: tick peer avatars (interpolation) + throttle-broadcast our own MOVE.
    // No-op when MP_ENABLED is false (host is null). Uses the same dt we drove the
    // player with, so latency compensation matches the rest of the frame.
    if (_mp) {
      _mp.tick(performance.now());
      _mpMoveAccum += dt;
      _mpMoveDt += dt; // count EVERY frame so velocity = displacement / true elapsed
      if (isPlaying() && _mpMoveAccum >= MP_MOVE_INTERVAL) {
        _mpMoveAccum = 0;
        const px = playerObj.position.x;
        const py = playerObj.position.y;
        const pz = playerObj.position.z;
        const [vx, vy, vz] = computeMoveVelocity(
          [px, py, pz],
          _lastMovePos,
          _mpMoveDt,
        );
        _lastMovePos = [px, py, pz];
        _mpMoveDt = 0;
        // Compute local animation hint for remote peers (mirrors tickPlayerModel logic).
        const _fwd   = keys['KeyW'] || keys['ArrowUp'];
        const _back  = keys['KeyS'] || keys['ArrowDown'];
        const _left  = keys['KeyA'] || keys['ArrowLeft'];
        const _right = keys['KeyD'] || keys['ArrowRight'];
        const _run   = keys['ShiftLeft'] || keys['ShiftRight'];
        const _moving = _fwd || _back || _left || _right;
        let _anim = 'idle';
        if (_isJumping) _anim = 'jump';
        else if (_moving) {
          if (shootingNow && (_fwd || _run)) _anim = 'runShoot';
          else if (_back) _anim = 'back';
          else if ((_left || _right) && !_fwd && !_back) _anim = _left ? 'strafeL' : 'strafeR';
          else if (_run) _anim = 'run';
          else _anim = 'walk';
        }
        _mp.sendMove({
          pos: [px, py, pz],
          rot: [playerObj.rotation.y, 0],
          vel: [vx, vy, vz],
          anim: _anim,
        });
      }
    }
    // v0.2.379-alpha: feed the frame delta (ms) to the adaptive tier BEFORE the
    // render so any DPR/bloom change lands on this frame; sample renderer.info +
    // refresh the debug HUD AFTER (draw-call/triangle counts reflect the frame
    // just drawn). Both are cheap; the HUD does nothing unless its flag is set.
    _quality.update(dt * 1000);
    if (!_firstFrameMarked) {
      _firstFrameMarked = true;
      mark('first-frame');
      startPhase('first-render');
    }
    try {
      renderFrame(isLive());
    } catch (e) {
      console.warn('[render] frame skipped:', e.message);
    }
    if (_firstFrameMarked && !_firstFrameEnded) {
      _firstFrameEnded = true;
      endPhase('first-render');
    }
    _quality.sampleRenderInfo();
    _perfHud.update(performance.now());
  }

  // boot() — one-time synchronous three scene/loop bootstrap + handler wiring.
  // Safe to call once; subsequent calls are a no-op.
  async function boot() {
    if (_booted) return;
    _booted = true;
    mark('boot-start');

    // Helper: yield to the browser so the boot overlay can paint between
    // synchronous sub-steps. Double-rAF ensures a paint frame occurs.
    const _yieldPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Scene/world/HUD/entities — built once.
    startPhase('buildArena');
    buildArena();
    endPhase('buildArena');
    mark('boot-arena-done');
    onBootProgress(2); // 'Sculpting terrain…'
    await _yieldPaint();

    startPhase('initAtmosphere');
    initAtmosphere();
    endPhase('initAtmosphere');
    mark('boot-atmosphere-done');
    onBootProgress(3); // (still terrain/world)
    await _yieldPaint();

    startPhase('buildMirror');
    buildMirror();
    endPhase('buildMirror');
    mark('boot-mirror-done');
    await _yieldPaint();

    initHUD();
    initPlayerStats();
    initPlayer();
    mark('boot-player-done');
    onBootProgress(3); // update sub-label
    await _yieldPaint();

    initBots(playerObj, spawnBullet);
    mark('boot-bots-done');
    _muzzleFlashes = createMuzzleFlashPool(scene, {
      getQualityTier: () => _quality.currentTier(),
    });
    initWeapons(
      bots,
      takeDamage,
      getPlayerCollider,
      isBotNetMode,
      (impactPos) => _muzzleFlashes.trigger('impact', impactPos),
    );
    initTargetReticle({ bots, playerObj, getPlayerCollider });

    // Shoot wire: player emits EV.SHOOT → spawn bullet + recoil + SFX. Suppressed
    // entirely in the NAP zone (player.x > NAP_X) so the weapon reads as inert.
    on(EV.SHOOT, ({ origin, dir, aimOrigin, aimDir }) => {
      if (isNapLand(playerObj.position.x, playerObj.position.z)) return;
      const b = spawnBullet(origin, dir, true);
      _muzzleFlashes.trigger('muzzle', origin);
      if (aimOrigin && aimDir) {
        recordPlayerShot(b, aimOrigin.x, aimOrigin.y, aimOrigin.z, aimDir.x, aimDir.y, aimDir.z);
      }
      triggerRecoil();
      playShoot();
      // MP-2 peer combat (outbound): every arena shot reports to the authoritative
      // server, which ray-resolves it against lag-compensated peer snapshots and
      // no-ops when it hits no peer. Gate + payload live in the pure peerCombat
      // module (prefers the AIM ray so server hit-detection matches what the
      // shooter saw). Bot hits stay a separate client-side path — a shot may both
      // hit a bot locally AND resolve a peer hit server-side; that is expected.
      if (_mp && shouldSendShot({ playerX: playerObj.position.x, playerZ: playerObj.position.z, isNapLandFn: isNapLand, selfId: _mp.selfId })) {
        // v0.2.392 hit-reg: send RAW Date.now() as ts (logging only) PLUS the
        // client's measured viewLag. The server rewinds in its OWN clock frame
        // (server_now - viewLag) — the client clock is not synced to the server,
        // so a client timestamp can never index the server's snapshot rings.
        // viewLag = render interp delay + network one-way; rewinding by it tests
        // the collider where the shooter SAW the target, not where it now is.
        const viewLag = _mp.viewLagMs ? _mp.viewLagMs() : 0;
        const shot = buildShotPayload({ origin, dir, aimOrigin, aimDir }, Date.now(), viewLag);
        if (shot) _mp.sendShot(shot);
      }
    });
    on(EV.SHOOT, () => { _shootUntil = performance.now() + SHOOT_ANIM_WINDOW_MS; });

    on(EV.BOT_HIT_BY_PLAYER, ({ bot, dmg }) => {
      hitBot(bot, dmg);
      if (bot && bot.pos) _muzzleFlashes.trigger('botHit', bot.pos);
      flashCross();
    });
    window._onBotHit = (bot, dmg) => emit(EV.BOT_HIT_BY_PLAYER, { bot, dmg });

    on(EV.PLAYER_HIT,    () => triggerHit());
    on(EV.PLAYER_KILLED, () => {
      triggerDeath();
      // Respawn as far from the live bots as possible — decision logic owned by the
      // pure pickRespawnCorner in the player entity boundary (behaviour-identical to
      // the former inline corner scan).
      const best = pickRespawnCorner(bots.filter(b => b.alive).map(b => b.pos));
      setNextSpawn(best.x, best.z, best.yaw);
    });
    on(EV.HUD_UPDATE,    () => { if (isReloading()) triggerReload(); });

    installToriiDebug({
      version: VERSION, bots, hitBot, playerObj, resetPlayerPos,
      camera, setPitch,
      castRay, castRayStatic, hasLineOfSight, getWorld, getLastHit,
      getLastShot, getLastMiss,
      getGrassMat, getFlowerMat, getMirror,
      getPhase: () => state.phase,
      getState: () => ({
        hp: state.hp, ammo: state.ammo, kills: state.kills, deaths: state.deaths,
        hits: state.hits, sats: state.sats,
        reloading: state.reloading, pointerLocked: state.pointerLocked,
      }),
      getCrateSummary, config: TUNING,
      bootTiming: () => getBootTimings(),
    });

    // Dev free-fly camera — wire the live scene graph handles + a HUD/label sync
    // callback fired on every enable/disable (from F, ToriiDebug.fly, or ENTER).
    initFlyCamera({
      camera, scene, playerObj,
      onToggle: (on) => {
        state.flyMode = on;
        showFlyNotice(on ? 'Flight Mode ON' : 'Flight Mode OFF');
        // BUG 1: hide the player's own render bodies while flying so the free
        // camera can't see the avatar; restore prior visibility on disable.
        setFlyHiddenPlayerModel(on);
        setFlyHiddenFirstPersonBody(on);
        const btn = document.getElementById('btn-fly-toggle');
        if (btn) {
          btn.classList.toggle('is-on', on);
          btn.setAttribute('aria-checked', on ? 'true' : 'false');
          const st = btn.querySelector('.fly-switch-state');
          if (st) st.textContent = on ? 'ON' : 'OFF';
        }
      },
    });

    // Crosshair — show when pointer locked, hide when not.
    const _elCrosshair = document.getElementById('crosshair');
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) _elCrosshair?.classList.add('active');
      else _elCrosshair?.classList.remove('active');
    });

    // Canvas click → re-engage pointer lock when playing.
    renderer.domElement.addEventListener('click', () => {
      if (needsPointerLock()) requestLock(renderer.domElement);
    });

    // Visible in-world portal MARKER mesh (display-only; no collider/raycast/input).
    buildPortalMesh(scene, {
      position: _portalTrigger.portalPos(),
      range: _portalTrigger.range(),
      title: 'Plebeian Market Bazaar',
    }, renderer);

    // ESC — universal override: pause/resume both directions; closes the gateway
    // screen first when it is open. Capture phase so nothing swallows it first.
    let _escapeHandledOnKeyDown = false;
    document.addEventListener('keydown', e => {
      if (e.code !== 'Escape' || e.repeat) return;
      _escapeHandledOnKeyDown = true;
      if (isGatewayScreenOpen()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        _closeGatewayScreen();
        return;
      }
      if (isPlaying()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        _openPause();
      } else if (isPaused()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        _resume();
      }
    }, true);
    // Some browsers reserve the first Escape while pointer-locked and expose
    // only its keyup after releasing the lock. Treat that keyup as the same
    // pause gesture, but only when no keydown handler already processed it.
    document.addEventListener('keyup', e => {
      if (e.code !== 'Escape') return;
      const handled = _escapeHandledOnKeyDown;
      _escapeHandledOnKeyDown = false;
      if (!handled && isPlaying() && !document.pointerLockElement) {
        e.preventDefault();
        e.stopImmediatePropagation();
        _openPause();
      }
    }, true);

    // L / Tab — toggle the live in-arena leaderboard overlay (v0.2.380-alpha).
    // No collision with movement/interact keys (WASD/arrows/shift/space/E/R/F/C).
    // Tab's default focus-cycle is suppressed so it can't steal pointer focus.
    document.addEventListener('keydown', e => {
      if (e.repeat) return;
      if (e.code !== 'KeyL' && e.code !== 'Tab') return;
      if (!isPlaying() && !isPaused()) return;
      if (e.code === 'Tab') e.preventDefault();
      _arenaLb.toggle();
    }, false);

    // KeyF — dual role, mutually exclusive so one press never does both:
    //  • in range of the gateway (armed): open the in-world gateway screen;
    //  • otherwise, while playing: toggle the dev free-fly camera.
    onKeyDown(code => {
      if (code !== 'KeyF' || !isPlaying()) return;
      if (_portalTrigger.isArmed()) { _openGatewayScreen(); return; }
      // v2: the ground/air-aware fly orchestration lives in player.js (hop from
      // ground, stop-mid-air / glide handoff in the air).
      flyToggleFromInput();
    });

    const elResumeBtn = document.getElementById('btn-resume');
    const elHomeBtn   = document.getElementById('btn-home');
    elResumeBtn?.addEventListener('click', _resume);
    elHomeBtn?.addEventListener('click', () => {
      transition(GAME_EVENT.HOME);
      document.exitPointerLock?.();
      resetEnterButton();
    });

    // ── MP-1 multiplayer wiring (single seam) ───────────────────────────────────
    // The ONE place main.js/arenaRuntime.js wires the multiplayer subsystem, per
    // torii-quest-handoff.md §5. MP_ENABLED ships FALSE (see config.js + MP_1_SPEC.md
    // §6); flipping it to TRUE dials wss://<origin>/mp, joins the presence roster,
    // and starts syncing our own MOVE + relaying peer moves through the roster.
    if (MP_ENABLED) {
      // MP-2 (v0.2.366-alpha): server issues RESPAWN when this client is killed.
      // Handler warps the local body to the server-picked corner and heals to
      // PLAYER_HP. Non-respawn events are silently ignored — kept as one seam.
      // MP-2 peer combat (v0.2.374-alpha) — pure dispatcher for the relayed/
      // broadcast SHOT/HIT/KILL events. Peer SHOT is visual-only; HIT/KILL are
      // server-authoritative. The visual cue (muzzle burst + short tracer) keeps
      // three in this seam via spawnPeerShotFx.
      const _peerCombat = createPeerCombat({
        getSelfId: () => _mp && _mp.selfId,
        takeDamage,
        killPlayer,
        flashCross,
        addKill,
        state,
        onHudUpdate: () => emit(EV.HUD_UPDATE),
        spawnPeerShotFx: (origin, dir) => {
          _mpShotOrigin.set(origin[0], origin[1], origin[2]);
          _mpShotDir.set(dir[0], dir[1], dir[2]);
          _muzzleFlashes.trigger('muzzle', _mpShotOrigin);
          if (_mpShotDir.lengthSq() > 1e-8) _mpShotDir.normalize();
          spawnSpark(_mpShotOrigin, _mpShotDir);
          spawnRicochet(_mpShotOrigin, _mpShotDir);
        },
      });
      const _mpEmit = (name, payload) => {
        // Trigger remote avatar animations for combat events.
        if (_mp && payload) {
          const p0 = payload;
          if (name === 'mp_shot' && p0.id && p0.id !== _mp.selfId) {
            const entry = _mp.roster._peek(p0.id);
            if (entry && entry.obj && entry.obj.triggerAnim) entry.obj.triggerAnim('shoot');
          } else if (name === 'mp_hit' && p0.targetId && p0.targetId !== _mp.selfId) {
            const entry = _mp.roster._peek(p0.targetId);
            if (entry && entry.obj && entry.obj.triggerAnim) entry.obj.triggerAnim('hit');
          } else if (name === 'mp_kill' && p0.victimId && p0.victimId !== _mp.selfId) {
            const entry = _mp.roster._peek(p0.victimId);
            if (entry && entry.obj && entry.obj.triggerAnim) entry.obj.triggerAnim('death');
          }
        }
        if (_peerCombat(name, payload)) return;
        const p = payload || {};

        // Bot milestone chunk 2 (v0.2.379-alpha): server-authoritative bots. In MP
        // the client is RENDER-ONLY — flip bots.js into net mode on connect (stop
        // the local AI + ignore local damage) and drive it from the BOT_* stream.
        if (name === 'mp_state') {
          if (p.state === WS_STATE.CONNECTED) {
            setBotNetMode(true);
            // v0.2.529: Defer peer prewarm until after first visible frame — the
            // warm pool builds a full avatar (skeletonClone + traverse + mixer +
            // gun attach) per character, which is several seconds of main-thread
            // work. Peers joining before the pool is ready use cold-build fallback.
            requestAnimationFrame(() => requestAnimationFrame(() => {
              try { _prewarmPeerTemplates(); } catch (e) { console.warn('[mp] prewarm deferred failed:', e); }
            }));
          }
          else if (p.state === WS_STATE.CLOSED) setBotNetMode(false);
          return;
        }
        if (name === 'mp_stopped' || name === 'mp_disabled') { setBotNetMode(false); return; }
        // v0.2.380-alpha: server-authoritative live leaderboard tallies. Feed the
        // SCORE frame straight into the overlay; it re-renders only when open on
        // the LOCAL tab. Read-only — no signer, no prompts.
        if (name === 'mp_score') { _arenaLb.setLiveScore(p); emit(EV.SCORE_FRAME, p); return; }
        if (name === 'mp_botState') { ingestBotState(p.bots); return; }
        if (name === 'mp_botShot') {
          if (Array.isArray(p.origin)) {
            _mpShotOrigin.set(p.origin[0], p.origin[1], p.origin[2]);
            _muzzleFlashes.trigger('muzzle', _mpShotOrigin);
          }
          applyBotShot(p.origin, p.dir);
          return;
        }
        if (name === 'mp_botHit') {
          applyBotHit(p.botId, p.hp);
          if (_mp && p.shooterId === _mp.selfId) {
            for (let i = 0; i < bots.length; i++) {
              if (bots[i].state?.id === p.botId) {
                _muzzleFlashes.trigger('botHit', bots[i].pos);
                break;
              }
            }
            flashCross();
          }
          return;
        }
        if (name === 'mp_botKill') {
          applyBotKill(p.botId);
          // Score a bot frag only when WE landed the killing shot — mirror the
          // single-player kill side-effects (kills/sats/HUD) the sim doesn't own.
          if (_mp && p.shooterId === _mp.selfId) {
            state.kills++;
            state.sats += 5;
            emit(EV.BOT_KILLED, { sats: 5 });
            emit(EV.HUD_UPDATE);
          }
          return;
        }

        // MP-2 (v0.2.366-alpha): server issues RESPAWN when this client is killed —
        // warp the local body to the server-picked corner and heal to PLAYER_HP.
        if (name !== 'mp_respawn') return;
        if (!Array.isArray(p.pos)) return;
        const yaw = Array.isArray(p.rot) ? p.rot[0] : 0;
        setNextSpawn(p.pos[0], p.pos[2], yaw);
        resetPlayerPos();
        state.hp = typeof p.hp === 'number' ? p.hp : PLAYER_HP;
        emit(EV.HUD_UPDATE);
      };
      _mp = createMultiplayerHost({
        scene,
        emit: _mpEmit,
        now: () => performance.now(),
        // Load the per-character model for each peer (chiefmonkey6.glb or
        // nostrich3.glb). Returns a wrapper THREE.Group (feet on ground, faced
        // -Z, IDLE mixer, obj.update(dt)) with position/rotation/dispose().
        avatarLoader: (peer) => _createPeerAvatar(peer).catch((err) => {
          console.warn('[mp] avatar_load_error', peer?.id, err);
          throw err;
        }),
        // v0.2.375-alpha: prefer the server-issued session token (login signed
        // once via NIP-98) so arena entry / reconnect needs no signature. A
        // rejected/expired token is cleared so the reconnect falls back to NIP-42.
        getSessionToken: () => getStoredToken(),
        clearSessionToken: () => clearStoredToken(),
        // NIP-42 kind:22242 auth (FALLBACK) — the server verifies via nostr-tools.
        // The client signer is browser-only (window.nostr); only the signed event
        // is carried on the wire. Reached only when no session token is present.
        // getCharacter provides the active character key for AUTH/AUTH_TOKEN.
        getCharacter: () => getCharacter(),
        signAuth: async ({ challenge }) => {
          if (!globalThis.nostr || typeof globalThis.nostr.signEvent !== 'function') {
            throw new Error('multiplayer: NIP-07 signer unavailable');
          }
          const event = await globalThis.nostr.signEvent({
            kind: 22242,
            created_at: Math.floor(Date.now() / 1000),
            content: 'torii-quest-mp-1',
            tags: [['challenge', challenge]],
          });
          const npub = await globalThis.nostr.getPublicKey?.();
          return { npub, sig: event.sig, event };
        },
      });
      _mp.start();
    }

    // Render loop start (LAST — every binding update() touches is initialised now).
    await _yieldPaint();
    mark('boot-preloop');
    initLoop(update, _onLoopFatal);
    startLoop();
    mark('boot-end');
    onBootProgress(4); // 'Loading physics…' (next phase)
  }

  // bootstrapPhysics() — one-time lazy Rapier world + colliders + player body +
  // viewmodels. Async (Rapier WASM). Throws on failure; the shell ENTER handler
  // catches it and resets the button. Idempotent guard lives in the shell.
  // v0.2.277: step-level try/catch. The generic 'Arena failed to load' message
  // hid the real error. Each step now reports its name + e.message to entry-status
  // AND the console so the actual failure (which step, which error) is visible.
  async function bootstrapPhysics() {
    // Yield helper for paint between sync sub-steps.
    const _yieldPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const step = async (name, fn) => {
      try { await fn(); }
      catch (e) {
        const msg = `⚠ ${name} failed: ${e && e.message ? e.message : e}`;
        console.error('[bootstrap]', name, e);
        try { showEntryStatus(msg); } catch {}
        throw new Error(msg);
      }
    };
    startPhase('initPhysics');
    await step('initPhysics',       () => initPhysics());
    endPhase('initPhysics');
    onBootProgress(4); // 'Loading physics…'
    await _yieldPaint();

    startPhase('buildArenaColliders');
    await step('buildArenaColliders', () => buildArenaColliders());
    endPhase('buildArenaColliders');
    await _yieldPaint();

    await step('buildDynamicCrates', () => buildDynamicCrates());
    await _yieldPaint();
    let handle;
    await step('spawnPlayerBody', () => { handle = spawnPlayerBody(); });
    setPlayerBody(handle);
    onBootProgress(5); // 'Loading avatar…'
    await _yieldPaint();

    startPhase('loadPlayerModel');
    await step('loadPlayerModel',   () => loadPlayerModel(playerObj));
    endPhase('loadPlayerModel');
    onBootProgress(6); // 'Preparing world…'
    await _yieldPaint();

    await step('loadFirstPersonBody', () => loadFirstPersonBody(playerObj));
    // v0.2.529: Defer buildNapNpc until after the first visible frame — the NPC
    // is purely cosmetic (wanders the NAP zone, plays gestures). Its GLB loads
    // (chiefmonkey6.glb 1.2MB + chiefmonkey-npc-animations.glb 8.5MB) should NOT
    // compete for bandwidth/Draco workers during the critical entry path.
    // Kick it off fire-and-forget after a short delay (via rAF, NOT setTimeout —
    // constraint [3] forbids new setTimeout sites).
    // v0.2.545: Defer buildFoliage() too — 75K grass blades take ~7s to generate
    // on the CPU. Foliage is purely cosmetic and must not block the player from
    // entering the arena. Grass pops in a second or two after the first frame.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { buildFoliage(); } catch (e) { console.warn('[foliage] deferred build failed:', e); }
      try { buildNapNpc(); } catch (e) { console.warn('[napNpc] deferred build failed:', e); }
    }));
    mark('bootstrap-physics-end');
  }

  // enter() — start a fresh run: reset HP/ammo/score (resetRun), move the player to
  // the canonical SW spawn corner, face NE into the arena, then TITLE → PLAYING.
  // v0.2.275: an optional spawn override (set via setSpawnOverride) lets the
  // title-screen "ENTER NAP ZONE" button drop the player straight into the NAP
  // zone far-left corner instead of the SW arena corner. One-shot: consumed on use.
  let _spawnOverride = null;
  function setSpawnOverride(x, z, yaw) { _spawnOverride = { x, z, yaw }; }
  function enter() {
    resetRun();
    if (_spawnOverride) {
      setNextSpawn(_spawnOverride.x, _spawnOverride.z, _spawnOverride.yaw);
      setYaw(_spawnOverride.yaw);
      _spawnOverride = null; // one-shot
    } else {
      setNextSpawn(SPAWN_X, SPAWN_Z, SPAWN_YAW);
      setYaw(SPAWN_YAW);
    }
    resetPlayerPos();
    transition(GAME_EVENT.ENTER);
    requestLock(renderer.domElement);
    emit(EV.HUD_UPDATE);
    // Title→arena handoff: honour the title-screen FLY MODE toggle once the arena
    // is live. Only enable (never force-disable) so an in-game toggle isn't undone.
    // F1: spawn already in the sky above the arena centre, looking down.
    if (state.flyMode && !isFlyEnabled()) enableFly({ atSky: true });
  }

  // MP-1 cross-instance travel seam: the shell calls this in _executeJump before
  // window.location.href navigates away, so the server-side close is graceful and
  // peers see us LEFT immediately instead of after a ping-timeout gap.
  function stopMultiplayer(reason = 'travel') {
    if (_mp) { try { _mp.stop(reason); } catch {} _mp = null; }
    // v0.2.380-alpha: tear the leaderboard overlay down on arena exit / travel.
    try { _arenaLb.destroy(); } catch { /* noop */ }
  }

  return { boot, bootstrapPhysics, enter, setCharacter, setSpawnOverride, stopMultiplayer };
}
