// main.js — wiring only. No game logic here.
import { state, isTitle, isPlaying, isPaused, isLive, needsPointerLock, transition, GAME_EVENT, resetRun } from './state.js';
import { emit, on, EV } from './events.js';
import { renderer, renderFrame } from './scene.js';
import { initAtmosphere, tickAtmosphere } from './atmosphere.js';
import { buildArena } from './arena.js';
import { tickFoliage, getGrassMat, getFlowerMat } from './arena-foliage.js';
import { buildMirror, tickMirror, shouldUpdateMirror, getMirror } from './mirror.js';
import { initLoop, startLoop } from './loop.js';
import { onKeyDown, requestLock, setYaw, onPointerLockLost, keys } from './input.js';
import { initPlayer, tickPlayer, tickDeath, playerObj, setPlayerBody, spawnPlayerBody, takeDamage, setNextSpawn, getPlayerCollider, resetPlayerPos, SPAWN_X, SPAWN_Z, SPAWN_YAW } from './player.js';
import { loadPlayerModel, tickPlayerModel, triggerHit, triggerDeath, triggerReload, setCharacter } from './playerModel.js';
import { initPhysics, stepPhysics, buildArenaColliders, getWorld, castRay, castRayStatic, hasLineOfSight } from './physics.js';
import { bots, initBots, tickBots, hitBot } from './bots.js';
import { initWeapons, spawnBullet, tickWeapons, triggerRecoil, getLastHit, recordPlayerShot, getLastShot, getLastMiss } from './weapons.js';
import { buildDynamicCrates, tickDynamicCrates, getCrateSummary } from './dynamicCrates.js';
import { buildNapNpc, tickNapNpc } from './napNpc.js';
import { loadFirstPersonBody, tickFirstPersonBody } from './firstPersonBody.js';
import { initTargetReticle, tickTargetReticle } from './targetReticle.js';
import { initHUD, tickHUD, flashCross, drawMinimap, setNapMode } from './hud.js';
import { ARENA_HALF, WALL_H, NAP_X } from './config.js';
import { nostrLogin } from './nostr.js';
import { playShoot, playFootstep, playJumpLand } from './audio.js';
import { initPlayerStats } from './playerStats.js';
import { installToriiDebug } from './engine/debug/toriiDebug.js';
import { applyPhaseScreens } from './engine/ui/phaseScreens.js';
import { VERSION, TUNING } from './config.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

buildArena();
initAtmosphere();
buildMirror();
initHUD();
initPlayerStats();
initPlayer();
initBots(playerObj, spawnBullet);
initWeapons(bots, takeDamage, getPlayerCollider);
initTargetReticle({ bots, playerObj, getPlayerCollider });
initLoop(update);
startLoop();

// Shoot wire: player emits EV.SHOOT → spawn bullet + recoil + SFX.
// Suppressed entirely in the NAP zone — weapon is disabled past the torii
// gate (player.x > NAP_X). The recoil/SFX skip too so it reads as inert,
// not malfunctioning. HUD shows a NAP indicator (see hud.js).
on(EV.SHOOT, ({ origin, dir, aimOrigin, aimDir }) => {
  if (playerObj.position.x > NAP_X) return;
  const b = spawnBullet(origin, dir, true);
  // v0.2.124 — capture per-shot diagnostics (aim line vs bullet line) so misses
  // are explainable via ToriiDebug.combat.lastShot/lastMiss.
  if (aimOrigin && aimDir) {
    recordPlayerShot(b, aimOrigin.x, aimOrigin.y, aimOrigin.z, aimDir.x, aimDir.y, aimDir.z);
  }
  triggerRecoil();
  playShoot();
});

// Bot-hit bridge — now an event-bus subscriber (v0.2.117). weapons.js emits
// EV.BOT_HIT_BY_PLAYER when a player bullet strikes a bot; we apply the damage
// and flash the crosshair, exactly as the old window._onBotHit global did.
on(EV.BOT_HIT_BY_PLAYER, ({ bot, dmg }) => { hitBot(bot, dmg); flashCross(); });
// Deprecated legacy alias — kept ONLY as a documented debug tap (see
// toriiDebug.js) so console/tester calls still work. Internal code must NOT call
// this; it just forwards onto the bus. Regression check [9] forbids re-adding an
// internal call to window._onBotHit().
window._onBotHit = (bot, dmg) => emit(EV.BOT_HIT_BY_PLAYER, { bot, dmg });

// Deliberate debug namespace (ships unconditionally in alpha). Consolidates
// inspection under window.ToriiDebug; legacy functional globals are preserved.
installToriiDebug({
  version: VERSION, bots, hitBot, playerObj, resetPlayerPos,
  castRay, castRayStatic, hasLineOfSight, getWorld, getLastHit,
  getLastShot, getLastMiss,
  getGrassMat, getFlowerMat, getMirror,
  // v0.2.130 — snapshot/report providers.
  getPhase: () => state.phase,
  getState: () => ({
    hp: state.hp, ammo: state.ammo, kills: state.kills, deaths: state.deaths,
    hits: state.hits, sats: state.sats,
    reloading: state.reloading, pointerLocked: state.pointerLocked,
  }),
  getCrateSummary, config: TUNING,
});


// Crosshair — show when pointer locked, hide when not
const _elCrosshair = document.getElementById('crosshair');
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) {
    _elCrosshair?.classList.add('active');
  } else {
    _elCrosshair?.classList.remove('active');
  }
});

// ── UI bindings ───────────────────────────────────────────────────────────────

const elTitle    = document.getElementById('screen-title');
const elHud      = document.getElementById('hud');
const elPause    = document.getElementById('pause-overlay');
const elEnterBtn = document.getElementById('btn-enter');

// v0.2.121 — the FIRST real EV.PHASE_CHANGE subscriber. Top-level screen
// visibility (title / HUD / pause modal) is now derived declaratively from the
// phase the FSM transitioned INTO, instead of being hand-toggled at each
// transition() call site. transition() stays the single source of phase change;
// this just reacts to it. Behaviour-preserving: phaseVisibility() reproduces the
// exact toggles the call sites used (see engine/ui/phaseScreens.js).
on(EV.PHASE_CHANGE, ({ to }) => applyPhaseScreens(to, { elTitle, elHud, elPause }));

// Character selector
document.querySelectorAll('.char-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.char-btn').forEach(b => {
      b.style.border = '1.5px solid #4a5568';
      b.style.background = '#0f0f1a';
      b.style.color = '#a0aec0';
    });
    btn.style.border = '1.5px solid #8b5cf6';
    btn.style.background = '#1a0a2e';
    btn.style.color = '#e2d8f0';
    setCharacter(btn.dataset.char);
  });
});
// Left-panel login button removed in v0.2.47 — only centre button remains.
const elNostrCentreBtn = document.getElementById('btn-nostr-centre');
const elResumeBtn= document.getElementById('btn-resume');
const elHomeBtn  = document.getElementById('btn-home');
const elNostrTxt = document.getElementById('nostr-status');

// Canvas click → re-engage pointer lock when playing
renderer.domElement.addEventListener('click', () => {
  if (needsPointerLock()) {
    requestLock(renderer.domElement);
  }
});

// Enter Arena — lazy-load Rapier then start.
// v0.2.128: the world/arena/player-body/model bootstrap is now ONE-TIME. The
// old handler re-ran initPhysics() on every ENTER, and initPhysics() builds a
// BRAND-NEW Rapier world each call — so a second entry (HOME → TITLE → ENTER)
// orphaned every bot collider in the discarded world (they're created once at
// load and bound to that world), leaving the live world with no bot colliders.
// Result: "hardly any body or head shots connect" on re-entry. We now bootstrap
// physics + colliders + player body + viewmodels exactly once and keep the
// single persistent world across HOME/ENTER (HOME already intends physics to
// persist); subsequent entries just reset the player to spawn and re-arm.
let _arenaBootstrapped = false;
elEnterBtn?.addEventListener('click', async () => {
  if (!isTitle()) return;

  if (!_arenaBootstrapped) {
    elEnterBtn.textContent = 'LOADING PHYSICS…';
    elEnterBtn.disabled = true;
    try {
      await initPhysics();
      buildArenaColliders();
      buildDynamicCrates();
      const handle = spawnPlayerBody();
      setPlayerBody(handle);
    } catch (e) {
      console.error('Physics init failed:', e);
      elEnterBtn.textContent = 'ENTER ARENA';
      elEnterBtn.disabled = false;
      return;
    }
    // Load Chiefmonkey player model — attaches to playerObj (camera parent).
    // Once only: re-attaching on every entry would stack duplicate viewmodels.
    loadPlayerModel(playerObj);
    loadFirstPersonBody(playerObj);
    buildNapNpc();
    _arenaBootstrapped = true;
  }

  // Fresh run on EVERY entry: reset HP/ammo/score/reload state (resetRun) and
  // move the player back to the canonical SW spawn corner (the world/colliders
  // persist across HOME/ENTER; only the player's run-state + pose reset). Restore
  // the spawn to the original corner first, in case a prior session's
  // death-respawn moved it elsewhere.
  resetRun();
  setNextSpawn(SPAWN_X, SPAWN_Z, SPAWN_YAW);
  resetPlayerPos();

  // Face NE into arena from SW spawn corner (-14,-14) toward centre
  // yaw = atan2(-(-14), -(-14)) = atan2(14,14)... wait, formula: dx=-cx=14,dz=-cz=14, yaw=atan2(-dx,-dz)=atan2(-14,-14)=-3PI/4
  setYaw(SPAWN_YAW); // -2.356 rad (-3π/4), confirmed correct

  transition(GAME_EVENT.ENTER); // TITLE → PLAYING (PHASE_CHANGE subscriber shows HUD, hides title)
  requestLock(renderer.domElement);
  emit(EV.HUD_UPDATE);
});

// Nostr login (left panel + centre panel buttons share same handler)
async function _doNostrLogin() {
  const result = await nostrLogin();
  if (elNostrTxt) elNostrTxt.textContent = result;
}
elNostrCentreBtn?.addEventListener('click', _doNostrLogin);

// ESC is the universal override — toggles the pause modal in BOTH directions
// regardless of pointer-lock state, and runs in the capture phase so nothing
// else can swallow it first. The browser still releases pointer lock on ESC,
// but we no longer depend on the pointerlockchange signal for the pause UI.
function _openPause() {
  // PLAYING → PAUSED; no-op from any other phase (same as the old guard).
  // PHASE_CHANGE subscriber shows the pause modal.
  if (!transition(GAME_EVENT.PAUSE)) return;
  document.exitPointerLock?.();
}

document.addEventListener('keydown', e => {
  if (e.code !== 'Escape' || e.repeat) return;
  // Block default + stop other handlers — ESC is OURS while in-game.
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

// Browser-forced pointer-lock loss (focus change, window switch) still pauses
// the running game so the player isn't stuck spinning in the background.
onPointerLockLost(() => {
  if (isPlaying()) _openPause();
});

elResumeBtn?.addEventListener('click', _resume);

elHomeBtn?.addEventListener('click', () => {
  // PAUSED → TITLE (Home is only reachable from the pause modal). PHASE_CHANGE
  // subscriber hides the pause modal + HUD and shows the title screen.
  transition(GAME_EVENT.HOME);
  document.exitPointerLock?.();
  // Re-arm the Enter button — physics is already initialized, so going back
  // into the arena from here just needs the original label restored.
  if (elEnterBtn) {
    elEnterBtn.textContent = 'ENTER ARENA';
    elEnterBtn.disabled = false;
  }
});

function _resume() {
  // PAUSED → PLAYING; no-op from any other phase (same as the old guard).
  // PHASE_CHANGE subscriber hides the pause modal.
  if (!transition(GAME_EVENT.RESUME)) return;
  requestLock(renderer.domElement); // works from button click; canvas click re-locks if from ESC
}

// ── Model event hooks ────────────────────────────────────────────────────────
on(EV.PLAYER_HIT,    () => triggerHit());
on(EV.PLAYER_KILLED, () => {
  triggerDeath();
  // Pick the arena corner furthest from all living bots
  const H = 14; // corner offset from centre
  const CORNERS = [
    { x: -H, z: -H }, // SW
    { x:  H, z: -H }, // SE
    { x:  H, z:  H }, // NE
    { x: -H, z:  H }, // NW
  ];
  // Compute yaw to face arena centre from each corner.
  // Three.js fwd = (-sin(yaw), 0, -cos(yaw)). Invert to get yaw from direction.
  CORNERS.forEach(c => {
    const dx = -c.x, dz = -c.z; // direction toward centre
    c.yaw = Math.atan2(-dx, -dz); // Three.js: fwd=(-sin y,0,-cos y) => yaw=atan2(-dx,-dz)
  });
  const liveBots = bots.filter(b => b.alive);
  let best = CORNERS[0], bestDist = -1;
  for (const c of CORNERS) {
    let minD = Infinity;
    for (const b of liveBots) {
      const dx = (b.pos?.x ?? 0) - c.x, dz = (b.pos?.z ?? 0) - c.z;
      minD = Math.min(minD, dx*dx + dz*dz);
    }
    if (minD > bestDist) { bestDist = minD; best = c; }
  }
  setNextSpawn(best.x, best.z, best.yaw);
});
// HUD_UPDATE is emitted on reload start — check state.reloading to trigger anim
on(EV.HUD_UPDATE,    () => { if (state.reloading) triggerReload(); });

// ── Game loop ─────────────────────────────────────────────────────────────────

let _minimapTick = 0;
let _isShooting  = false;   // set true for 1 frame on shoot event
let _isJumping   = false;
let _prevOnGround = true;

// Footstep dt-accumulator — fires playFootstep() every STEP_INTERVAL while
// the player is moving and on the ground. Interval shortens when running.
let _footAccum  = 0;
const FOOT_WALK_INTERVAL = 0.45;
const FOOT_RUN_INTERVAL  = 0.30;
const EYE = 1.7;
// Footsteps only fire when the capsule is ACTUALLY translating, not merely when
// a key is held. Walking into a wall (keys down, zero displacement) used to keep
// the beat going like a drum roll; gating on measured horizontal speed kills it.
let _prevFootX = 0, _prevFootZ = 0, _footInit = false;
const FOOT_MIN_SPEED = 1.5; // m/s — below this the player isn't really moving

on(EV.SHOOT, () => { _isShooting = true; });

function update(dt, frame) {
  // v0.2.112: step AFTER tickPlayer/tickBots set their kinematic targets but
  // BEFORE tickWeapons raycasts. Previously the step ran first, so the bot
  // body/head colliders (and Rapier's query pipeline) lagged one frame behind
  // the visual model — a clear shot at a moving bot could miss the stale
  // collider. Stepping here syncs the query pipeline to THIS frame's positions
  // so the bullet raycast hits exactly what the player sees.
  tickPlayer(dt);
  tickDeath(dt, renderer);
  tickBots(dt);
  if (isPlaying()) { stepPhysics(); tickDynamicCrates(); }
  tickWeapons(dt, playerObj.position);
  // v0.2.113: aim preview — after the physics step + bullet pass so bot
  // colliders reflect THIS frame's positions, matching what a shot would hit.
  tickTargetReticle();
  // Detect jump / ground state from world Y (eye at EYE when on floor).
  // Hysteresis on the airborne threshold: snap-to-ground micro-jitter sits a few
  // cm above EYE, so a tight 0.05 band re-triggered the land thump every frame.
  _isJumping = playerObj.position.y > EYE + 0.12;
  const onGround = !_isJumping;

  // Jump land — one-shot thump on transition from airborne to grounded.
  if (onGround && !_prevOnGround) playJumpLand();
  _prevOnGround = onGround;

  // Footsteps — only while genuinely translating on the ground in PLAYING phase.
  const keyHeld =
    keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
    keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'];
  // Measured horizontal speed this frame (guards against wall-blocked key holds).
  const pdx = playerObj.position.x - _prevFootX;
  const pdz = playerObj.position.z - _prevFootZ;
  const horizSpeed = _footInit && dt > 0 ? Math.sqrt(pdx*pdx + pdz*pdz) / dt : 0;
  _prevFootX = playerObj.position.x; _prevFootZ = playerObj.position.z; _footInit = true;
  if (isPlaying() && onGround && keyHeld && horizSpeed > FOOT_MIN_SPEED) {
    const running = keys['ShiftLeft'] || keys['ShiftRight'];
    const interval = running ? FOOT_RUN_INTERVAL : FOOT_WALK_INTERVAL;
    _footAccum += dt;
    if (_footAccum >= interval) { _footAccum = 0; playFootstep(); }
  } else {
    _footAccum = 0;
  }

  tickPlayerModel(dt, _isShooting, state.reloading, _isJumping, !_isJumping);
  tickFirstPersonBody(dt);
  tickNapNpc(dt);
  _isShooting = false; // reset after 1 frame
  setNapMode(playerObj.position.x > NAP_X);
  tickHUD(dt);
  tickAtmosphere(dt);
  tickMirror(dt);
  // Mirror throttle handled inside tickMirror via onBeforeRender swap — no visibility toggle needed
  // Tick grass + flower shader uTime via the foliage registry (v0.2.118 — no
  // longer reaches through window._grassMat/_flowerMat).
  tickFoliage(dt);
  if (++_minimapTick >= 4) { _minimapTick = 0; drawMinimap(playerObj.position, bots); }
  // Wrap render in try/catch — a Three.js crash must not kill the rAF loop
  try {
    renderFrame(isLive());
  } catch (e) {
    console.warn('[render] frame skipped:', e.message);
  }
}
