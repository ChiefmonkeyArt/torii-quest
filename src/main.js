// main.js — wiring only. No game logic here.
import { state, isTitle, isPlaying, isPaused, isLive, needsPointerLock, isReloading, transition, GAME_EVENT, resetRun } from './state.js';
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
import { initHUD, tickHUD, flashCross, drawMinimap, setNapMode, showPortalPrompt, hidePortalPrompt, showZoneNotice, hideZoneNotice } from './hud.js';
import { ARENA_HALF, WALL_H, NAP_X } from './config.js';
import { createGatewayPortalBoundary } from './engine/gateway/gatewayPortalActivation.js';
import { createPortalTrigger } from './engine/gateway/portalTrigger.js';
import { buildPortalMesh, tickPortalMesh } from './engine/gateway/portalMesh.js';
import { parseZoneRoute, ZONE_ROUTE_KIND } from './engine/gateway/zoneRoute.js';
import { portalPromptLabel, enteredZoneLabel } from './engine/gateway/zoneLabel.js';
import { scene } from './scene.js';
import { nostrLogin } from './nostr.js';
import { playShoot, playFootstep, playJumpLand } from './audio.js';
import { initPlayerStats } from './playerStats.js';
import { installToriiDebug } from './engine/debug/toriiDebug.js';
import { applyPhaseScreens } from './engine/ui/phaseScreens.js';
import { gatewayPreviewBlock } from './engine/gateway/gatewayPreview.js';
import { createToriiGateway } from './engine/components/toriiGateway.js';
import { productPreviewBlock } from './engine/components/productPreview.js';
import { leaderboardPreviewBlock } from './engine/nostr/leaderboardPreview.js';
import { updatePreviewBlock } from './engine/update/updatePreview.js';
import { mvpLoopSummary } from './engine/mvpLoop.js';
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

// MVP loop header (v0.2.143) — render the inert title-screen header that frames
// the four preview cards below as one proof-of-concept loop (Travel → Market →
// Score → Update) from the pure mvpLoopSummary block. Content/labelling ONLY: it
// writes the flow + note via textContent and NEVER navigates, fetches, signs,
// publishes, or updates — actionable:false by construction.
function renderMvpLoop() {
  const flowEl = document.getElementById('mvp-loop-flow');
  const noteEl = document.getElementById('mvp-loop-note');
  if (!flowEl || !noteEl) return;
  const block = mvpLoopSummary();
  flowEl.textContent = block.flow; // textContent only — labelling, no action/link
  noteEl.textContent = block.note;
}
renderMvpLoop();

// Gateway/NAP-to-NAP PREVIEW (LEAN-2, v0.2.139) — render the inert title-screen
// preview card ONCE from the pure gatewayPreview block. This is display-only: it
// shows a demo destination/intent/status so the freedom-tech hop is visible on
// the title screen, but it NEVER navigates, fetches, signs, or publishes. The
// armed demo gate (target + relay) makes the preview show a ready/armed view;
// crossing the gate stays a deferred host decision (see GATEWAY_PROTOCOL.md).
function renderGatewayPreview() {
  const body = document.getElementById('gateway-preview-body');
  if (!body) return;
  const demoGate = createToriiGateway({
    target: 'plebeian-market-bazaar',
    relay: 'wss://relay.example.com',
  });
  const block = gatewayPreviewBlock(demoGate, { from: 'torii-quest' });
  body.replaceChildren(...block.lines.flatMap(({ label, value }) => {
    const l = document.createElement('div');
    l.className = 'gw-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'gw-row-value';
    v.textContent = value; // textContent only — no HTML, no link, no navigation
    return [l, v];
  }));
}
renderGatewayPreview();

// ── Live in-world GATEWAY PORTAL trigger (v0.2.181) ────────────────────────────
// THE composition-root boundary: this is the ONE place a REAL browser `window` is
// injected into the v0.2.180 portal-activation seam. The boundary captures it once;
// the pure portalTrigger never touches a global window. Proximity (the per-frame
// tick in update()) only ARMS the inert boundary + raises the HUD prompt — it never
// navigates. A real same-origin `/zone/…` hop happens ONLY on the explicit KeyF
// interact below, which clears all three v0.2.178 gates (confirmed===true → consent
// → scoped allowlist). External website URLs are dropped by portalActivationInput;
// the allowlist is hard-scoped to ['/zone/'] (never ['/']).
const _portalGateway = createToriiGateway({
  target: 'plebeian-market-bazaar',
  relay: 'wss://relay.example.com',
  position: { x: ARENA_HALF, y: 0, z: 0 },
});
const _portalBoundary = createGatewayPortalBoundary({
  window,                         // ← the ONLY browser-window injection point
  routeAllowlist: ['/zone/'],     // scoped same-origin prefix; never permit-all
  hostContext: {
    currentRoute: window.location?.pathname || '/',
    rollbackRoute: window.location?.pathname || '/',
  },
  home: '/',
});
const _portalTrigger = createPortalTrigger({
  boundary: _portalBoundary,
  component: _portalGateway,
  context: { title: 'Plebeian Market Bazaar', zoneType: 'shop', from: 'torii-quest' },
  portalPos: { x: ARENA_HALF, y: 0, z: 0 },
  range: 3,
  // v0.2.184 — name the target zone in the in-range prompt so the player sees WHERE
  // KeyF travels (display-only string; still arms-only, never navigates on proximity).
  promptText: portalPromptLabel({ slug: 'plebeian-market-bazaar' }),
  onPrompt: (show, text) => { if (show) showPortalPrompt(text); else hidePortalPrompt(); },
});

// ── Visible in-world PORTAL MARKER mesh (v0.2.183) ─────────────────────────────
// Build a dedicated, inert visual marker at the SAME position + range as the trigger
// above, so the player can clearly SEE the travel point they are approaching. The
// outer ring radius EQUALS the trigger range, so the ring is the proximity boundary.
// DISPLAY-ONLY: no collider, no raycast, no input — it changes NOTHING about the
// safety model (proximity still only arms; KeyF still confirms the same-origin hop).
// Built ONCE here; the per-frame tick only mutates scalars (spin/pulse — no alloc).
buildPortalMesh(scene, {
  position: _portalTrigger.portalPos(),
  range: _portalTrigger.range(),
  title: 'Plebeian Market Bazaar',
});

// ── SPA /zone/<slug> route resolution (v0.2.182) ──────────────────────────────
// Give the same-origin URL the portal trigger pushes a safe client-side meaning on
// hard-refresh / deep-link / back-forward. The PURE parser (zoneRoute.js) classifies
// window.location.pathname; the app only shows an INERT notice — it loads no zone
// scene, fetches nothing, and never navigates. A valid `/zone/<slug>` shows the
// resolved title + placeholder; an invalid/unsafe path shows a staying-home notice;
// the bare home route clears it. NOTE: a hard refresh only reaches this code if the
// static host serves index.html for `/zone/*` (SPA fallback — see HANDOFF.md); when
// it does, this is the resolution.
function _applyZoneRoute() {
  const r = parseZoneRoute(window.location?.pathname || '/');
  if (r.kind === ZONE_ROUTE_KIND.HOME) hideZoneNotice();
  else showZoneNotice(r.notice);
  return r;
}
_applyZoneRoute();
// Back/forward between pushed zone states + home re-resolves the notice (inert).
window.addEventListener('popstate', _applyZoneRoute);

// Plebeian/Nostr product/market PREVIEW (LEAN-3, v0.2.140) — render the inert,
// read-only title-screen product card ONCE from the pure productPreview block.
// This is display-only: it shows a sample listing's identity, price, Nostr
// seller (npub) ownership proof, and the Plebeian.Market link as TEXT, so the
// freedom-tech commerce proof is visible on the title screen. It has NO
// checkout/pay/zap and NEVER navigates, fetches, signs, or publishes.
function renderProductPreview() {
  const body = document.getElementById('product-preview-body');
  if (!body) return;
  const block = productPreviewBlock({
    title: 'Sticker Gun Skin',
    sellerNpub: 'npub1demo0seller0fixture0pleb0market0xxxxxxxxxxxxxxxxxxxx',
    priceSats: 2100,
    url: 'https://plebeian.market/listing/sticker-gun',
    reward: 'Sticker Gun skin',
  });
  body.replaceChildren(...block.lines.flatMap(({ label, value }) => {
    const l = document.createElement('div');
    l.className = 'pp-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'pp-row-value';
    v.textContent = value; // textContent only — no HTML, no link, no checkout, no navigation
    return [l, v];
  }));
}
renderProductPreview();

// Local/mock leaderboard PREVIEW (LEAN-4, v0.2.141) — render the inert,
// read-only title-screen leaderboard card ONCE from the pure leaderboardPreview
// block. This is display-only: it ranks a handful of LOCAL/MOCK scores and shows
// the Nostr score-event proof shape (kind/topic) plus the npub that WOULD sign,
// so the freedom-tech leaderboard proof is visible on the title screen. It does
// NO NIP-07 signing, NO relay publish, NO live submission, and NEVER fetches —
// signed:false / published:false by construction (SEC-1 consent gate is deferred).
function renderLeaderboardPreview() {
  const body = document.getElementById('leaderboard-preview-body');
  if (!body) return;
  const block = leaderboardPreviewBlock(
    [
      { runId: 'plebshot', score: 240, kills: 20, headshots: 11, accuracy: 0.71 },
      { runId: 'nostrich', score: 180, kills: 16, headshots: 7, accuracy: 0.64 },
      { runId: 'chiefmonkey', score: 120, kills: 12, headshots: 5, accuracy: 0.58 },
    ],
    { signerNpub: 'npub1demo0player0fixture0torii0quest0xxxxxxxxxxxxxxxxxxxx', limit: 3 },
  );
  body.replaceChildren(...block.lines.flatMap(({ label, value }) => {
    const l = document.createElement('div');
    l.className = 'lb-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'lb-row-value';
    v.textContent = value; // textContent only — no HTML, no sign, no publish, no submit
    return [l, v];
  }));
}
renderLeaderboardPreview();

// torii.quest update-check PREVIEW (LEAN-5, v0.2.142) — render the inert,
// read-only title-screen update card ONCE from the pure updatePreview block. This
// is display-only: it compares the running VERSION against a DETERMINISTIC LOCAL
// SAMPLE release (no GitHub fetch) and shows the running version, the sampled
// latest release, the update-available/up-to-date/unknown status, and the GitHub
// releases path as TEXT — so the "the world can keep itself current" proof is
// visible on the title screen. It does NO network fetch, NO install, NO shell
// execution, NO auto-update, and NEVER navigates — actionable:false by construction
// (the real read-only fetch + any "Update" affordance stay MANUAL host steps).
function renderUpdatePreview() {
  const body = document.getElementById('update-preview-body');
  if (!body) return;
  const block = updatePreviewBlock({
    tag_name: 'v0.2.999-alpha',
    name: 'Torii Quest v0.2.999-alpha',
    html_url: 'https://github.com/torii-quest/torii-quest/releases/tag/v0.2.999-alpha',
    body: 'Sample release notes (local fixture) — bigger arena, nostrich skins, Chiefmonkey balance.',
    prerelease: true,
    published_at: '2026-06-24T00:00:00Z',
  });
  body.replaceChildren(...block.lines.flatMap(({ label, value }) => {
    const l = document.createElement('div');
    l.className = 'up-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'up-row-value';
    v.textContent = value; // textContent only — no HTML, no link, no fetch, no auto-update
    return [l, v];
  }));
}
renderUpdatePreview();

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
// v0.2.228: #nostr-status never existed in index.html, so login feedback was
// written to a null element and silently dropped (cloud/no-extension clicks
// looked like dead buttons). Both entry buttons now surface state through the
// real, visible #entry-status line via showEntryStatus().
const elEntryStatus = document.getElementById('entry-status');
function showEntryStatus(msg) {
  if (!elEntryStatus) return;
  elEntryStatus.textContent = msg || '';
  elEntryStatus.style.display = msg ? 'block' : 'none';
}

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
    // v0.2.229: show an IMMEDIATE visible status line on click (was a clear).
    // The Rapier WASM bootstrap can stall in a cloud/headless browser — if the
    // promise never settles, neither the try-success nor the catch runs, so the
    // only feedback would be the disabled button text. A visible "Entering
    // arena…" line guarantees the click is never an apparent silent no-op while
    // loading; it is cleared on a successful entry below (or replaced by the
    // failure message in the catch).
    showEntryStatus('Entering arena…');
    try {
      await initPhysics();
      buildArenaColliders();
      buildDynamicCrates();
      const handle = spawnPlayerBody();
      setPlayerBody(handle);
      // Load Chiefmonkey player model — attaches to playerObj (camera parent).
      // Once only: re-attaching on every entry would stack duplicate viewmodels.
      // v0.2.228: these were OUTSIDE the try, so a throw here left the button
      // stuck on "LOADING PHYSICS…" forever. Now any bootstrap failure resets
      // the button and shows a user-facing message instead of a silent no-op.
      loadPlayerModel(playerObj);
      loadFirstPersonBody(playerObj);
      buildNapNpc();
    } catch (e) {
      console.error('Arena bootstrap failed:', e);
      elEnterBtn.textContent = 'ENTER ARENA';
      elEnterBtn.disabled = false;
      showEntryStatus('⚠ Arena failed to load — please reload the page and try again.');
      return;
    }
    _arenaBootstrapped = true;
  }
  showEntryStatus('');

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
// v0.2.230: signal the index.html inline fallback that the REAL ENTER handler is now
// bound, so it stands down and lets the module own the click. If the module bundle
// 404s or throws at eval before reaching here, this flag stays falsy and the inline
// listener gives visible feedback instead of a silent no-op (the live MVP blocker).
window.__toriiEnterReady = true;

// Nostr login (left panel + centre panel buttons share same handler)
async function _doNostrLogin() {
  // v0.2.228: surface the result on the visible #entry-status line. Anonymous
  // entry is by design — login is never required to ENTER ARENA — so when no
  // NIP-07 signer exists this just shows "NIP-07 extension not found" rather
  // than failing silently. No network/write beyond the existing NIP-07 read.
  showEntryStatus('Connecting…');
  // v0.2.229: guard the await so a THROW (not just a returned error string) still
  // surfaces a visible message instead of leaving the interim "Connecting…" stuck
  // on screen. nostrLogin() already returns 'NIP-07 extension not found' for the
  // no-signer case; this only catches unexpected throws. textContent (via
  // showEntryStatus), never innerHTML — no secret/markup injection.
  try {
    const result = await nostrLogin();
    showEntryStatus(result);
  } catch (e) {
    console.error('Nostr login failed:', e);
    showEntryStatus('⚠ Login unavailable — you can still ENTER ARENA anonymously.');
  }
}
elNostrCentreBtn?.addEventListener('click', _doNostrLogin);
// v0.2.230: signal the index.html inline fallback that the REAL LOGIN handler is bound
// (see window.__toriiEnterReady). Until set, the inline path surfaces the no-provider
// case visibly so a dead bundle is never a silent no-op.
window.__toriiLoginReady = true;

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

// KeyF — the EXPLICIT portal interact (v0.2.181). The ONLY thing that confirms a
// hop: acts only while playing AND the boundary is armed (player in range). A safe
// no-op otherwise. Proximity alone never navigates; this is the deliberate, auditable
// confirmation step. Uses a dedicated key (KeyF) so it never collides with movement
// or KeyE/Space jump.
onKeyDown(code => {
  if (code !== 'KeyF') return;
  if (!isPlaying() || !_portalTrigger.isArmed()) return;
  const rep = _portalTrigger.interact(true);
  // v0.2.184 — after a successful same-origin /zone/ hop, surface a concise inert
  // notice naming the entered zone. pushState does NOT fire popstate, so without this
  // the zone-notice would not refresh until a reload. Display-only: textContent, no
  // navigation, no load — the hop itself was already gated by interact()/confirm().
  if (rep && rep.navigated === true && typeof rep.zoneId === 'string') {
    const label = enteredZoneLabel(rep.zoneId);
    if (label) showZoneNotice(label);
  }
});

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
on(EV.HUD_UPDATE,    () => { if (isReloading()) triggerReload(); });

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

  tickPlayerModel(dt, _isShooting, isReloading(), _isJumping, !_isJumping);
  tickFirstPersonBody(dt);
  tickNapNpc(dt);
  _isShooting = false; // reset after 1 frame
  setNapMode(playerObj.position.x > NAP_X);
  // Portal proximity (v0.2.181) — INERT: arms/disarms the boundary + toggles the
  // prompt only. Never navigates; the explicit KeyF interact does. Only while
  // playing; reset() clears a stale prompt when leaving the arena (pause/home).
  if (isPlaying()) _portalTrigger.tick(playerObj.position);
  else _portalTrigger.reset();
  // Portal marker idle animation (v0.2.183) — scalar spin/pulse only, no allocation.
  tickPortalMesh(dt);
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
