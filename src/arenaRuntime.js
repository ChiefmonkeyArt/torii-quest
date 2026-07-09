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
import { renderer, renderFrame, scene, camera } from './scene.js';
import { initAtmosphere, tickAtmosphere } from './atmosphere.js';
import { buildArena } from './arena.js';
import { tickFoliage, getGrassMat, getFlowerMat } from './arena-foliage.js';
import { tickSea } from './terrain/sea.js';
import { buildMirror, tickMirror, getMirror } from './mirror.js';
import { initLoop, startLoop } from './loop.js';
import { onKeyDown, requestLock, setYaw, setPitch, onPointerLockLost, keys } from './input.js';
import { initPlayer, tickPlayer, tickDeath, playerObj, setPlayerBody, spawnPlayerBody, takeDamage, setNextSpawn, getPlayerCollider, resetPlayerPos, pickRespawnCorner, isPlayerOnGround, flyToggleFromInput, SPAWN_X, SPAWN_Z, SPAWN_YAW } from './player.js';
import { loadPlayerModel, tickPlayerModel, triggerHit, triggerDeath, triggerReload, setCharacter, setFlyHidden as setFlyHiddenPlayerModel } from './playerModel.js';
import { initPhysics, stepPhysics, buildArenaColliders, getWorld, castRay, castRayStatic, hasLineOfSight } from './physics.js';
import { bots, initBots, tickBots, hitBot } from './bots.js';
import { initWeapons, spawnBullet, tickWeapons, triggerRecoil, getLastHit, recordPlayerShot, getLastShot, getLastMiss } from './weapons.js';
import { buildDynamicCrates, tickDynamicCrates, getCrateSummary } from './dynamicCrates.js';
import { buildNapNpc, tickNapNpc } from './napNpc.js';
import { loadFirstPersonBody, tickFirstPersonBody, setFlyHidden as setFlyHiddenFirstPersonBody } from './firstPersonBody.js';
import { initTargetReticle, tickTargetReticle } from './targetReticle.js';
import { initHUD, tickHUD, flashCross, drawMinimap, setNapMode, showPortalPrompt, hidePortalPrompt, showFlyNotice } from './hud.js';
import { openGatewayScreen, closeGatewayScreen, isGatewayScreenOpen } from './engine/gateway/gatewayScreen.js';
import { ARENA_HALF, WALL_H, NAP_X, TRAVEL_GATE_X, TRAVEL_GATE_Z, VERSION, TUNING, MP_ENABLED, PLAYER_HP } from './config.js';
import { createMultiplayerHost } from './engine/multiplayer/multiplayerHost.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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

// setCharacter is re-exported so the shell's character selector (three-free) can
// pick the player model WITHOUT statically importing playerModel.js (→ three).
export { setCharacter };

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
  // MP-1 multiplayer host — null unless MP_ENABLED is true at boot() time.
  // Ships false by default (see MP_1_SPEC.md §6): zero side effects, no ws dial,
  // no scene mutations. When enabled, the host owns the ws lifecycle + peer avatar
  // roster; the render loop only calls `_mp.tick(now)` and (throttled) `_mp.sendMove()`.
  let _mp = null;
  let _mpMoveAccum = 0;
  const MP_MOVE_HZ = 10;
  const MP_MOVE_INTERVAL = 1 / MP_MOVE_HZ;

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
      if (isPlaying() && _mpMoveAccum >= MP_MOVE_INTERVAL) {
        _mpMoveAccum = 0;
        _mp.sendMove({
          pos: [playerObj.position.x, playerObj.position.y, playerObj.position.z],
          rot: [playerObj.rotation.y, 0],
          vel: [0, 0, 0], // velocity source lives in the character controller; MP-2 will read it.
        });
      }
    }
    try {
      renderFrame(isLive());
    } catch (e) {
      console.warn('[render] frame skipped:', e.message);
    }
  }

  // boot() — one-time synchronous three scene/loop bootstrap + handler wiring.
  // Safe to call once; subsequent calls are a no-op.
  function boot() {
    if (_booted) return;
    _booted = true;

    // Scene/world/HUD/entities — built once.
    buildArena();
    initAtmosphere();
    buildMirror();
    initHUD();
    initPlayerStats();
    initPlayer();
    initBots(playerObj, spawnBullet);
    initWeapons(bots, takeDamage, getPlayerCollider);
    initTargetReticle({ bots, playerObj, getPlayerCollider });

    // Shoot wire: player emits EV.SHOOT → spawn bullet + recoil + SFX. Suppressed
    // entirely in the NAP zone (player.x > NAP_X) so the weapon reads as inert.
    on(EV.SHOOT, ({ origin, dir, aimOrigin, aimDir }) => {
      if (playerObj.position.x > NAP_X) return;
      const b = spawnBullet(origin, dir, true);
      if (aimOrigin && aimDir) {
        recordPlayerShot(b, aimOrigin.x, aimOrigin.y, aimOrigin.z, aimDir.x, aimDir.y, aimDir.z);
      }
      triggerRecoil();
      playShoot();
    });
    on(EV.SHOOT, () => { _isShooting = true; });

    on(EV.BOT_HIT_BY_PLAYER, ({ bot, dmg }) => { hitBot(bot, dmg); flashCross(); });
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
    });

    // ESC — universal override: pause/resume both directions; closes the gateway
    // screen first when it is open. Capture phase so nothing swallows it first.
    document.addEventListener('keydown', e => {
      if (e.code !== 'Escape' || e.repeat) return;
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

    // Browser-forced pointer-lock loss still pauses a running game.
    onPointerLockLost(() => { if (isPlaying()) _openPause(); });

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
      const _mpGltf = new GLTFLoader();
      // MP-2 (v0.2.364-alpha): server issues RESPAWN when this client is killed.
      // Handler warps the local body to the server-picked corner and heals to
      // PLAYER_HP. Non-respawn events are silently ignored — kept as one seam.
      const _mpEmit = (name, payload) => {
        if (name !== 'mp_respawn') return;
        const p = payload || {};
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
        // Load the shared chiefmonkey6 model for every peer (per-character skinning
        // lands in MP-1.5). Returns a THREE.Group with position/rotation/dispose().
        avatarLoader: (peer) => new Promise((resolve, reject) => {
          _mpGltf.load('/chiefmonkey6.glb', (gltf) => {
            const obj = gltf.scene;
            obj.userData.peerId = peer.id;
            obj.dispose = () => {
              obj.traverse((n) => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) {
                  const mats = Array.isArray(n.material) ? n.material : [n.material];
                  for (const m of mats) m.dispose?.();
                }
              });
            };
            resolve(obj);
          }, undefined, reject);
        }),
        // NIP-42 kind:22242 auth — the server verifies via nostr-tools. The client
        // signer is browser-only (window.nostr); the wire only carries the signed event.
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
    if (_mp) { try { _mp.stop(reason); } catch {} _mp = null; }
  }

  return { boot, bootstrapPhysics, enter, setSpawnOverride, stopMultiplayer };
}
