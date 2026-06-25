# Torii Quest — Contributor / Agent Handoff

> Single-page onboarding for the next contributor — human or AI agent (Perplexity,
> DeepSeek, perplexica, routstr, or a FOSS human). It captures repo state, the
> hard constraints, where the source of truth lives, and how to build/test/ship.
> It is a working template: keep it current as the codebase moves. It describes
> the project as it is today; it does not promise API/behaviour compatibility
> across versions (this is a pre-1.0 alpha).

---

## 1. What this is

A browser arena shooter: Three.js (WebGL) render layer, Rapier3D (WASM) physics,
Nostr identity, Bitcoin/ecash (fake sats in alpha). Vite 8 build. Pure ES modules.

- **Current version:** v0.2.174-alpha (see §3 for every place the version string lives)
- **Active focus:** 15-hour proof-of-concept route (see `strategy.md` → "15-Hour
  Proof-of-Concept Route" and `todo.md` → "ACTIVE FOCUS"). **Shooter is
  maintenance-only** unless a bug is demo-breaking; the active MVP is the freedom-tech
  loop — gateway/NAP-to-NAP preview, Plebeian/Nostr product panel proof, leaderboard
  preview, and the torii.quest GitHub update-check (LEAN-1..LEAN-5). Retrospective
  polish comes AFTER proof-of-concept validation.
- **Live:** https://torii-quest.pplx.app (a Perplexity Space — deploy is a separate manual step, see §7)
- **License:** GPL-3.0

## 2. Hard constraints (do NOT break these)

These are enforced by `npm run check` (`tools/regression-check.mjs`) and by review.
Breaking one should fail CI/the check, not ship.

1. **Version bump on every deploy.** Every source change that ships bumps the
   version in ALL markers in §3. The check asserts they match `EXPECTED_VERSION`.
2. **`godMode` stays `false`** in `src/config.js`. Never commit `true`.
3. **No new `setTimeout`** except the two existing allowed sites: `nostr.js` (WS
   close) and `hud.js` (kill-feed). The check greps for violators.
4. **No new `Vector3`/`Matrix4` in hot paths.** Reuse module-scope scratch vars.
   The check scans the foundation-module allowlist for `new THREE.(Vector3|Matrix4)`.
   Pure engine modules with NO `three` import are exempt (they can't allocate THREE
   objects) — prefer writing new logic there.
5. **Spelling:** comments say **"nostrich"** (never "ostrich"); the character is
   **"Chiefmonkey"** (exact case).
6. **Debug tools ship unconditionally** (no flag gate) — `window.ToriiDebug` is
   intentional in this public alpha.
7. **ESC = instant pause**; a click that only re-locks a panel-locked cursor must
   never fire the weapon.
8. **Firing rule:** bullets originate at the **gun barrel** and aim **through the
   crosshair** (camera ray finds the aim point; barrel→point is the bullet line).
9. **`state.phase` is written ONLY in `state.js`** (via `transition()`). Other
   modules read predicates (`isPlaying()` etc.), never assign the phase.
10. **No internal use** of the deprecated globals `window._onBotHit`,
    `window._grassMat`, `window._flowerMat`, `window._mirrorMesh` — they remain as
    documented debug taps only; internal code uses the event bus / accessors.
11. **Split by concern, not line count** when extracting modules.
12. Do not name Google, Cloudflare, Microsoft, or Babylon.js in docs.

## 3. Version markers (bump together)

| File | Location |
|---|---|
| `src/config.js` | `export const VERSION` (line ~2) |
| `index.html` | `#version-label` (~407) and `#ver` (~537) |
| `tools/regression-check.mjs` | header comment (line 1), `EXPECTED_VERSION` (~26), stale-version guard regex (~110 — flag the PREVIOUS version) |
| `package.json` | `"version"` — VALID SEMVER, so the `EXPECTED_VERSION` with the leading `v` STRIPPED (e.g. `0.2.137-alpha`). Regression-check [5] asserts it matches. |
| `progress.md` / `todo.md` / `strategy.md` | "Current version" lines |

## 4. Source of truth

- **`src/config.js`** — ALL constants/tuning. Never scatter magic numbers. The
  `TUNING` frozen object mirrors balance values for `ToriiDebug.snapshot().config`.
- **`src/state.js`** — the only place game phase changes; the FSM table + weapon
  predicates (`canShoot`/`canReload`) live here.
- **`src/main.js`** — wiring only, no game logic.
- **`CODE_INDEX.md`** — file-by-file map of the codebase. Update it when you add
  or move a module.
- **`strategy.md`** — vision + decision rules. **`progress.md`** — execution
  dashboard. **`todo.md`** — active task queue.
- **`engine/`** — extracted, mostly-pure SDK seams (debug, physics, combat,
  entities, ui, weapons). Prefer adding pure logic here so it is node-testable.
- **`src/sdk/index.js`** — public SDK entrypoint (ARS-5). Curated node-safe
  re-exports + `SDK_VERSION`, `STABILITY` tiers, and the frozen `SDK_SURFACE`
  tier map. Only re-export modules that never transitively import `scene.js`.
  v0.2.132 added the `component` namespace; v0.2.133 added the `toriiGateway`
  namespace; v0.2.134 added `productDisplay`, `travelIntent`, and `leaderboard`;
  v0.2.135 added `registry`, `gatewayHandoff`, `productPanel`, and
  `leaderboardPublisher`; v0.2.136 added `gatewayPortal`, `productPanelShell`,
  and `leaderboardView`; v0.2.138 added `updateCheck`; v0.2.139 added
  `gatewayPreview`; v0.2.140 added `productPreview`; v0.2.141 added
  `leaderboardPreview`; v0.2.142 added `updatePreview`; v0.2.143 added `mvpLoop`;
  v0.2.147 added `proofSurfaceSpecs` (pure in-world proof-mesh layout/spec data);
  v0.2.170 added `hostTransport` (the real same-site host transport adapter for
  gateway travel — injected History-pushState host, same-origin only);
  v0.2.171 added `continuum` (the Torii Continuum project-oversight dashboard
  data model + pure static-page renderer — read-only, no live writes; v0.2.174
  added a `buildContinuumModel(overrides)` merge seam fed by the build-time doc
  parser `tools/continuumParse.mjs`, so the page DERIVES its list sections from
  progress.md/todo.md with a safe curated fallback)
  (all experimental). **`SDK_DEBUG_INDEX.md`** (v0.2.145) is the compact
  discoverability map over this surface + the `ToriiDebug.shells` reports for AI
  handoffs / FOSS devs.
- **`src/engine/components/contract.js`** + **`COMPONENTS.md`** — component
  economy foundation (CMP-1/2, v0.2.132). Pure `validateManifest` /
  `isComponent` / `defineComponent` (idempotent mount/unmount) + the full
  manifest spec doc. No THREE/Rapier/DOM. Signature/hash/capability
  ENFORCEMENT is later CMP work. **`src/engine/components/toriiGateway.js`**
  (CMP-8, v0.2.133) — first reference component built on that contract
  (`createToriiGateway`/`toriiGateway`); pure node-safe skeleton (no-op
  mount/unmount; portal mesh + Nostr handoff are documented TODOs).
  **`src/engine/components/productDisplay.js`** (CMP-13, v0.2.134) — read-only
  product display reference component (`createProductDisplay`/`productDisplay`/
  `validateProduct`); links OUT to Plebeian.Market, NO checkout/pay/zap/publish.
- **`GATEWAY_PROTOCOL.md`** + **`src/engine/gateway/travelIntent.js`** (GWPROTO-1,
  v0.2.134) — the n2n spatial-hop protocol DRAFT + pure URL-handoff helpers
  (`buildTravelUrl`/`parseTravelUrl`/`validateTravelIntent`). No navigation/
  relay/signing. "Component is code, protocol is agreement."
- **`src/engine/nostr/leaderboard.js`** (LB-1, v0.2.134) — pure Nostr leaderboard
  score-event helpers (`buildScoreEventTemplate`, kind 30000); builds the
  UNSIGNED event template only. No signing/relay/publish.
- **`src/engine/components/registry.js`** (CMP-7, v0.2.135) — pure, node-safe
  component loader/registry (`createRegistry`/`createBuiltinRegistry`/
  `builtinRegistry`). Registers LOCAL built-in factories by id/kind, probes +
  validates manifest/contract on register, and `load(id, config)` returns a
  FRESH contract-valid instance (unknown/incompatible loads degrade, never
  throw). NO eval / dynamic-import / remote fetch — local code only.
- **`src/engine/gateway/gatewayHandoff.js`** (CMP-8 cont., v0.2.135) — pure
  portal/handoff shell (`gatewayDestination`/`planGatewayTravel`/
  `gatewayTravelUrl`) that maps a gateway component's destination onto a
  validated travel intent / URL via `travelIntent.js`. Pure return values; NO
  `window.location` / relay / signing.
- **`src/engine/components/productPanel.js`** (CMP-13 cont., v0.2.135) — read-only
  product panel view-model (`productPanelViewModel`/`priceLabel`); flat
  render-ready bag over `validateProduct`. No checkout/pay/zap surface; the
  actual Three.js panel mesh is a deferred TODO.
- **`src/engine/nostr/leaderboardPublisher.js`** (LB-1 cont., v0.2.135) —
  publisher adapter shape (`createLeaderboardPublisher({sign,publish})`).
  INJECTED signer/publisher deps; build-only by default; captures sign/publish
  failures without throwing. No keys/relay/secrets.
- **`src/engine/gateway/gatewayPortal.js`** (CMP-8 cont., v0.2.136) — pure portal
  VIEW shell over `gatewayHandoff` (`gatewayPortalView`/`destinationLabel`/
  `shortKey`). Returns a render-ready portal view-model (status/armed/destination/
  prompt/relay/URL preview); `armed = plan.valid`, prompt+URL blank unless armed.
  DISPLAY-ONLY — never assigns `window.location` / contacts a relay / signs.
- **`src/engine/gateway/gatewayPreview.js`** (LEAN-2, v0.2.139) — pure
  visible-but-inert gateway/NAP-to-NAP PREVIEW block over `gatewayPortal`.
  `gatewayPreviewBlock(component, context, opts)` flattens the portal view into a
  render-ready block of `{label,value}` rows (Destination/Status/Relay/Intent/URL)
  + `statusText`/`previewUrl` helpers + a `GATEWAY_PREVIEW_BADGE`
  ("PREVIEW · SAFE · INERT"); every block is `actionable:false`. `main.js` renders
  it into the title-screen `#gateway-preview` card via `textContent` only (no link,
  no navigation, no fetch, no signing). Read-only at
  `ToriiDebug.shells.gatewayPreview()`. SDK `gatewayPreview` (experimental).
- **`src/engine/components/productPanelShell.js`** (CMP-13 cont., v0.2.136) —
  read-only product panel RENDER shell over `productPanel`. `productPanelShell`
  returns an ordered panel layout (`lines` Price/Seller/reward, link `footer`
  `actionable:false`, empty `actions[]`, `readOnly:true`); invalid → `panel:null`.
  No checkout/pay/zap/buy surface.
- **`src/engine/components/productPreview.js`** (LEAN-3, v0.2.140) — pure
  visible-but-inert Plebeian/Nostr product/market PREVIEW block over
  `productPanelShell`. `productPreviewBlock(product, opts)` flattens the panel
  shell into a render-ready block of `{label,value}` rows (Product/Price/Seller
  npub (shortened via `shortNpub`)/reward/Marketplace/Link) + `previewUrl` helper
  + a `PRODUCT_PREVIEW_BADGE` ("PREVIEW · READ ONLY · NO CHECKOUT"); every block
  is `actionable:false`/`readOnly:true`; invalid products degrade to `ok:false`
  with errors (no throw). `main.js` renders it into the title-screen
  `#product-preview` card via `textContent` only (no link, no checkout, no
  navigation, no fetch). Read-only at `ToriiDebug.shells.productPreview()`. SDK
  `productPreview` (experimental).
- **`src/engine/nostr/leaderboardView.js`** (LB-1 cont., v0.2.136) — read-only
  leaderboard display + build-only preview (`rankScores`/`leaderboardView`/
  `leaderboardPreview`/`accuracyLabel`/`VIEW_MODES`). Deterministic desc rank;
  `leaderboardView` throws on any non-`mock`/`build` mode (no `live`/relay path);
  `leaderboardPreview` runs through a no-signer/no-publisher adapter → `signed:false`/
  `published:false`.
- **`src/engine/nostr/leaderboardPreview.js`** (LEAN-4, v0.2.141) — pure
  visible-but-inert local/mock leaderboard PREVIEW block over `leaderboardView`.
  `leaderboardPreviewBlock(statsList, opts)` flattens the ranked view into a
  render-ready block of `{label,value}` rows (Mode/Signer (npub via `shortNpub`)/
  Status/Event (kind-30000 + #torii-quest proof shape)/ranked `#n` rows) +
  `modeLabel`/`formatRankRow` helpers + a `LEADERBOARD_PREVIEW_BADGE`
  ("PREVIEW · LOCAL MOCK · NO PUBLISH"); every block is `signed:false`/
  `published:false`/`actionable:false`/`readOnly:true`; invalid scores degrade
  into `skipped`, empty → "NO LOCAL SCORES" (no throw). `main.js` renders it into
  the title-screen `#leaderboard-preview` card via `textContent` only (no sign, no
  publish, no submit, no fetch). Read-only at
  `ToriiDebug.shells.leaderboardPreview()`. SDK `leaderboardPreview` (experimental).
- **`src/engine/debug/shellReport.js`** (HARD-4, v0.2.137) — read-only DEBUG
  reports over the three v0.2.136 shells (`gatewayReport`/`productReport`/
  `leaderboardReport`/`buildShellReport` + `DEMO_GATEWAY`/`DEMO_PRODUCT`/
  `DEMO_SCORES` fixtures). Surfaced on `ToriiDebug.shells.*`. Only reads the
  shells' pure return values — NO signer, NO relay/publish, NO navigation.
- **`src/engine/update/updateCheck.js`** (LEAN-5, v0.2.138) — pure torii.quest
  GitHub update-check architecture (`compareVersions`/`parseRelease`/
  `evaluateUpdate`/`updateCheckView` + `RELEASE_SOURCE`/`UPDATE_STATUS`). Compares
  a GitHub-release-shaped manifest's semver tag against the runtime `VERSION` and
  returns an INERT "update available" view-model (`actionable:false`). NO network
  fetch, NO auto-update, NO install — the actual fetch + the prompt MESH are
  deferred host steps. SDK `updateCheck` (experimental). See `UPDATE_CHECK.md`.
- **`src/engine/update/updatePreview.js`** (LEAN-5, v0.2.142) — pure
  visible-but-inert torii.quest update-check PREVIEW block over `updateCheckView`.
  `updatePreviewBlock(release, opts)` flattens the view-model into a render-ready
  block of `{label,value}` rows (Version/Latest/Status/Source/Notes) +
  `statusLabel` helper + an `UPDATE_PREVIEW_BADGE` ("PREVIEW · MANUAL · NO
  AUTO-UPDATE"); every block is `actionable:false`/`readOnly:true`; draft/unparseable
  releases degrade to UNKNOWN (no throw). `main.js` renders it into the title-screen
  `#update-preview` card via `textContent` only from a DETERMINISTIC LOCAL SAMPLE
  release (no GitHub fetch, no install, no auto-update, no navigation). Read-only at
  `ToriiDebug.shells.updatePreview()`. SDK `updatePreview` (experimental).
- **`src/engine/mvpLoop.js`** (v0.2.143) — pure node-safe header that frames the
  four title-screen preview cards as ONE proof-of-concept loop. `mvpLoopSummary(opts)`
  → a render-ready block: title "TORII QUEST · MVP LOOP", flow "Travel → Market →
  Score → Update", an inert-previews note, the four ordered steps mapped to their
  cards, and an `MVP_LOOP_BADGE` ("PREVIEW · READ ONLY · MANUAL"); `actionable:false`/
  `readOnly:true`. Content/labelling ONLY — no network/links/actions. `main.js`
  `renderMvpLoop()` writes the flow + note into the `#mvp-loop` card via `textContent`,
  and each card title carries its step (`1 · TRAVEL` … `4 · UPDATE`). Read-only at
  `ToriiDebug.shells.mvpLoop()`. SDK `mvpLoop` (experimental).

## 5. Build / test / check commands

```bash
npm install
npm run dev      # local dev server (vite)
npm run build    # production build → dist/ (runs build:continuum first → public/continuum.html + continuum-data.json)
npm run build:continuum  # (re)generate the Torii Continuum dashboard page + packaged data from progress.md model
npm run check    # static regression guardrails (tools/regression-check.mjs)
npm test         # vitest run (FULL unit suite, node env)
npm run test:fast        # ~5 core files (state/events/classifier/aim/snapshot) — innermost edit→test loop
npm run test:foundation  # ~16 files (fast + engine seams + SDK contract + guard suites) — broader confidence
npm run test:release     # build + FULL vitest + check + bundle:report + handoff:status — the release gate
npm run preview  # serve the built dist/ (used for headless smoke)
npm run bundle:report  # advisory built-bundle size baseline (raw+gzip; reads dist/)
```

**Test profiles (v0.2.173).** The `test:fast`/`test:foundation` profiles are explicit,
deterministic curated file lists (`tools/testProfiles.mjs`; no git-diff heuristics) run via
`tools/test-profile.mjs`, which validates every listed test still exists on disk and that
`fast ⊆ foundation`, then prints a timing footer. **Agents may run `test:fast`/`test:foundation`
during implementation, but every public deploy/publish/push still requires `npm run test:release`
(the FULL suite + check + build + bundle + handoff) or equivalent full parent verification — the
profiles speed up iteration, they NEVER replace the release gate.**

A change is "green" when **build + check + test** all pass. Current baseline:
**812 tests / 60 files**, all 14 regression checks GREEN, build clean. Built bundle
sizes are tracked as an advisory baseline — `npm run bundle:report` (full table) or the
non-failing `[13]` line in `npm run check` (v0.2.153). Docs/status drift is guarded by
check `[14]` (v0.2.154) — the continuity docs (`todo.md`/`progress.md`/`HANDOFF.md`) must
carry the current version or `npm run check` fails; its stale-live-version ADVISORY ignores
quoted/changelog prose (v0.2.155) so it only flags plainly-stated status lines. For a
one-glance snapshot of all of the above (VERSION/pkg sync, git commit, live URL, checks,
core-doc presence, latest reports, bundle baseline) run `npm run handoff:status` (v0.2.156;
visibility tool, network-free, always exits 0 — not a gate).

Tests run in node (`vite.config.js` → `environment: 'node'`). `WebGLRenderer` is
created at module load in `scene.js`, so any module importing `scene.js`
(transitively: `player.js`, `weapons.js`) CANNOT be imported in a node test.
Write new logic as a pure module (no `three`/Rapier/DOM import) to keep it
testable — see `engine/debug/snapshot.js`, `engine/physics/interactions.js`,
`engine/physics/raycastService.js` for the pattern.

Optional headless smoke (not in CI): `npm i -D puppeteer-core`, drive
`/usr/bin/google-chrome-stable` with swiftshader flags against `npm run preview`,
click `#btn-enter`, inspect `window.ToriiDebug.snapshot()`.

## 6. Debug surface

`window.ToriiDebug` (ships in alpha):
- `.snapshot()` — one JSON-serialisable object: version, phase, run state, player
  pos, combat last shot/hit/miss, physics+crate summary, tuning. Safe anytime.
- `.combat.report()` / `.physics.report()` — focused JSON sub-reports.
- `.shells.{gateway,gatewayPreview,product,productPreview,leaderboard,leaderboardPreview,updatePreview,mvpLoop,handoffPlan,handoffExecute,hostTransport,report,summary,diff,surfaceSpecs,surfaceSpecCheck,anchorTransforms,surfaceRender,surfaceBindings,surfaceGate}()` —
  read-only reports over the VIEW shells + visible preview blocks (demo fixtures by
  default; pass overrides). No signer, no relay/publish, no navigation, no checkout,
  no fetch/auto-update
  (`engine/debug/shellReport.js`; `gatewayPreview` v0.2.139, `productPreview` v0.2.140,
  `leaderboardPreview` v0.2.141, `updatePreview` v0.2.142). `summary()` (v0.2.145,
  pure `shellsSummary()`) is a one-call discoverability aggregate of the four proof
  surfaces + MVP loop with an `allInert` gate. `diff(a,b)` (v0.2.146, pure
  `shellsDiff()`) compares two `summary()` outputs and flags invariant flips that
  loosen inertness (`loosened[]` checklist for preview→live promotions); all four
  previews now expose symmetric `readOnly`+`actionable`. `surfaceSpecs()` (v0.2.147,
  pure `proofSurfaceLayout()` from `engine/world/proofSurfaceSpecs.js`) is the
  read-only LAYOUT/SPEC summary for the four FUTURE in-world proof meshes (plain
  position/size data in the NAP zone + `allInert` gate; no Three/render).
  `surfaceSpecCheck(map?,specs?)` (v0.2.148, pure `checkProofSurfaceSpecs()` from
  `engine/debug/proofSurfaceCheck.js`) cross-checks each spec's `previewSdk`/`shell`
  against the live SDK experimental + shells registries, re-asserts the inert
  invariants, and scans for leaked live-action keys — `{ok,errors,warnings,surfaces}`,
  the guard to run before the future mesh pass binds anything. `anchorTransforms(specs?)`
  (v0.2.149, pure `resolveAllAnchors()` from `engine/world/anchorTransforms.js`) is the
  ANCHOR→TRANSFORM contract — it binds each spec's `anchor` id to a plain transform
  descriptor (ground origin/position/`offset`/size/yawRad) and lists unresolved
  anchors (`{ok,count,resolved,unresolved}`), the single source of truth the future
  mesh pass reads to place each surface. `surfaceRender()` (v0.2.150, from
  `engine/world/proofSurfaceMeshes.js`) reports the render state of the FIRST
  display-only in-world proof-surface mesh pass — `{rendered,count,ok,badge,reasons}`.
  `rendered` is true only after the inert panels were built (both gates passed);
  otherwise `reasons` carries the gate failures. The panels are display-only/inert:
  no click handlers, raycast, navigation, payments, Nostr, live data, or fetch.
  Meshes are allocated EXACTLY ONCE during scene setup (`arena.js` `_buildNapZone`),
  off the hot path; the pure plan (`engine/world/proofSurfaceRenderPlan.js`) holds
  all gating/placement logic. `surfaceBindings()` (v0.2.151, pure `resolveParentBindings()`
  in `engine/world/proofSurfaceParentBinding.js`) groups the render plan's panels by their
  scene-graph `parent` hint — mapping each to the live scene-node name + the per-parent
  display-only group name the adapter mounts the boards under (`proof-surfaces::<parent>`).
  Boards keep their world positions (subgroups sit at the origin), so the binding is a
  structural/discoverability change only; the live `torii-gate` / `nap-zone-floor` nodes are
  now `.name`d in `arena.js` so `scene.getObjectByName` finds them. `surfaceGate()` (v0.2.152,
  pure `proofSurfaceGate()` in `engine/debug/proofSurfaceGate.js`) folds the spec cross-check +
  render plan + parent binding into one fail-fast `{ok,gates:{specCheck,renderPlan,parentBinding},
  counts,reasons}` — the single gate a reviewer/CI asserts before the proof boards are built or
  any preview→live promotion; it is RUN by `tools/regression-check.mjs` check [12]. See
  `SDK_DEBUG_INDEX.md`.
- `.physics.service` — injectable RaycastService facade (`ray`/`rayStatic`/`lineOfSight`).
- `.bots`, `.player`, `.physics`, `.world`, `.fx`, `.combat`, `.identity`.

## 7. Deploy / publish (MANUAL — not done by task agents)

Deploy target is the **Perplexity Space** at `torii-quest.pplx.app`. The build
artifact is `dist/` (`npm run build`). Publishing/uploading Space files is a
separate manual step performed by the maintainer/main agent — **task agents must
NOT deploy, publish, push, or upload Space files.** Hand back a clean,
green source tree and report the version + changes; the maintainer ships it.

Live currently trails source (see `progress.md` "Deployment" track). Lifting the
source-built artifact to live is its own tracked task (TQ-MANUAL-113 — manual
smoke test on real hardware first).

For **self-hosting the static `dist/` build at `torii.quest`** on a shared Ubuntu
VPS — Caddy/Nginx + HTTPS, DNS checklist, the manual GitHub update sequence,
symlink-based rollback, and the security posture (no auto-update, no shell
endpoint, least-privilege deploy user) — see `VPS_INSTALL.md` (v0.2.144, docs
only; no server is touched). It aligns with the update-check safety boundary in
`UPDATE_CHECK.md` §4.

## 8. Active issues / open edges

- Travel-time lead on fast-moving targets (bullets are hitscan-aimed but
  projectile-flown; long shots on strafing bots can trail). Tracked in `todo.md`.
- Live deployment trails source by several versions — needs manual smoke + publish.
- ARS-5 (`src/sdk/index.js` skeleton) landed in v0.2.131. ARS-4: `canShoot`/
  `canReload` + `isEngaged`/`needsPointerLock` + `isReloading`/`tickReload`
  (v0.2.132) predicates extracted; **v0.2.133 wired the real `GAMEOVER` edge**
  (`GAME_EVENT.END` + `endRun()`, terminal; no live caller fires it yet — the
  named entry point for a future end-of-run screen). ARS-3: all live raycast
  call sites now route through `raycastService` — bots LOS + weapons/player
  bullet+aim (v0.2.132) and the reticle preview (`targetReticle.js`, v0.2.133);
  injected-fake-world tests added (v0.2.133); no direct `castRay` consumers
  remain outside the service. CMP-1/2 (component contract + manifest spec) landed
  v0.2.132; **CMP-8 first reference component (`toriiGateway`) landed v0.2.133**;
  **v0.2.134 landed the lean-MVP foundation: CMP-13 read-only `productDisplay`,
  GWPROTO-1 `GATEWAY_PROTOCOL.md` + `travelIntent` URL-handoff helpers, and LB-1
  `leaderboard` unsigned score-event helpers — all pure/node-safe, no deploy
  needed.** **v0.2.135 landed the loader + handoff foundation: CMP-7
  `registry` (local built-in component loader/registry), CMP-8 `gatewayHandoff`
  (gateway component → validated travel intent/URL), `productPanel` view-model,
  and LB-1 `leaderboardPublisher` adapter shape — all pure/node-safe, no deploy
  needed.** **v0.2.136 turned that infrastructure into pure render-ready VIEW
  shells: CMP-8 `gatewayPortal` (portal view-model — armed/destination/prompt/URL
  preview, never navigates), CMP-13 `productPanelShell` (read-only panel layout,
  `actionable:false` footer + empty `actions[]`), and LB-1 `leaderboardView`
  (read-only display + build-only preview, no signer/relay) — all pure/node-safe,
  SEC gates intact, no deploy needed.** **v0.2.139 made the gateway/NAP-to-NAP
  preview VISIBLE (LEAN-2): `gatewayPreview` flattens the portal view into an inert
  title-screen card (`gatewayPreviewBlock`), rendered by `main.js` via `textContent`
  only and surfaced read-only at `ToriiDebug.shells.gatewayPreview()` — no
  navigation/fetch/signing.** **v0.2.170 added the real same-site host TRANSPORT
  ADAPTER (`hostTransport.js`): `createHostTransport(host)` builds the
  `{navigate,snapshot,rollback,log}` object the v0.2.168 executor consumes, browser
  primitives INJECTED via a host (History `pushState`); same-origin only, in-memory
  recording host by default, `createBrowserHostTransport(window)` runtime seam not yet
  wired.** Next: wire that transport into `world/handoff.js` to act on a validated
  travel intent + the
  gateway's portal mesh (actually move the player), the real leaderboard
  signer/publisher + relay read, the in-world product panel mesh, and the
  loader's remote/Nostr-event path with signature/hash/capability enforcement.
  See `progress.md` Current Sprint.
- ESBUILD-1 (deferred): low-severity dev-server-only esbuild advisory; `npm audit
  fix` pulls a broad rolldown/vite chain, deemed too risky for an alpha — left as a
  tracked WARN in `todo.md`.
- **SEC-1 (consent gate):** before wiring `leaderboardPublisher` to a real NIP-07
  signer or live relay publish, require explicit user consent. Current implementation
  is pure/injected and not wired to live publish.
- **SEC-2 (handoff verification gate):** before `world/handoff.js` acts on live relay
  data, add cryptographic verification / signing-layer checks for incoming handoff
  events. Do not act on unverified travel intents from the wire.
- **SEC-3 (product URL validation):** before `productDisplay`/`productPanel` URLs are
  made clickable or fetched, replace the regex-only `https://` check with `URL`-object
  parsing (validate scheme + host). Regex alone is insufficient for untrusted input.

## 9. Next-job format

When picking up work, state it as:

```
TASK:        <one line>
VERSION:     bump v0.2.<n> → v0.2.<n+1>-alpha
CONSTRAINTS: (default = all of §2; note any the task explicitly relaxes)
SCOPE:       files expected to change; split by concern
DONE WHEN:   build + check + test green; docs (§4) updated; version markers (§3) bumped
DEPLOY:      NO (maintainer publishes) unless explicitly instructed
```

Keep changes incremental and reversible. If scope balloons, stop at a green
checkpoint and report what remains rather than half-landing a broad rewrite.
