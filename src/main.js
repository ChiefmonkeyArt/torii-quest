// main.js — wiring only. No game logic here.
import { state, PHASE } from './state.js';
import { emit, on, EV } from './events.js';
import { renderer, renderFrame } from './scene.js';
import { initAtmosphere, tickAtmosphere } from './atmosphere.js';
import { buildArena } from './arena.js';
import { buildMirror, tickMirror, shouldUpdateMirror } from './mirror.js';
import { initLoop, startLoop } from './loop.js';
import { onKeyDown, requestLock, setYaw, onPointerLockLost } from './input.js';
import { initPlayer, tickPlayer, tickDeath, playerObj, setPlayerBody, spawnPlayerBody, takeDamage, setNextSpawn } from './player.js';
import { loadPlayerModel, tickPlayerModel, triggerHit, triggerDeath, triggerReload, setCharacter } from './playerModel.js';
import { initPhysics, stepPhysics, buildArenaColliders } from './physics.js';
import { bots, initBots, tickBots, hitBot } from './bots.js';
import { initWeapons, spawnBullet, tickWeapons, triggerRecoil } from './weapons.js';
import { initHUD, tickHUD, flashCross, drawMinimap } from './hud.js';
import { ARENA_HALF, WALL_H } from './config.js';
import { nostrLogin } from './nostr.js';
import { playShoot } from './audio.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

buildArena();
initAtmosphere();
buildMirror();
initHUD();
initPlayer();
initBots(playerObj, spawnBullet);
initWeapons(bots, takeDamage);
initLoop(update);
startLoop();

// Shoot wire: player emits EV.SHOOT → spawn bullet + recoil + SFX
on(EV.SHOOT, ({ origin, dir }) => {
  spawnBullet(origin, dir, true);
  triggerRecoil();
  playShoot();
});

// Bot-hit bridge
window._onBotHit = (bot, dmg) => { hitBot(bot, dmg); flashCross(); };


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
const elNostrBtn       = document.getElementById('btn-nostr');
const elNostrCentreBtn = document.getElementById('btn-nostr-centre');
const elResumeBtn= document.getElementById('btn-resume');
const elHomeBtn  = document.getElementById('btn-home');
const elNostrTxt = document.getElementById('nostr-status');

// Canvas click → re-engage pointer lock when playing
renderer.domElement.addEventListener('click', () => {
  if (state.phase === PHASE.PLAYING && !state.pointerLocked) {
    requestLock(renderer.domElement);
  }
});

// Enter Arena — lazy-load Rapier then start
elEnterBtn?.addEventListener('click', async () => {
  if (state.phase !== PHASE.TITLE) return;
  elEnterBtn.textContent = 'LOADING PHYSICS…';
  elEnterBtn.disabled = true;

  try {
    await initPhysics();
    buildArenaColliders(ARENA_HALF, WALL_H);
    const body = spawnPlayerBody();
    setPlayerBody(body);
  } catch (e) {
    console.error('Physics init failed:', e);
    elEnterBtn.textContent = 'ENTER ARENA';
    elEnterBtn.disabled = false;
    return;
  }

  // Face NE into arena from SW spawn corner (-14,-14) toward centre
  // yaw = atan2(-(-14), -(-14)) = atan2(14,14)... wait, formula: dx=-cx=14,dz=-cz=14, yaw=atan2(-dx,-dz)=atan2(-14,-14)=-3PI/4
  setYaw(-3 * Math.PI / 4); // -2.356 rad, confirmed correct

  // Load Chiefmonkey player model — attaches to playerObj (camera parent)
  loadPlayerModel(playerObj);

  elTitle?.classList.add('hidden');
  elHud?.classList.remove('hidden');
  state.phase = PHASE.PLAYING;
  requestLock(renderer.domElement);
  emit(EV.HUD_UPDATE);
});

// Nostr login (left panel + centre panel buttons share same handler)
async function _doNostrLogin() {
  const result = await nostrLogin();
  if (elNostrTxt) elNostrTxt.textContent = result;
}
elNostrBtn?.addEventListener('click', _doNostrLogin);
elNostrCentreBtn?.addEventListener('click', _doNostrLogin);

// ESC — pause the instant pointer lock is lost (fires before keydown 'Escape')
// pointerlockchange is the earliest possible signal that ESC was pressed.
onPointerLockLost(() => {
  if (state.phase === PHASE.PLAYING) {
    state.phase = PHASE.PAUSED;
    elPause?.classList.add('show');
  }
});

// Also handle ESC keydown for resume (pointer lock already gone at this point)
document.addEventListener('keydown', e => {
  if (e.code !== 'Escape' || e.repeat) return;
  if (state.phase === PHASE.PAUSED) _resume();
}, true);

elResumeBtn?.addEventListener('click', _resume);

elHomeBtn?.addEventListener('click', () => {
  state.phase = PHASE.TITLE;
  elPause?.classList.remove('show');
  elTitle?.classList.remove('hidden');
  elHud?.classList.add('hidden');
  document.exitPointerLock?.();
});

function _resume() {
  if (state.phase !== PHASE.PAUSED) return;
  state.phase = PHASE.PLAYING;
  elPause?.classList.remove('show');
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

on(EV.SHOOT, () => { _isShooting = true; });

function update(dt, frame) {
  if (state.phase === PHASE.PLAYING) stepPhysics();
  tickPlayer(dt);
  tickDeath(dt, renderer);
  tickBots(dt);
  tickWeapons(dt, playerObj.position);
  // Detect jump start — playerObj.position.y rising above floor eye
  _isJumping = playerObj.position.y > 1.75;
  tickPlayerModel(dt, _isShooting, state.reloading, _isJumping, !_isJumping);
  _isShooting = false; // reset after 1 frame
  tickHUD(dt);
  tickAtmosphere(dt);
  tickMirror(dt);
  // Mirror throttle handled inside tickMirror via onBeforeRender swap — no visibility toggle needed
  // Tick grass + flower shader uTime (set via window refs — no import needed)
  if (window._grassMat)  window._grassMat.uniforms.uTime.value  += dt;
  if (window._flowerMat) window._flowerMat.uniforms.uTime.value += dt;
  if (++_minimapTick >= 4) { _minimapTick = 0; drawMinimap(playerObj.position, bots); }
  // Wrap render in try/catch — a Three.js crash must not kill the rAF loop
  try {
    renderFrame(state.phase === PHASE.PLAYING || state.phase === PHASE.DEAD);
  } catch (e) {
    console.warn('[render] frame skipped:', e.message);
  }
}
