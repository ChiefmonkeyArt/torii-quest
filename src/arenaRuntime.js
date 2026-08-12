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
import { tickFoliage, getGrassMat, getFlowerMat } from './arena-foliage.js';
import { tickSea } from './terrain/sea.js';
import { buildMirror, tickMirror, getMirror } from './mirror.js';
import { initLoop, startLoop } from './loop.js';
import { onKeyDown, requestLock, setYaw, setPitch, keys } from './input.js';
import { initPlayer, tickPlayer, playerObj, setPlayerBody, spawnPlayerBody, setNextSpawn, getPlayerCollider, resetPlayerPos, isPlayerOnGround, flyToggleFromInput, SPAWN_X, SPAWN_Z, SPAWN_YAW } from './player.js';
import { CHARACTERS, getCharacter, loadPlayerModel, tickPlayerModel, triggerHit, triggerDeath, triggerReload, setCharacter, setFlyHidden as setFlyHiddenPlayerModel } from './playerModel.js';
import { initPhysics, stepPhysics, buildArenaColliders, getWorld, castRay, castRayStatic, hasLineOfSight } from './physics.js';
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
import { SEA_LEVEL } from './terrain/seaConfig.js';
import { initPlayerStats } from './playerStats.js';
import { installToriiDebug } from './engine/debug/toriiDebug.js';
import { initFlyCamera, tickFly, enableFly, isFlyEnabled } from './engine/debug/flyCamera.js';
import { createToriiGateway } from './engine/components/toriiGateway.js';
import { loadWorld } from './engine/world/worldLoader.js';
import { createArenaShooterMode } from './engine/modes/arena-shooter.js';
import defaultWorldUrl from '../worlds/default/world.json?url';

// setCharacter is re-exported so the shell's character selector (three-free) can
// pick the player model WITHOUT statically importing playerModel.js (→ three).
export { setCharacter };

// ── MP-1 peer-avatar template + factory ─────────────────────────────────────
// Each character model is loaded once and cloned per
// peer (mirroring botModel.js): a single scene can't be added to multiple parents
// and SkinnedMesh needs its own bone binding per instance. All per-peer setup that
// playerModel.js/botModel.js apply (feet offset, π facing, opaque materials,
// AnimationMixer + movement clips) is applied here — the raw gltf.scene is authored high
// off its origin (large gMinY), faces +Z, and sits in bind-pose (T-pose), so a raw
// return renders peers high in the sky, backwards, and un-animated.
const MP_EYE_OFFSET     = 1.7;       // sendMove sends eye-height Y; drop model feet to ground
const MP_WALK_THRESHOLD = 0.5;
const MP_ANIM_FADE      = 0.2;

// Scratch vectors for the relayed-peer-shot VISUAL cue (mp_shot). Reused each
// event so the inbound bridge stays allocation-free.
const _mpShotOrigin = new THREE.Vector3();
const _mpShotDir    = new THREE.Vector3();

let _createPeerWorldGun = null; // lazy-loaded from weapons.js

const _mpTemplateCache = new Map();

function _loadPeerTemplate(characterKey) {
  const cached = _mpTemplateCache.get(characterKey);
  if (cached) return cached.promise;

  const template = { scene: null, clips: [], gMinY: 0, promise: null };
  template.promise = new Promise((resolve, reject) => {
    const draco = new DRACOLoader();
    draco.setDecoderPath(assetUrl('/draco/'));
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(assetUrl(CHARACTERS[characterKey].file), (gltf) => {
      template.scene = gltf.scene;
      // Strip scale tracks — Meshy.ai GLBs include scale on every bone,
      // causing visual blips during transitions and at loop boundaries.
      template.clips = (gltf.animations || []).map(clip => {
        const stripped = clip.clone();
        stripped.tracks = stripped.tracks.filter(t => t.name.endsWith('.scale') === false);
        return stripped;
      });
      // Geometry-only bounds (Box3.setFromObject inflates via bone hierarchy on
      // SkinnedMesh) — playerModel.js:93-101.
      let gMinY = Infinity;
      template.scene.traverse((o) => {
        if (o.isMesh && o.geometry) {
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          if (b) gMinY = Math.min(gMinY, b.min.y);
        }
      });
      template.gMinY = Number.isFinite(gMinY) ? gMinY : 0;
      resolve(template);
    }, undefined, (err) => {
      _mpTemplateCache.delete(characterKey);
      reject(err);
    });
  });
  _mpTemplateCache.set(characterKey, template);
  return template.promise;
}

// Build one peer avatar: a wrapper Group (remoteAvatars sets its position/rotation)
// containing a SkeletonUtils-cloned model offset so feet land on the ground given
// the eye-height Y peers broadcast, faced game-forward (-Z), with an IDLE mixer.
async function _createPeerAvatar(peer) {
  const characterKey = CHARACTERS[peer.character] ? peer.character : 'chiefmonkey';
  const character = CHARACTERS[characterKey];
  const template = await _loadPeerTemplate(characterKey);
  const model = skeletonClone(template.scene);
  model.scale.setScalar(1.0);
  // Feet on ground: peers broadcast eye-height Y (playerObj.position.y ≈ 1.7),
  // so the wrapper sits at eye height; drop the model by gMinY + eye offset.
  model.position.y = -template.gMinY - MP_EYE_OFFSET;
  model.rotation.y = Math.PI; // GLB faces +Z, game forward is -Z

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // bind-pose cull box clips animated SkinnedMesh
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
  let idleClip = template.clips.find((c) => c.name === character.anims.IDLE);
  if (!idleClip && template.clips.length) {
    idleClip = template.clips[0];
    console.warn('[mp] idle clip', character.anims.IDLE, 'missing; falling back to', idleClip.name);
  }
  const walkClip = template.clips.find((c) => c.name === character.anims.WALK);
  const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
  const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
  if (idleAction) {
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.play();
    mixer.update(0.016); // tick once so the skeleton leaves bind-pose (no T-pose flash)
  }
  if (walkAction) walkAction.setLoop(THREE.LoopRepeat, Infinity);

  // Attach the world gun to the RightHand bone (same as playerModel.js does
  // for the local player). The gun GLB loads async in weapons.js — if it
  // hasn't loaded yet, createPeerWorldGun returns null and the peer just
  // has no visible gun until a re-join triggers _createPeerAvatar again.
  let peerGunWrap = null;
  let _rh = null;
  model.traverse(o => {
    if (_rh || !o.isBone) return;
    const n = (o.name || '').toLowerCase();
    if (n.endsWith('righthand') || n.endsWith('right_hand') || n === 'righthand') _rh = o;
  });
  if (_rh) {
    if (!_createPeerWorldGun) _createPeerWorldGun = (await import('./weapons.js')).createPeerWorldGun;
    peerGunWrap = _createPeerWorldGun(_rh);
    if (!peerGunWrap) console.warn('[mp] peer gun not attached yet — gun GLB still loading');
  } else {
    console.warn('[mp] RightHand bone not found for character', characterKey);
  }

  const obj = new THREE.Group();
  obj.add(model);
  obj.userData.peerId = peer.id;
  obj.userData.character = characterKey;
  obj.userData.mixer = mixer;
  obj.userData.idleAction = idleAction;
  obj.userData.walkAction = walkAction;
  let moving = false;
  let hasLastPos = false;
  const lastPos = new THREE.Vector3();
  obj.update = (dt) => {
    if (dt > 0 && hasLastPos && idleAction && walkAction) {
      const speed = obj.position.distanceTo(lastPos) / dt;
      const nextMoving = speed > MP_WALK_THRESHOLD;
      if (nextMoving !== moving) {
        const next = nextMoving ? walkAction : idleAction;
        const prev = nextMoving ? idleAction : walkAction;
        next.reset().fadeIn(MP_ANIM_FADE).play();
        prev.fadeOut(MP_ANIM_FADE);
        moving = nextMoving;
      }
    }
    lastPos.copy(obj.position);
    hasLastPos = true;
    mixer.update(dt);
  };
  obj.dispose = () => {
    obj.update = null;
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    if (peerGunWrap && peerGunWrap.parent) peerGunWrap.parent.remove(peerGunWrap);
  };
  return obj;
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
  const getGatewayScreenState = typeof hooks.getGatewayScreenState === 'function'
    ? hooks.getGatewayScreenState
    : () => ({ worlds: [], scanStatus: 'idle', canTravel: false, onTravel: () => {} });

  let _booted = false;
  let _world = null;
  const _mode = createArenaShooterMode();
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
    getCounts: () => ({ bots: _mode.bots.length, peers: _mp ? _mp.roster.size : 0 }),
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
    position: { x: TRAVEL_GATE_X, y: 0, z: TRAVEL_GATE_Z },
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
    portalPos: { x: TRAVEL_GATE_X, y: 0, z: TRAVEL_GATE_Z },
    range: 3,
    promptText: portalPromptLabel({ slug: 'plebeian-market-bazaar' }),
    onPrompt: (show, text) => { if (show) showPortalPrompt(text); else hidePortalPrompt(); },
  });
  // Stable portal geometry reused each frame to drive the approach glow without
  // allocating (portalTrigger.portalPos() returns a fresh copy, so cache one here).
  const _portalPos = { x: TRAVEL_GATE_X, y: 0, z: TRAVEL_GATE_Z };
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
  let _isShooting  = false;
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
    _mode.tick(dt, performance.now());
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
        const groundY = px > NAP_X ? sampleNapHeight(px, pz) : sampleArenaHeight(px, pz);
        if (groundY <= SEA_LEVEL) playSplash(); else playFootstep();
      }
    } else {
      _footAccum = 0;
    }

    tickPlayerModel(dt, _isShooting, isReloading(), _isJumping, !_isJumping);
    tickFirstPersonBody(dt);
    tickNapNpc(dt);
    _isShooting = false;
    setNapMode(playerObj.position.x > NAP_X);
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
    if (++_minimapTick >= 4) { _minimapTick = 0; drawMinimap(playerObj.position, _mode.bots); }
    // v0.2.264 (R2): the title-screen n2n handshake + presence polling moved to the
    // shell's own rAF ticker (main.js) — it must keep running before the arena (and
    // thus this loop) is ever booted. The game loop no longer polls them.
    // MP-1: tick peer avatars (interpolation) + throttle-broadcast our own MOVE.
    // No-op when MP_ENABLED is false (host is null). Uses the same dt we drove the
    // player with, so latency compensation matches the rest of the frame.
    if (_mp) {
      _mp.tick(performance.now());
      _mpMoveAccum += dt;
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
        _mp.sendMove({
          pos: [px, py, pz],
          rot: [playerObj.rotation.y, 0],
          vel: [vx, vy, vz],
        });
      } else {
        _mpMoveDt += dt;
      }
    }
    // v0.2.379-alpha: feed the frame delta (ms) to the adaptive tier BEFORE the
    // render so any DPR/bloom change lands on this frame; sample renderer.info +
    // refresh the debug HUD AFTER (draw-call/triangle counts reflect the frame
    // just drawn). Both are cheap; the HUD does nothing unless its flag is set.
    _quality.update(dt * 1000);
    try {
      renderFrame(isLive());
    } catch (e) {
      console.warn('[render] frame skipped:', e.message);
    }
    _quality.sampleRenderInfo();
    _perfHud.update(performance.now());
  }

  // boot() — one-time world load, Three scene/loop bootstrap, and handler wiring.
  // Safe to call once; subsequent calls are a no-op.
  async function boot() {
    if (_booted) return;
    _booted = true;

    // Scene/world/HUD/entities — built once.
    buildArena();
    initAtmosphere();
    buildMirror();
    initHUD();
    initPlayerStats();
    initPlayer();
    _muzzleFlashes = createMuzzleFlashPool(scene, {
      getQualityTier: () => _quality.currentTier(),
    });

    _world = await loadWorld(defaultWorldUrl);
    if (_world.mode !== 'arena-shooter') {
      throw new Error(`Unsupported game mode: ${_world.mode}`);
    }
    await _mode.init({
      scene, camera, renderer, world: _world,
      physics: { step: stepPhysics, world: getWorld, castRay, castRayStatic, hasLineOfSight },
      getMultiplayerHost: () => _mp,
      muzzleFlashes: _muzzleFlashes,
      napX: NAP_X,
      isPlaying,
      stepPhysics,
      tickDynamicCrates,
      onShootAnimation: () => { _isShooting = true; },
      onPlayerShot: ({ origin, dir, aimOrigin, aimDir }) => {
        if (!_mp || !shouldSendShot({ playerX: playerObj.position.x, napX: NAP_X, selfId: _mp.selfId })) return;
        const viewLag = _mp.viewLagMs ? _mp.viewLagMs() : 0;
        const shot = buildShotPayload({ origin, dir, aimOrigin, aimDir }, Date.now(), viewLag);
        if (shot) _mp.sendShot(shot);
      },
      onPlayerDeath: () => triggerDeath(),
      wsState: WS_STATE,
      playerHp: PLAYER_HP,
      onScoreFrame: (payload) => { _arenaLb.setLiveScore(payload); emit(EV.SCORE_FRAME, payload); },
      onBotShot: (payload) => {
        if (Array.isArray(payload.origin)) {
          _mpShotOrigin.set(payload.origin[0], payload.origin[1], payload.origin[2]);
          _muzzleFlashes.trigger('muzzle', _mpShotOrigin);
        }
      },
    });
    initTargetReticle({ bots: _mode.bots, playerObj, getPlayerCollider });

    on(EV.PLAYER_HIT, () => triggerHit());
    on(EV.HUD_UPDATE, () => { if (isReloading()) triggerReload(); });

    installToriiDebug({
      version: VERSION, bots: _mode.bots, hitBot: _mode.hitBot, playerObj, resetPlayerPos,
      camera, setPitch,
      castRay, castRayStatic, hasLineOfSight, getWorld, getLastHit: _mode.getLastHit,
      getLastShot: _mode.getLastShot, getLastMiss: _mode.getLastMiss,
      getGrassMat, getFlowerMat, getMirror,
      getPhase: () => state.phase,
      getState: () => ({
        hp: state.hp, ammo: state.ammo, kills: state.kills, deaths: state.deaths,
        hits: state.hits, sats: state.sats,
        reloading: state.reloading, pointerLocked: state.pointerLocked,
      }),
      getCrateSummary, config: TUNING,
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
        takeDamage: _mode.takeDamage,
        killPlayer: _mode.killPlayer,
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
        if (_peerCombat(name, payload)) return;
        _mode.handleMultiplayerEvent(name, payload || {});
      };
      _mp = createMultiplayerHost({
        scene,
        emit: _mpEmit,
        now: () => performance.now(),
        getCharacter,
        // Load and cache the selected model per character. Returns a wrapper
        // THREE.Group with movement-aware IDLE/WALK animation.
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
    initLoop(update, _onLoopFatal);
    startLoop();
  }

  // bootstrapPhysics() — one-time lazy Rapier world + colliders + player body +
  // viewmodels. Async (Rapier WASM). Throws on failure; the shell ENTER handler
  // catches it and resets the button. Idempotent guard lives in the shell.
  // v0.2.277: step-level try/catch. The generic 'Arena failed to load' message
  // hid the real error. Each step now reports its name + e.message to entry-status
  // AND the console so the actual failure (which step, which error) is visible.
  async function bootstrapPhysics() {
    const step = async (name, fn) => {
      try { await fn(); }
      catch (e) {
        const msg = `⚠ ${name} failed: ${e && e.message ? e.message : e}`;
        console.error('[bootstrap]', name, e);
        try { showEntryStatus(msg); } catch {}
        throw new Error(msg);
      }
    };
    await step('initPhysics',       () => initPhysics());
    await step('buildArenaColliders', () => buildArenaColliders());
    await step('buildDynamicCrates', () => buildDynamicCrates());
    let handle;
    await step('spawnPlayerBody', () => { handle = spawnPlayerBody(); });
    setPlayerBody(handle);
    await step('loadPlayerModel',   () => loadPlayerModel(playerObj));
    await step('loadFirstPersonBody', () => loadFirstPersonBody(playerObj));
    await step('buildNapNpc',        () => buildNapNpc());
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
    _mode.dispose();
    if (_mp) { try { _mp.stop(reason); } catch {} _mp = null; }
    // v0.2.380-alpha: tear the leaderboard overlay down on arena exit / travel.
    try { _arenaLb.destroy(); } catch { /* noop */ }
  }

  return { boot, bootstrapPhysics, enter, setSpawnOverride, stopMultiplayer, dispose: stopMultiplayer };
}
