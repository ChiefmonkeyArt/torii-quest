// bots.js — thin render/collider/audio/LOD wrapper around the PURE headless bot
// AI in engine/entities/botSim.js (v0.2.379-alpha).
//
// The AI brain (spawn logic, per-frame steering/cover/LOS/shoot decision, and the
// hit/kill/blowback/respawn state machine) lives in botSim.js with ZERO
// render/audio/physics imports. This module owns everything the brain does not:
// the Banker GLB model (BotModel), the Rapier hit-capsule + head-sphere colliders,
// the bot-shoot audio, LOD, and the game-state side-effects of a kill (kills/sats/
// emit). Each entry in the exported `bots[]` is a WRAPPER that pairs a model +
// colliders with a reference to its pure sim state (`bot.state`).
//
// initBots(playerObj, spawnBulletFn), tickBots(dt) and hitBot(bot, dmg) keep their
// exact signatures + externally observable behaviour — this is a pure refactor.
import * as THREE from 'three';
import { scene, camera } from './scene.js';
import { state, isPlaying } from './state.js';
import { emit, EV } from './events.js';
import { setBossBar, hideBossBar } from './hud.js';
import {
  BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, OBSTACLES, BOT_SPEED, BOT_DAMAGE,
  BOSS_COUNT, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_SHOOT_CD, BOSS_RADIUS, BOSS_NAME,
  BOSS_TARGET_HEIGHT,
} from './config.js';
import { playBotShoot } from './audio.js';
import { BotModel, preloadBotModel, preloadBossModel } from './botModel.js';
import { getLodLevel, applyLod } from './lod.js';
import { PLAYER_SAFE_CORNER, getPlayerCollider, isPlayerOutsideFence } from './player.js';
import { createBotBody, createBotHead, setBotBodyPos, physicsReady,
         BOT_BODY_CENTRE_Y_OFFSET, BOT_HEAD_CENTRE_Y_OFFSET,
         createBotBoneColliders, syncNpcBoneColliders, removeNpcBoneColliders, removeBotColliders } from './physics.js';
import { raycastService } from './engine/physics/raycastService.js';
import { buildCoverPoints } from './engine/entities/bot-tactics.js';
import { isFlyEnabled } from './engine/debug/flyCamera.js';
import { sampleArenaHeight } from './terrain/heightmap.js';
import { isNapLand } from './terrain/tomoeShape.js';
import { clampToCoastline, pointInCoastline, coastlineBounds } from './terrain/coastline.js';
import { createBotSim, COVER_MARGIN } from './engine/entities/botSim.js';
import { createBotNetState, animHintToFlags } from './engine/entities/botNetState.js';
import { nameForBotId } from './engine/entities/botIdentity.js';
import { logBotShot, logBotKill, logBotRespawn } from './engine/entities/botDiagnostics.js';
import { decideBossEngagement } from './bossBarState.js';
import { BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN, BRIDGE2_WIDTH } from './config.js';

export const bots = [];

// Bot milestone chunk 2 (v0.2.379-alpha): in multiplayer the client is
// RENDER-ONLY — the server runs the authoritative bot AI and streams BOT_STATE.
// _netMode flips tickBots() from local-AI to interpolate-from-server, and makes
// hitBot() a no-op (damage is resolved server-side via the SHOT path).
let _netMode = false;
const _botNet = createBotNetState();
const _nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ARENA_HALF = 20;
// ADR-0016 D-2: after this many seconds the death arc has decayed to zero
// (arc = max(0, 9t − 7t²) hits 0 at t ≈ 9/7 s). During the arc the corpse is
// force-visible; after it, LOD may cull distant corpses.
const DEATH_ARC_DURATION = 1.3;
const BOSS_BAR_ENGAGE_RANGE = 14;
const BOSS_BAR_RECENT_HIT_MS = 4000;
const BOSS_BAR_VIEWPORT_MARGIN = 24;
const _bossBarAnchorV = new THREE.Vector3();
let _bossLastHitMs = -Infinity;
let _prevBossNetHp = null;
let _bossNetId = '';

function _resetBossBarTracking() {
  _bossLastHitMs = -Infinity;
  _prevBossNetHp = null;
  _bossNetId = '';
}

function _projectBossBarAnchor(pose) {
  const width = typeof innerWidth === 'number' ? innerWidth : 0;
  const height = typeof innerHeight === 'number' ? innerHeight : 0;
  if (!(width > 0 && height > 0) || !pose) {
    return { visible: false, screenX: 0, screenY: 0 };
  }
  _bossBarAnchorV.set(
    pose.x,
    _footY(pose.x, pose.z) + BOSS_TARGET_HEIGHT + 0.4,
    pose.z,
  );
  _bossBarAnchorV.project(camera);
  const screenX = (_bossBarAnchorV.x * 0.5 + 0.5) * width;
  const screenY = (-_bossBarAnchorV.y * 0.5 + 0.5) * height;
  const margin = BOSS_BAR_VIEWPORT_MARGIN;
  const visible = Number.isFinite(screenX)
    && Number.isFinite(screenY)
    && _bossBarAnchorV.z <= 1
    && screenX >= -margin
    && screenX <= width + margin
    && screenY >= -margin
    && screenY <= height + margin;
  return { visible, screenX, screenY };
}

export function setBotNetMode(on) {
  const was = _netMode;
  _netMode = !!on;
  if (_netMode && !was) {
    // ADR-0021 — THE frozen-bot / floating-nameplate root cause.
    // initBots() ALWAYS spawns a full LOCAL roster (sim.spawnAll(BOT_COUNT) =
    // 5 regulars + the Augustink boss) from CLIENT config, because MP connects
    // only AFTER init. The moment MP turns on, tickBots switches to _tickNet and
    // renders only rows the server sends — so every local bot the server does
    // not have stops ticking and stays frozen forever at its spawn point with
    // its nameplate still drawn (Augustink's spawn is in the water).
    // In MP the server is authoritative: drop the local roster on entry so only
    // server rows are rendered. _tickNet recreates wrappers on demand.
    _botNet.clear();
    _clearAllBots();
    _resetBossBarTracking();
    hideBossBar();
  }
  if (!_netMode && was) {
    // ADR-0019: tear down the MP bot scene on disconnect so server rows that no
    // longer exist cannot linger as frozen nameplates.
    _botNet.clear();
    _clearAllBots();
    _resetBossBarTracking();
    hideBossBar();
  }
}

// Remove every bot wrapper from the scene + physics world and empty the array.
// Disposes each model (root + nameplate sprite) and its body/head/bone colliders.
function _clearAllBots() {
  for (const bot of bots) {
    if (bot.model) { bot.model.dispose(); bot.model = null; }
    if (bot._capsuleMesh) {
      scene.remove(bot._capsuleMesh);
      bot._capsuleMesh.material?.dispose?.();
      bot._capsuleMesh = null;
    }
    removeBotColliders(bot);
  }
  bots.length = 0;
}
export function isBotNetMode() { return _netMode; }

// Foot ground height for a bot at arena (x,z). Stage 3 (v0.2.329): the arena is a
// raised undulating island, so a bot's feet ride sampleArenaHeight() (which already
// includes ISLAND_BASE_Y). Kinematic bots don't gravity-settle, so we plant them
// on the sampled surface explicitly.
function _footY(x, z) { return sampleArenaHeight(x, z); }

// v0.2.378 fix 2: the pure sim hands shotCallback a SIM-LOCAL origin (y = EYE_Y
// above the bot's feet) plus the player world-eye `target`. Lift the origin to the
// bot's real world eye height (footY + origin.y) and re-aim at the target, so the
// enemy tracer starts at the muzzle and actually reaches the player capsule (the
// old code fired from an absolute y≈0.9, far below the player on raised terrain).
function _botShotToWorld(origin, dir, target) {
  const worldOrigin = { x: origin.x, y: _footY(origin.x, origin.z) + origin.y, z: origin.z };
  if (!target) return [worldOrigin, dir];
  let dx = target.x - worldOrigin.x, dy = target.y - worldOrigin.y, dz = target.z - worldOrigin.z;
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-6) { dx /= len; dy /= len; dz /= len; }
  else { dx = dir.x; dy = dir.y; dz = dir.z; }
  return [worldOrigin, { x: dx, y: dy, z: dz }];
}

// Cover candidate points are precomputed ONCE from the static arena-side boxes
// (crates + arena-side obstacles west of the NAP plane — the torii pillars/bonsai
// east of it are irrelevant to combat cover). Offset outward from each box by
// (BOT_R + margin) so a bot standing on the point clears the box.
const _arenaBoxes  = [...CRATES, ...OBSTACLES.filter(b => !isNapLand(b[0], b[1]))];
const _coverPoints = buildCoverPoints(_arenaBoxes, COVER_MARGIN);

let _spawnBulletFn = null;
let _playerObj     = null;
let _modelsReady   = false;
// ADR-0022: MP owns its own boss-GLB preload. The SP path only kicks off
// preloadBossModel() inside the (now net-gated) initBots continuation, so in MP
// nothing ever fetched the boss template.
let _bossModelReady      = false;
let _bossPreloadStarted  = false;
let _bossFallbackRegular = false;
function _ensureBossPreload() {
  if (_bossPreloadStarted) return;
  _bossPreloadStarted = true;
  preloadBossModel()
    .then(() => { _bossModelReady = true; })
    .catch(err => {
      console.warn('[bots] boss GLB load failed in MP, using regular model:', err);
      _bossFallbackRegular = true;
    });
}

// v0.2.533: Bridge 2 walkable zone — lets bots walk between Arena BL and BR
// islands over the bridge. Includes a margin so the bot center stays on deck.
// Bridge 2 is axis-aligned (no rotation), so this is a simple AABB check.
const _BR2_HALF_L = BRIDGE2_LEN / 2 + 0.3;   // 0.3m margin for bot radius
const _BR2_HALF_W = BRIDGE2_WIDTH / 2 + 0.3;
function _isOnBridge2(x, z) {
  return Math.abs(x - BRIDGE2_X) <= _BR2_HALF_L &&
         Math.abs(z - BRIDGE2_Z) <= _BR2_HALF_W;
}
// Bridge 2 entry waypoints (one per island side) for inter-island pathing.
const _BRIDGE2_WAYPOINTS = [
  [BRIDGE2_X - _BR2_HALF_L, BRIDGE2_Z],  // BL-side entry
  [BRIDGE2_X + _BR2_HALF_L, BRIDGE2_Z],  // BR-side entry
];

// The pure headless brain. All render/audio/physics access is injected — the sim
// itself imports none of it. shotCallback wraps spawnBullet + bot-shoot audio; the
// LOS/height/coastline deps forward to the render-side services.
const sim = createBotSim({
  losFn: (ax, ay, az, bx, by, bz, excl) => raycastService.lineOfSight(ax, ay, az, bx, by, bz, excl),
  footY: _footY,
  clampFence: clampToCoastline,
  pointInFence: pointInCoastline,
  fenceBounds: coastlineBounds,
  arenaBoxes: _arenaBoxes,
  coverPoints: _coverPoints,
  config: {
    BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, BOT_SPEED, BOT_DAMAGE,
    BOSS_COUNT, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_SHOOT_CD, BOSS_RADIUS, BOSS_NAME,
  },
  playerSafeCorner: PLAYER_SAFE_CORNER,
  shotCallback: (origin, dir, target, shooter) => {
    if (_spawnBulletFn) {
      const [worldOrigin, worldDir] = _botShotToWorld(origin, dir, target);
      // Pass the shooting bot's per-bot damage so the boss's bullet hits harder
      // (single-player). MP damage is server-authoritative regardless.
      _spawnBulletFn(worldOrigin, worldDir, false, shooter ? shooter.damage : undefined);
    }
    playBotShoot();
  },
  getPlayerCollider,
  isBridgeWalkable: _isOnBridge2,
  bridgeWaypoints: _BRIDGE2_WAYPOINTS,
});

export function initBots(playerObj, spawnBulletFn) {
  _playerObj     = playerObj;
  _spawnBulletFn = spawnBulletFn;

  // Pre-load the shared GLB template, then spawn all bots (sim owns spawn logic;
  // this wrapper attaches a model + colliders to each resulting sim state).
  //
  // v0.2.391 empty-arena fix: attach the REGULAR bots the instant the small
  // regular GLB is ready — do NOT block them on the 7.6MB boss GLB. The old code
  // attached every bot inside `bossReady.then(...)`, so the whole arena stayed
  // empty for the several seconds the boss model took to stream. The boss model
  // is fetched in PARALLEL and its single wrapper is attached whenever it lands
  // (falling back to the regular model if the boss GLB fails).
  preloadBotModel().then(() => {
    _modelsReady = true;
    // ADR-0021: never spawn the LOCAL roster once MP is authoritative. This
    // continuation is async, so MP can connect between initBots() and here —
    // without this guard the local bots are re-created after setBotNetMode(true)
    // already cleared them, and freeze again.
    if (_netMode) return;
    sim.spawnAll(BOT_COUNT);

    const bossStates = sim.bots.filter(st => st.kind === 'boss');
    // Kick off the boss GLB fetch NOW, in parallel with attaching regulars.
    const bossReady = bossStates.length
      ? preloadBossModel().then(() => true).catch(err => {
          console.warn('[bots] boss GLB load failed, using regular model:', err);
          return false;
        })
      : Promise.resolve(false);

    // Phase 1: regular bots populate the arena immediately.
    sim.bots.forEach(st => {
      if (st.kind !== 'boss') _attachModelBot(st, 'regular');
    });

    // Phase 2: attach the boss once its (parallel) GLB resolves.
    bossReady.then(bossOk => {
      // ADR-0021: the boss GLB is ~7.6MB, so this resolves late — MP has often
      // connected by now. Attaching here would re-add the frozen Augustink.
      if (_netMode) return;
      bossStates.forEach(st => _attachModelBot(st, bossOk ? 'boss' : 'regular'));
    });
  }).catch(err => {
    console.warn('[bots] GLB load failed, falling back to capsules:', err);
    if (_netMode) return;   // ADR-0021: server is authoritative in MP.
    _spawnCapsuleBots();
  });
}

// Build a wrapper bot around a sim state. `alive`/`hp` proxy the sim state so the
// combat raycast (which resolves colliders → this wrapper) reads live values; `pos`
// is a THREE.Vector3 mirror kept at y=0 (matching the original) for the headshot
// classifier. `mesh` points at the model root (or the capsule) for hit-detection.
function _makeWrapper(st, model, capsuleMesh) {
  const bot = {
    model,
    _capsuleMesh: capsuleMesh || null,
    state: st,
    pos: new THREE.Vector3(st.pos.x, 0, st.pos.z),
    _prevAlive: st.alive,
    _prevDying: st._isDying,
    rapierBody:     null,
    rapierCollider: null,
    rapierHeadBody: null,
    rapierHeadCollider: null,
    boneColliders: [],     // per-bone sensor colliders (v0.2.575)
    get mesh() { return this.model ? this.model.root : this._capsuleMesh; },
    get alive() { return this.state.alive; },
    get hp() { return this.state.hp; },
  };
  return bot;
}

function _attachModelBot(st, renderKind = 'regular') {
  // A server BOT_STATE can arrive before either GLB has loaded. _tickNet creates
  // a visible capsule for that authoritative row immediately; upgrade that same
  // wrapper in place instead of adding a duplicate bot with the same id.
  const existing = _botById(st.id);
  const current = existing?.state;
  // ADR-0013: regulars get a dwarf-name nameplate; boss keeps BOSS_NAME.
  // `st.name` is the authoritative name when MP is on; SP falls back to
  // the same deterministic mapping so the label matches either way.
  const label = renderKind === 'boss' ? null : (st.name || nameForBotId(st.id));
  const model = new BotModel(renderKind, label);
  const x = current?.pos?.x ?? st.pos.x;
  const z = current?.pos?.z ?? st.pos.z;
  model.init({ x, y: _footY(x, z), z });
  if (existing) {
    if (current) {
      st.pos.x = x; st.pos.z = z;
      st.rotY = current.rotY ?? st.rotY;
      st.hp = current.hp ?? st.hp;
      st.alive = current.alive ?? st.alive;
      st.animHint = current.animHint ?? st.animHint;
    }
    if (existing._capsuleMesh) {
      scene.remove(existing._capsuleMesh);
      existing._capsuleMesh.material?.dispose?.();
      existing._capsuleMesh = null;
    }
    existing.model = model;
    existing.state = st;
    existing.pos.set(x, 0, z);
    if (!st.alive) model.hide();
    // Create bone colliders for the newly-attached model (v0.2.575).
    if (physicsReady && model.skinnedMesh && existing.boneColliders.length === 0) {
      existing.boneColliders = createBotBoneColliders(existing, model.skinnedMesh);
    }
    return existing;
  }
  const bot = _makeWrapper(st, model, null);
  bots.push(bot);
  if (physicsReady) _ensureBotColliders(bot, st.pos.x, st.pos.z);
  return bot;
}

// Create (or re-position) both the body capsule AND head sphere for a bot.
// Body centre  = foot + BOT_BODY_CENTRE_Y_OFFSET (0.76)
// Head  centre = foot + BOT_HEAD_CENTRE_Y_OFFSET (1.55)
function _ensureBotColliders(bot, x, z) {
  if (!physicsReady) return;
  const fy = _footY(x, z);
  if (!bot.rapierBody) {
    const h = createBotBody(bot, x, fy + BOT_BODY_CENTRE_Y_OFFSET, z);
    if (h) { bot.rapierBody = h.body; bot.rapierCollider = h.collider; }
  } else {
    setBotBodyPos(bot.rapierBody, x, fy + BOT_BODY_CENTRE_Y_OFFSET, z);
  }
  if (!bot.rapierHeadBody) {
    const h = createBotHead(bot, x, fy + BOT_HEAD_CENTRE_Y_OFFSET, z);
    if (h) { bot.rapierHeadBody = h.body; bot.rapierHeadCollider = h.collider; }
  } else {
    setBotBodyPos(bot.rapierHeadBody, x, fy + BOT_HEAD_CENTRE_Y_OFFSET, z);
  }
  // Per-bone colliders — only for model bots with a SkinnedMesh (v0.2.575).
  if (bot.model?.loaded && bot.model.skinnedMesh && bot.boneColliders.length === 0) {
    bot.boneColliders = createBotBoneColliders(bot, bot.model.skinnedMesh);
  }
}

// Fallback if GLB fails — original capsule bots (still driven by the sim brain).
const _botGeo  = new THREE.CapsuleGeometry(0.35, 1.1, 4, 8);
const _colors  = [0x8b5cf6, 0xf7931a, 0x22d3ee, 0xf43f5e, 0x4ade80];
function _makeCapsuleBot(st, i = st.id) {
  const fy = _footY(st.pos.x, st.pos.z);
  const mesh = new THREE.Mesh(
    _botGeo,
    new THREE.MeshStandardMaterial({ color: _colors[i % _colors.length], roughness: 0.6 })
  );
  // Keep the fallback/streaming placeholder centred on the Rapier body capsule.
  // A separate head sphere still covers the upper aim zone.
  mesh.position.set(st.pos.x, fy + BOT_BODY_CENTRE_Y_OFFSET, st.pos.z);
  scene.add(mesh);
  const bot = _makeWrapper(st, null, mesh);
  bots.push(bot);
  if (physicsReady) _ensureBotColliders(bot, st.pos.x, st.pos.z);
  return bot;
}

function _spawnCapsuleBots() {
  sim.spawnAll(BOT_COUNT);
  sim.bots.forEach((st, i) => {
    const existing = _botById(st.id);
    if (!existing) {
      _makeCapsuleBot(st, i);
      return;
    }
    // Net mode may already have created the authoritative placeholder. Keep its
    // live pose/health while attaching the local sim state used after disconnect.
    const current = existing.state;
    st.pos.x = current.pos.x; st.pos.z = current.pos.z;
    st.rotY = current.rotY ?? st.rotY;
    st.hp = current.hp ?? st.hp;
    st.alive = current.alive ?? st.alive;
    st.animHint = current.animHint ?? st.animHint;
    existing.state = st;
  });
}

export function initBotPhysics() {} // API compat

// ── Tick ──────────────────────────────────────────────────────────────────────
export function tickBots(dt) {
  if (!isPlaying()) return;
  // MP: render-only. Interpolate positions from the server's BOT_STATE stream
  // and drive animation from animHint; never run the local AI or apply damage.
  if (_netMode) { _tickNet(dt); return; }
  const pp = _playerObj.position;
  const playerState = {
    x: pp.x, y: pp.y, z: pp.z,
    outsideFence: isPlayerOutsideFence(),
    flyEnabled: isFlyEnabled(),
  };
  // The brain moves + decides for every bot; the wrapper only renders the result.
  // Single-player passes a 1-element array → byte-identical target selection.
  sim.tick(dt, [playerState]);
  bots.forEach(bot => _syncBot(bot, dt));
}

// ── MP render-only path ─────────────────────────────────────────────────────
function _botById(id) { return bots.find(b => b.state.id === id) || null; }

// Ingest a server BOT_STATE roster (throttled continuous stream OR a full
// late-join snapshot). Positions are buffered for interpolation.
export function ingestBotState(states) {
  if (!Array.isArray(states)) return;
  _botNet.ingest(states, _nowMs());
}

// A bot fired — spawn the enemy tracer bullet + play the bot-shoot cue. Mirrors
// the single-player shotCallback so the visual/audio is identical.
export function applyBotShot(originArr, dirArr) {
  if (!Array.isArray(originArr) || !Array.isArray(dirArr)) return;
  const origin = { x: originArr[0], y: originArr[1], z: originArr[2] };
  const dir = { x: dirArr[0], y: dirArr[1], z: dirArr[2] };
  if (_spawnBulletFn) _spawnBulletFn(origin, dir, false);
  playBotShoot();
}

// Server says a player's shot hit a bot — sync authoritative HP + hit flash.
// ADR-0042: drive a visible bot reaction on every server-confirmed hit — a red
// emissive flash (flashHit) + an HP chip redraw on the nameplate
// (updateNameplate). Bots are excluded from the sticker decal raycaster by
// design (botModel.js `isBotMesh` flag), so this flash + chip + the death anim
// ARE the owner's hit feedback, not a sticker on the mesh.
export function applyBotHit(botId, hp, zone) {
  // Fold the authoritative hp into botNetState FIRST so the next _syncNetBot
  // frame samples the event hp — not the stale pre-hit snapshot (v0.2.383 fix).
  const before = _botById(botId)?.state?.hp;
  _botNet.applyHit(botId, hp);
  const bot = _botById(botId);
  if (!bot) return;
  bot.state.hp = hp;
  // INVARIANT (v0.2.663): mirror the botNetState coercion so the wrapper state
  // can't hold hp<=0 + alive=true either (the render path reads bot.state.alive
  // for nameplate visibility + collider parking in some branches).
  if (hp <= 0) bot.state.alive = false;
  bot.state._isHit = true;
  bot.state._hitTimer = 0.3;
  // ADR-0042: visible reaction — tint the bot red + redraw the HP chip.
  bot.model?.flashHit();
  const maxHp = (bot.state.kind === 'boss') ? BOSS_HP : BOT_HP;
  bot.model?.updateNameplate(bot.state?.name || bot.state?.kind || '', hp / maxHp);
  // ADR-0013 diagnostics: log MP-authoritative hits.
  const pp = _playerObj?.position;
  const dist = pp ? Math.hypot(pp.x - bot.pos.x, pp.z - bot.pos.z) : NaN;
  logBotShot({
    botId,
    name: bot.state?.name,
    hpBefore: before ?? hp,
    hpAfter: hp,
    zone: zone || 'unknown',
    alive: bot.state.alive,
    isDying: bot.state._isDying,
    lod: bot.model?.loaded ? 'full' : 'capsule',
    dist,
  });
}

// Server says a bot died — mark it dead so the render path hides it. Fold the
// kill into botNetState (sets alive=false + snaps) so the next _syncNetBot frame
// sees dead — not the stale pre-kill snapshot that would un-kill it (v0.2.383).
export function applyBotKill(botId, meta) {
  _botNet.applyKill(botId);
  const bot = _botById(botId);
  if (bot) {
    bot.state.alive = false;
    // ADR-0042: drain HP to 0 so the nameplate chip empties + a final red
    // flash so the death reads as a hit, not a silent disappear. The death
    // animation itself is driven by the render loop passing `!st.alive`.
    bot.state.hp = 0;
    bot.model?.flashHit();
    bot.model?.updateNameplate(bot.state?.name || bot.state?.kind || '', 0);
  }
  // ADR-0013 diagnostics: log MP-authoritative kills.
  logBotKill({
    botId,
    name: bot?.state?.name,
    causedBy: meta?.causedBy || 'unknown',
    headshot: !!meta?.headshot,
  });
}

function _tickNet(dt) {
  const poses = _botNet.sample(_nowMs());
  let bossPose = null;
  for (const p of poses) {
    // Server authority starts before the asynchronous GLBs necessarily finish.
    // Materialise every authoritative row as a correctly-positioned capsule so
    // no bot can shoot or damage a player without a render-side counterpart.
    let bot = _botById(p.id);
    if (!bot) {
      const st = {
        id: p.id,
        kind: p.kind || 'regular',
        name: p.name || '',
        pos: { x: p.x, z: p.z },
        hp: p.hp,
        alive: p.alive,
        rotY: p.rotY,
        animHint: p.animHint,
        _isHit: false,
        _hitTimer: 0,
        _isDying: false,
      };
      bot = _makeCapsuleBot(st, p.id);
      bot._prevAlive = p.alive;
    }
    // ADR-0022 — MP must attach its OWN models. _tickNet materialises every
    // authoritative row as a capsule placeholder, but nothing ever upgraded that
    // placeholder to the GLB: `_modelsReady` was set and never read, and
    // `_attachModelBot` was called only from the SP init path. MP therefore
    // worked by accident — it reused the LOCAL roster's already-modelled
    // wrappers whenever a server id happened to match. With the local roster
    // correctly removed (ADR-0021) only the capsule remained: no GLB, no
    // SkinnedMesh, and so no per-bone limb colliders. Upgrade in place as soon
    // as the relevant template is ready (BotModel.init is synchronous once the
    // template is cached, and sets skinnedMesh → bone colliders get built).
    if (_modelsReady && !bot.model) {
      if (p.kind !== 'boss') {
        _attachModelBot(bot.state, 'regular');
      } else if (_bossModelReady) {
        _attachModelBot(bot.state, 'boss');
      } else if (_bossFallbackRegular) {
        _attachModelBot(bot.state, 'regular');
      } else {
        _ensureBossPreload();   // stays a capsule until the boss GLB lands
      }
    }
    _syncNetBot(bot, p, dt);
    if (!bossPose && p.kind === 'boss') bossPose = p;
  }
  if (!bossPose || !bossPose.alive) {
    _resetBossBarTracking();
    hideBossBar();
    return;
  }

  // v0.2.487: hide boss health bar in fly mode — it's a debug view, not combat
  if (isFlyEnabled()) {
    hideBossBar();
    return;
  }

  const bossId = bossPose.id == null ? '' : String(bossPose.id);
  if (_bossNetId !== bossId) {
    _bossNetId = bossId;
    _prevBossNetHp = null;
    _bossLastHitMs = -Infinity;
  }

  const playerPos = _playerObj?.position;
  const dist = playerPos
    ? Math.hypot(playerPos.x - bossPose.x, playerPos.z - bossPose.z)
    : Infinity;
  const engagement = decideBossEngagement({
    dist,
    bossHp: bossPose.hp,
    prevBossHp: _prevBossNetHp,
    now: _nowMs(),
    lastHitMs: _bossLastHitMs,
    engageRange: Math.min(BOSS_BAR_ENGAGE_RANGE, ARENA_HALF),
    recentHitMs: BOSS_BAR_RECENT_HIT_MS,
  });
  _bossLastHitMs = engagement.newLastHitMs;
  _prevBossNetHp = bossPose.hp;
  if (!engagement.engaged) {
    hideBossBar();
    return;
  }

  const anchor = _projectBossBarAnchor(bossPose);
  setBossBar({
    id: bossPose.id,
    name: bossPose.name || 'BOSS',
    hp: bossPose.hp,
    maxHp: BOSS_HP,
    alive: true,
    screenX: anchor.screenX,
    screenY: anchor.screenY,
    anchored: anchor.visible,
  });
}

function _syncNetBot(bot, pose, dt) {
  const st = bot.state;
  // Mirror the interpolated server pose into the wrapper's sim-state bag so the
  // rest of the client (HUD, headshot classifier, etc.) reads live values.
  st.pos.x = pose.x; st.pos.z = pose.z; st.rotY = pose.rotY;
  st.hp = pose.hp; st.animHint = pose.animHint;
  bot.pos.set(pose.x, 0, pose.z);
  const fy = _footY(pose.x, pose.z);
  const flags = animHintToFlags(pose.animHint);

  if (!pose.alive) {
    st.alive = false;
    if (bot.model?.loaded) {
      if (bot._prevAlive) { bot.model.updateAnim(0, false, true, false); bot._deathT = 0; } // death on transition
      // v0.2.389: restore the dramatic launch arc. The snapshot carries the
      // horizontal blowback slide (pose.x/z move as the server integrates it) but
      // NOT the vertical component, so a server-driven corpse used to stay pinned
      // to the ground. Reconstruct the arc client-side from the death clock,
      // mirroring botSim's integration (initial up-velocity 9 m/s, gravity
      // −14 m/s²): height = 9t − 7t², a ~2.9 m peak at ~0.64 s, back to ground by
      // ~1.3 s — the corpse now flies up and back across the arena as it did in SP.
      bot._deathT = (bot._deathT || 0) + dt;
      const arc = Math.max(0, 9.0 * bot._deathT - 7.0 * bot._deathT * bot._deathT);
      bot.model.syncTo(pose.x, fy + arc, pose.z, pose.rotY);
      bot.model.tick(dt);
      // ADR-0016 D-2: during the death arc keep the corpse visible so the
      // ragdoll flight can never pop mid-animation. After the arc completes,
      // run LOD so distant old corpses cull consistently with live bots.
      if (bot._deathT > DEATH_ARC_DURATION) {
        const pPosDead = _playerObj.position;
        const lodDead = getLodLevel(pose.x, pose.z, pPosDead.x, pPosDead.z, bot.state?.id);
        applyLod(bot.model, lodDead);
      } else if (bot.model.root) {
        bot.model.root.visible = true;
      }
      // ADR-0016 D-1/D-3: nameplate visible iff body visible AND alive.
      // Dead → hide, unconditionally.
      bot.model.setNameplateVisible(false);
    } else if (bot._capsuleMesh) {
      bot._capsuleMesh.visible = false;
    }
    // Park VISUAL-ONLY colliders below the floor so local bullets can't resolve
    // a hit on a dead bot (damage is server-authoritative regardless).
    if (bot.rapierBody)     setBotBodyPos(bot.rapierBody,     pose.x, -100, pose.z);
    if (bot.rapierHeadBody) setBotBodyPos(bot.rapierHeadBody, pose.x, -100, pose.z);
    // Park bone colliders too (v0.2.575).
    if (bot.boneColliders.length > 0) {
      for (const bc of bot.boneColliders) bc.body.setNextKinematicTranslation({ x: pose.x, y: -100, z: pose.z });
    }
    bot._prevAlive = false;
    return;
  }

  st.alive = true;
  // Spawn/respawn transition — (re)create + show.
  if (!bot._prevAlive) {
    // ADR-0013 diagnostics: log the alive-transition (spawn OR respawn).
    logBotRespawn({ botId: pose.id, name: pose.name || st.name, x: pose.x, z: pose.z });
    _ensureBotColliders(bot, pose.x, pose.z);
    if (bot.model?.root) { bot.model.show(); bot.model.play('Walking', true); }
    else if (bot._capsuleMesh) bot._capsuleMesh.visible = true;
  }
  if (!bot.rapierBody || !bot.rapierHeadBody) {
    _ensureBotColliders(bot, pose.x, pose.z);
  } else {
    setBotBodyPos(bot.rapierBody,     pose.x, fy + BOT_BODY_CENTRE_Y_OFFSET, pose.z);
    setBotBodyPos(bot.rapierHeadBody, pose.x, fy + BOT_HEAD_CENTRE_Y_OFFSET, pose.z);
  }

  const pPos = _playerObj.position;
  const dist = Math.hypot(pPos.x - pose.x, pPos.z - pose.z);
  const lod = getLodLevel(pose.x, pose.z, pPos.x, pPos.z, bot.state?.id);
  applyLod(bot.model, lod);
  if (bot.model?.loaded) {
    bot.model.syncTo(pose.x, fy, pose.z, pose.rotY);
    if (lod === 'full') {
      bot.model.updateAnim(dist, flags.isShooting, false, flags.isHit);
      bot.model.tick(dt);
    }
  } else if (bot._capsuleMesh && !bot.model) {
    bot._capsuleMesh.position.set(pose.x, fy + BOT_BODY_CENTRE_Y_OFFSET, pose.z);
    bot._capsuleMesh.rotation.y = pose.rotY;
  }
  // Sync per-bone colliders after model update (v0.2.575).
  if (bot.boneColliders.length > 0 && bot.model?.root) {
    bot.model.root.updateMatrixWorld(true);
    syncNpcBoneColliders(bot.boneColliders);
  }
  // ADR-0016 D-1/D-4: nameplate visible iff body visible AND alive. The alive
  // branch already ran applyLod; sample root.visible after LOD has decided.
  if (bot.model) {
    const bodyVisible = bot.model.root?.visible === true;
    bot.model.setNameplateVisible(bodyVisible && st.alive === true);
  }
  bot._prevAlive = true;
}

// Render one wrapper bot from its (already-ticked) sim state.
function _syncBot(bot, dt) {
  const st = bot.state;
  bot.pos.set(st.pos.x, 0, st.pos.z);

  // Dead — blowback corpse anim + hide, then wait for respawn (sim owns timers).
  if (!st.alive) {
    if (st._isDying && bot.model?.root) {
      bot.model.tick(dt);
      bot.model.syncTo(st.pos.x, st._blowY, st.pos.z, bot.model.root.rotation.y);
    }
    // Hide exactly on the frame the death anim finishes (matches the original).
    if (bot._prevDying && !st._isDying) bot.model?.hide();
    bot._prevDying = st._isDying;
    bot._prevAlive = st.alive;
    return;
  }

  // Revive transition — mirror the original _reviveBot render; the full AI tick
  // resumes next frame (the sim likewise skips movement on the revive frame).
  if (!bot._prevAlive) {
    // ADR-0013 diagnostics: log the SP alive-transition (spawn OR respawn).
    logBotRespawn({ botId: st.id, name: st.name, x: st.pos.x, z: st.pos.z });
    _ensureBotColliders(bot, st.pos.x, st.pos.z);
    if (bot.model?.root) {
      bot.model.show();
      bot.model.syncTo(st.pos.x, _footY(st.pos.x, st.pos.z), st.pos.z, 0);
      bot.model.play('Walking', true);
    } else if (bot._capsuleMesh) {
      bot._capsuleMesh.position.set(
        st.pos.x,
        _footY(st.pos.x, st.pos.z) + BOT_BODY_CENTRE_Y_OFFSET,
        st.pos.z,
      );
      bot._capsuleMesh.visible = true;
    }
    bot._prevDying = false;
    bot._prevAlive = true;
    return;
  }

  // Sync Rapier body + head colliders. Lazy-create here if missing (covers the
  // race where the GLB loaded before physics finished init). Centres ride the
  // sampled foot height + fixed body/head offsets so headshots stay aligned.
  if (!bot.rapierBody || !bot.rapierHeadBody) {
    _ensureBotColliders(bot, st.pos.x, st.pos.z);
  } else {
    const fy = _footY(st.pos.x, st.pos.z);
    setBotBodyPos(bot.rapierBody,     st.pos.x, fy + BOT_BODY_CENTRE_Y_OFFSET, st.pos.z);
    setBotBodyPos(bot.rapierHeadBody, st.pos.x, fy + BOT_HEAD_CENTRE_Y_OFFSET, st.pos.z);
  }

  const pPos = _playerObj.position;
  const dist = Math.hypot(pPos.x - st.pos.x, pPos.z - st.pos.z);

  // LOD — skip mixer on distant bots, hide very distant ones.
  const lod = getLodLevel(st.pos.x, st.pos.z, pPos.x, pPos.z, st.id);
  applyLod(bot.model, lod);

  if (bot.model?.loaded) {
    bot.model.syncTo(st.pos.x, _footY(st.pos.x, st.pos.z), st.pos.z, st.rotY);
    if (lod === 'full') {
      // ADR-0042: decay the one-shot hit flag so the flinch animation plays
      // once per confirmed hit instead of replaying every frame while
      // `_isHit` stays true. Also pass the authoritative death state through
      // (previously hard-coded `false`) so the death anim actually plays.
      if (st._isHit && st._hitTimer > 0) {
        st._hitTimer -= dt;
        if (st._hitTimer <= 0) st._isHit = false;
      }
      bot.model.updateAnim(dist, st.isShooting, !st.alive, st._isHit);
      bot.model.tick(dt);
      // ADR-0042: keep the HP chip in sync whenever HP changes (hit OR
      // respawn), not only on the applyBotHit frame.
      if (st._lastHpShown !== st.hp) {
        st._lastHpShown = st.hp;
        const maxHp = (st.kind === 'boss') ? BOSS_HP : BOT_HP;
        bot.model.updateNameplate(st.name || st.kind || '', st.hp / maxHp);
      }
    }
  } else if (bot._capsuleMesh && !bot.model) {
    bot._capsuleMesh.position.set(
      st.pos.x,
      _footY(st.pos.x, st.pos.z) + BOT_BODY_CENTRE_Y_OFFSET,
      st.pos.z,
    );
    bot._capsuleMesh.rotation.y = st.rotY;
  }

  // Sync per-bone colliders after model update (v0.2.575).
  if (bot.boneColliders.length > 0 && bot.model?.root) {
    bot.model.root.updateMatrixWorld(true);
    syncNpcBoneColliders(bot.boneColliders);
  }

  // ADR-0016 D-1/D-4: nameplate visible iff body visible AND alive.
  if (bot.model) {
    const bodyVisible = bot.model.root?.visible === true;
    bot.model.setNameplateVisible(bodyVisible && st.alive === true);
  }

  bot._prevDying = st._isDying;
  bot._prevAlive = st.alive;
}

// ── Hit / Kill ────────────────────────────────────────────────────────────────
export function hitBot(bot, dmg, meta) {
  // MP: damage is server-authoritative (resolved via the SHOT path → BOT_HIT).
  // The client must NEVER apply local bot damage.
  if (_netMode) return;
  const pp = _playerObj ? _playerObj.position : null;
  const hpBefore = bot.state.hp;
  const res = sim.hitBot(bot.state, dmg, pp);
  const hpAfter = bot.state.hp;
  const dist = pp ? Math.hypot(pp.x - bot.pos.x, pp.z - bot.pos.z) : NaN;
  // ADR-0013 diagnostics: log SP-path shots so SP + MP look the same in logs.
  logBotShot({
    botId: bot.state.id,
    name: bot.state?.name,
    hpBefore,
    hpAfter,
    zone: meta?.zone || (meta?.isHead ? 'head' : 'body'),
    alive: bot.state.alive,
    isDying: bot.state._isDying,
    lod: bot.model?.loaded ? 'full' : 'capsule',
    dist,
  });
  if (res.killed) {
    logBotKill({
      botId: bot.state.id,
      name: bot.state?.name,
      causedBy: 'player',
      headshot: !!meta?.isHead,
    });
    _applyKillRender(bot);
  } else {
    emit(EV.BOT_HIT, { bot });
  }
}

// The render + game-state side-effects of a kill (the sim only mutated the pure
// state). Death anim, park BOTH colliders far below the floor so bullets can't hit
// a dying bot, then the score/emit side-effects the brain deliberately does NOT own.
function _applyKillRender(bot) {
  const st = bot.state;
  if (bot.model?.loaded) {
    bot.model.updateAnim(0, false, true, false);
  } else if (bot.mesh) {
    bot.mesh.visible = false;
    st._isDying = false; // capsule fallback has no death anim
  }
  if (bot.rapierBody)     setBotBodyPos(bot.rapierBody,     bot.pos.x, -100, bot.pos.z);
  if (bot.rapierHeadBody) setBotBodyPos(bot.rapierHeadBody, bot.pos.x, -100, bot.pos.z);
  // Park bone colliders too (v0.2.575).
  if (bot.boneColliders.length > 0) {
    for (const bc of bot.boneColliders) bc.body.setNextKinematicTranslation({ x: bot.pos.x, y: -100, z: bot.pos.z });
  }
  bot._prevAlive = false;
  bot._prevDying = st._isDying;

  state.kills++;
  state.sats += 5;
  emit(EV.BOT_KILLED, { sats: 5 });
  emit(EV.HUD_UPDATE);
}
