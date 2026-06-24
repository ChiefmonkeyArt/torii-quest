// engine/debug/toriiDebug.js — deliberate, namespaced alpha debug API.
// v0.2.110. Replaces the habit of sprinkling random `window._foo` globals with
// a single discoverable `window.ToriiDebug` surface. Debug tools ship
// UNCONDITIONALLY in alpha (no flag gate) — this is intentional for a public
// alpha so testers and FOSS contributors can poke at the live game.
//
// Backwards compatibility: the pre-existing functional globals are LEFT IN
// PLACE because they are load-bearing wiring, not just debug taps:
//   • window._onBotHit   — DEPRECATED (v0.2.117). The internal weapons.js → main.js
//                          bot-hit bridge now runs over the event bus
//                          (EV.BOT_HIT_BY_PLAYER). This global remains ONLY as a
//                          documented debug tap that forwards onto the bus, so
//                          console/tester calls keep working. Internal code must
//                          not call it (regression check [9]).
//   • window._grassMat    — DEPRECATED (v0.2.118). arena-foliage.js now owns the
//                          shader in a module-scope registry, ticked by main.js
//                          via tickFoliage() and surfaced here through the
//                          injected getGrassMat() accessor. The global remains
//                          ONLY as a documented debug alias; internal code must
//                          not read it (regression check [10]).
//   • window._flowerMat   — DEPRECATED (v0.2.118), same as _grassMat (getFlowerMat()).
//   • window._mirrorMesh  — DEPRECATED (v0.2.119). mirror.js owns the Reflector
//                          handle in a module-scope ref, surfaced here through
//                          the injected getMirror() accessor. The global remains
//                          ONLY as a documented debug alias; internal code must
//                          not read it (regression check [10]).
// ToriiDebug MIRRORS these (read-only convenience) under ToriiDebug.fx /
// ToriiDebug.world so they are discoverable from one namespace, but the
// originals keep working so nothing breaks.
//
// `refs` is injected by main.js (which already imports every subsystem) so this
// module stays dependency-light and free of circular imports. The world/identity
// skeletons are imported directly because they are pure + inert (no game-module
// deps, nothing fires on import) — exposing them here makes the foundation
// boundaries discoverable and manually testable from the console.
import * as napZone from '../../world/napZone.js';
import * as handoff from '../../world/handoff.js';
import * as presence from '../../identity/presence.js';
import { buildSnapshot, buildCombatReport, buildPhysicsReport } from './snapshot.js';
import { raycastService } from '../physics/raycastService.js';
import { gatewayReport, gatewayPreviewReport, productReport, productPreviewReport, leaderboardReport, leaderboardPreviewReport, updatePreviewReport, buildShellReport } from './shellReport.js';

export function installToriiDebug(refs) {
  const {
    version, bots, hitBot, playerObj, resetPlayerPos,
    castRay, castRayStatic, hasLineOfSight, getWorld, getLastHit,
    getLastShot, getLastMiss,
    getGrassMat, getFlowerMat, getMirror,
    // v0.2.130 — snapshot/report providers.
    getState, getPhase, getCrateSummary, config,
  } = refs;

  // v0.2.130 — providers for the JSON-serialisable debug snapshot. Each is a
  // function the pure snapshot builder reads behind safe(), so the surface never
  // throws even before physics/state are ready. Counts come from the live Rapier
  // world (not serialisable itself) and the bot roster.
  const snapProviders = {
    version,
    getPhase, getState,
    getPlayerPos: () => (playerObj ? playerObj.position : null),
    getLastHit, getLastShot, getLastMiss,
    isPhysicsReady: () => !!(getWorld && getWorld()),
    getBodyCount:     () => { const w = getWorld && getWorld(); return w ? w.bodies.len() : null; },
    getColliderCount: () => { const w = getWorld && getWorld(); return w ? w.colliders.len() : null; },
    getBotSummary: () => ({ total: bots.length, alive: bots.filter(b => b.alive).length }),
    getCrateSummary,
    config,
  };

  const api = {
    version,

    bots: {
      get list()  { return bots; },
      get count() { return bots.filter(b => b.alive).length; },
      // Damage the i-th bot by n (defaults to a lethal-ish 5). Returns the bot.
      damage(i = 0, n = 5) {
        const b = bots[i];
        if (b) hitBot(b, n);
        return b || null;
      },
    },

    player: {
      get position() { return playerObj.position; },
      resetToArena() { resetPlayerPos(); },
    },

    physics: {
      raycast: castRay,
      raycastStatic: castRayStatic,
      lineOfSight: hasLineOfSight,
      get world() { return getWorld(); },
      // v0.2.130 — injectable raycast facade (SDK first slice). Consumers can
      // depend on this service instead of the raw functions above.
      service: raycastService,
      // v0.2.130 — JSON-serialisable physics summary (world readiness +
      // body/collider/bot/crate counts). Safe to call before physics loads.
      report() { return buildPhysicsReport(snapProviders); },
    },

    world: {
      get mirror() { return (getMirror ? getMirror() : null) || null; },
      // Foundation skeletons (inert): zone metadata + local handoff helpers.
      napZone,
      handoff,
    },

    // Identity skeletons (inert): presence/discovery, disabled by default.
    identity: { presence },

    fx: {
      get grass()  { return (getGrassMat  ? getGrassMat()  : null) || null; },
      get flower() { return (getFlowerMat ? getFlowerMat() : null) || null; },
    },

    // Combat — last bot-hit classification (impact Y, foot Y, neck-line, head
    // sphere proximity, resolved part vs final class, damage). For tuning the
    // headshot/body thresholds live from the console after a shot.
    //
    // Target-practice diagnostics (v0.2.124):
    //   lastShot — most recent FIRED shot: {origin, dir, aim, pred, outcome,
    //              predicted:{reason,label}, reason, label, resolved, flightTime}.
    //              `aim` is the crosshair (camera) ray; `pred` is the bullet line
    //              at fire; `outcome` is what the bullet actually hit. Compare
    //              aim vs outcome to see WHY a shot landed or missed.
    //   lastMiss — most recent shot that did NOT hit a live bot (same shape).
    combat: {
      get lastHit()  { return getLastHit  ? getLastHit()  : null; },
      get lastShot() { return getLastShot ? getLastShot() : null; },
      get lastMiss() { return getLastMiss ? getLastMiss() : null; },
      // v0.2.130 — JSON-serialisable {lastHit,lastShot,lastMiss} in one object.
      report() { return buildCombatReport(snapProviders); },
    },

    // v0.2.130 — one compact, JSON-serialisable status object for post-playtest
    // feedback: `JSON.stringify(ToriiDebug.snapshot())` → paste. Includes
    // version, phase, run state, player position, combat last shot/hit/miss,
    // physics/crate summary, and the key tuning values. Safe to call any time.
    snapshot() { return buildSnapshot(snapProviders); },

    // v0.2.137 — read-only reports over the v0.2.136 VIEW shells (gateway portal,
    // product panel, leaderboard). Lets a tester/AI handoff inspect what those
    // shells produce from one place, using safe demo fixtures by default. These
    // ONLY read the shells' pure return values — no signer, no relay/publish, no
    // navigation. Pass overrides to inspect your own component/product/scores.
    shells: {
      gateway(component, context, opts) { return gatewayReport(component, context, opts); },
      // v0.2.139 — the visible-but-inert gateway/NAP-to-NAP PREVIEW block (LEAN-2)
      // the title/HUD card draws. Read-only; actionable:false, never navigates.
      gatewayPreview(component, context, opts) { return gatewayPreviewReport(component, context, opts); },
      product(product) { return productReport(product); },
      // v0.2.140 — the visible-but-inert Plebeian/Nostr product/market PREVIEW
      // block (LEAN-3) the title/HUD card draws. Read-only; actionable:false, no
      // checkout/pay/zap.
      productPreview(product, opts) { return productPreviewReport(product, opts); },
      leaderboard(statsList, opts) { return leaderboardReport(statsList, opts); },
      // v0.2.141 — the visible-but-inert local/mock leaderboard PREVIEW block
      // (LEAN-4) the title/HUD card draws. Read-only; signed:false, published:false,
      // actionable:false — never signs, publishes, or submits.
      leaderboardPreview(statsList, opts) { return leaderboardPreviewReport(statsList, opts); },
      // v0.2.142 — the visible-but-inert torii.quest update-check PREVIEW block
      // (LEAN-5) the title/HUD card draws. Read-only; actionable:false — no network
      // fetch, no auto-update, no install, no navigation (deterministic local sample).
      updatePreview(release, opts) { return updatePreviewReport(release, opts); },
      report(inputs) { return buildShellReport(inputs); },
    },
  };

  window.ToriiDebug = api;
  return api;
}
