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

- **Current version:** v0.2.194-alpha (see §3 for every place the version string lives)
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
| `src/engine/dashboard/continuumData.js` | `CONTINUUM_VERSION` — pinned to `config.js` `VERSION` by `continuum-dashboard.test.js`; also the `metrics` "Source version" + "Tests" rows (test count) |
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
  v0.2.178 added `gatewayActivation` (the LIVE-WIRE seam that lets the v0.2.168
  executor ACT on a confirmed same-origin hop — `resolveHostTransport` picks an
  injected/browser-window/recording-host transport WITHOUT navigating, and
  `activateGatewayHandoff` double-gates on a literal `confirmed:true` AND the
  consent-gated dry-run plan AND an optional same-origin route allowlist before any
  transport is resolved; rollback/back-home reachable; external/world/sign/publish/
  network pinned false; window is injected, never reached at module scope);
  v0.2.180 added `gatewayPortalActivation` (the pure portal-boundary seam that
  bridges an in-world gateway COMPONENT to that confirmed hop — `portalActivationInput`
  maps the component's `target`→`zoneId` and DROPS the external `website`,
  `sanitizePortalAllowlist` folds `['/']`→`['/zone/']` so the boundary is never
  permit-everything, `withinPortalRange` is a scalar squared-distance check (no
  Vector3), and `createGatewayPortalBoundary` is a one-shot arm→confirm controller
  that captures the injected window/transport ONCE and delegates to
  `activateGatewayHandoff`; external/world/sign/publish/network pinned false);
  v0.2.181 added `portalTrigger` (the pure proximity→confirm controller wired at
  the `main.js` composition root — a per-frame `tick(playerPos)` uses
  `withinPortalRange` to ARM the v0.2.180 boundary + raise a HUD prompt near the
  torii gate, both INERT; an explicit `interact(grant)` bound to KeyF is the ONLY
  navigating step. `main.js` injects the REAL browser `window` ONCE into
  `createGatewayPortalBoundary` here and nowhere at module scope; allowlist scoped
  `['/zone/']`; external website URLs never navigate; debug-shell `portalTrigger`
  over a recording host);
  v0.2.182 added `zoneRoute` (the pure SPA `/zone/<slug>` route parser — the safe
  client-side READ of the same-origin URL the v0.2.181 hop pushes. `parseZoneRoute`
  runs the route through the v0.2.179-hardened `safeRoutePath`, strips `?query`/
  `#hash`, then classifies HOME / ZONE (strict lowercase-alnum-hyphen slug ≤64) /
  INVALID (sub-path/malformed/hostile); a valid zone maps to an INERT display state
  (title + HUD notice). navigated/performed/external/signed/published/network all
  pinned false. NO module-scope `window`: `main.js` reads `window.location.pathname`
  once on startup + on `popstate` and shows/hides an inert `#zone-notice` HUD banner.
  **Hard-refresh deep-link resolution is NOT solvable in app code alone — it needs a
  static-host SPA fallback: configure the host to serve `index.html` for any `/zone/*`
  path (SPA rewrite / try_files / 404→index.html). Until that rewrite is in place a
  cold hit on `/zone/<slug>` 404s at the CDN before any JS runs; once index.html IS
  served, `zoneRoute` resolves the URL into the inert notice. This is documented, NOT
  faked in code.** debug-shell `zoneRoute`);
  v0.2.183 added `portalMeshPlan` + the browser-only `portalMesh` adapter (the visible
  in-world PORTAL MARKER at the v0.2.181 trigger position so a player can SEE the travel
  point. `buildPortalMeshPlan({position,range,title})` is PURE/node-safe — four inert
  marker parts whose OUTER RING radius EQUALS the proximity range, every part + the plan
  pinning navigated/performed/external/signed/published false + readOnly/actionable. The
  adapter builds emissive meshes ONCE behind a `_built` guard at the trigger position and
  `tickPortalMesh(dt)` mutates ONLY scalars (rotation/emissive — no Vector3/Matrix4/
  geometry/material per frame); `disposePortalMesh()` frees them. Wired at the `main.js`
  composition root (`buildPortalMesh(scene,…)` + `tickPortalMesh(dt)` in update).
  DISPLAY-ONLY + INERT: no collider/raycast/input, no nav/relay/sign/publish — the safety
  model is unchanged. debug-shells `portalMeshPlan` (plan report) + `portalMesh` (render
  state));
  v0.2.184 added `zoneLabel` (pure portal/zone CLARITY label helpers wired at the `main.js`
  composition root — they make the portal target/state clearer to the player without
  touching the navigation-safety model. `portalPromptLabel({slug|route|title,key})` builds a
  target-aware proximity prompt ("Press F to travel to Plebeian Market Bazaar") with a
  generic "Press F to travel" fallback; `enteredZoneLabel(input,{prefix})` builds the
  concise post-hop notice ("Entered: …"), `''` for unknown. Both DERIVE human text from the
  safe slug via the v0.2.182 `humanizeZoneSlug` (alnum by construction); any free-form/
  hostile string is run through an internal allowlist sanitiser (`[A-Za-z0-9 -]`, capped at
  80) so no markup/dangerous token survives even though the HUD sink is `textContent`. In
  `main.js` the trigger's `promptText` is the target-aware label, and the KeyF handler shows
  the entered-notice ONLY when the v0.2.180 `confirm()` report returns navigated:true with a
  string zoneId (a pushState hop does NOT fire popstate, so the existing route-applier never
  refreshed the notice). DISPLAY-ONLY + INERT: no network/relay/sign/publish/external nav —
  the safety model is unchanged. debug-shell `zoneLabel(opts?)` with a `safe` flag proving
  hostile input is stripped);
  v0.2.185 added NO SDK namespace — it is a deployment-readiness FOUNDATION slice (docs +
  a local check, no runtime change). The outstanding torii.quest/VPS static-host
  prerequisite for the gateway travel feature — serve `index.html` for any `/zone/<slug>`
  path on a COLD hard-refresh/deep-link (see §7) — is now operationally explicit and
  LOCALLY checkable before publish. A pure node-safe helper (`tools/zoneFallbackReadiness.mjs`)
  + a read-only, network-free CLI (`npm run zones:check`) + regression-check [15] verify the
  required docs (`VPS_INSTALL.md`/`HANDOFF.md`) describe the `index.html` SPA fallback and
  that a built `dist/` has an `index.html` with NO static file under `/zone/*` that would
  shadow it. New `ZONE_FALLBACK_READINESS.md` checklist + `VPS_INSTALL.md` §11 + an
  `UPDATE_CHECK.md` §4 pointer. NON-GOALS held: no server access/SSH/credentials, no
  deploy/publish/upload, no auto-update, no navigation/runtime change (proximity arms, KeyF
  confirms, same-origin `/zone/` only). Unit-tested by `tests/zone-fallback-readiness.test.js`);
  v0.2.186 added NO new SDK namespace — it SURFACES the v0.2.185 verdict on the dashboard
  (deployment-readiness VISIBILITY, dashboard/tooling only, no runtime change). The pure
  node-safe `buildReadinessModel({zoneFallback})` (auto-exported under the existing
  `continuum` namespace via `export *`) folds the read-only `checkZoneFallbackReadiness`
  result into a render-ready `{badge,status,statusLabel,checks,errors,warnings,note}` model
  with honest states — READY / DOCS READY · BUILD CHECK PENDING / NOT READY / NOT CHECKED —
  and a four-row per-check table (SPA fallback documented, dist route shape, host fallback =
  MANUAL, auto-update = MANUAL); it never throws (no input → NOT CHECKED) and each check
  `state` reuses the existing pill vocabulary so the renderer adds NO new CSS. A new
  `_readinessSection` renders the **Deployment readiness** section after Engineering health;
  `tools/build-continuum.mjs` reads the required docs + walks `dist/` at packaging time
  (absent → dist check SKIPPED — `build:continuum` runs before `vite build`, so
  regression-check [15] stays the authoritative dist check) and feeds the real verdict in.
  `continuumDataJSON` now carries `readiness`. Server-rendered escaped text, NO new
  `<script>`/`data-k` key → the v0.2.172 refresh-script sha256 + CSP/XSS guard stay intact;
  no server access/SSH/credentials, no deploy/publish/upload, no auto-update, no nav/runtime/
  gameplay change. Unit-tested by `tests/continuum-dashboard.test.js`);
  v0.2.188 added a **Ship readiness** section (dashboard/tooling only, no runtime change) — a
  pure `buildShipModel({readiness,nextTask})` (auto-exported under the existing `continuum`
  namespace via `export *`, alongside `SHIP_BADGE`/`SHIP_LASTKNOWN`/`SHIP_NEXT_SAFE_TASK`)
  folds the EXISTING `releaseReadiness.buildReleaseReadiness` summary (version sync, test
  profiles, the 15-check regression gate, advisory bundle, `/zone/*` fallback, docs
  consistency) into a render-ready model — an overall status pill, a six-row per-signal table
  (reusing the existing pill vocabulary so `_shipSection` adds NO new CSS), and a highlighted
  NEXT SAFE task (a no-runtime-risk infra/docs slice, DISTINCT from the SEC-gated `next12[0]`).
  `kind` is GENERATED (live verdict folded this build) or LAST-KNOWN (curated `SHIP_LASTKNOWN`
  fallback) via the engineering-health provenance chip; it never throws. To feed the LIVE
  verdict without duplicating fs/git I/O, `tools/release-readiness.mjs` was refactored to
  export a reusable `gatherReleaseReadiness(root)` (the `npm run release:status` CLI behaviour
  is unchanged via a `realpathSync` run-guard), and `tools/build-continuum.mjs` folds its
  result through `buildShipModel` at packaging time (degrading to last-known on any error).
  `continuumDataJSON` now carries `ship`. Server-rendered escaped text, NO new `<script>`/
  `data-k` key → the v0.2.172 refresh-script sha256 + CSP/XSS guard stay intact; no network,
  no deploy/publish, no gameplay/portal/physics/controls/Nostr change. Unit-tested by
  `tests/continuum-dashboard.test.js` (+10).
  **v0.2.189** added a release-readiness JSON export so the verdict is machine-readable
  (dashboard/handoff/updater/agents) without parsing the human terminal block:
  `tools/releaseReadiness.mjs` gained a pure `buildReleaseStatusJson(summary,{generatedAt})`
  envelope (`RELEASE_STATUS_SCHEMA`='torii.release-status' / `RELEASE_STATUS_SCHEMA_VERSION`=1)
  and `tools/release-readiness.mjs` gained a `--json` flag (`npm run release:status:json`) that
  prints `JSON.stringify(...)` to stdout and exits 0. Deterministic by design — `generatedAt`
  is the ONLY non-deterministic field (optional + isolated, omit → `null` for tests; the CLI
  passes a real ISO stamp); a garbled summary degrades to `status:'unknown'`/`error:'no-summary'`,
  never throws/mutates. The default human block + the `realpathSync` run-guard are unchanged, and
  stdout under the flag is pure parseable JSON. Canonical machine invocation is
  `node tools/release-readiness.mjs --json`; for scripted `npm run` use
  `npm run --silent release:status:json`, since a plain `npm run` prepends an npm lifecycle
  banner to stdout that would otherwise contaminate the JSON. Read-only/local/
  no-network; `tests/release-readiness.test.js` (+7).
  **v0.2.190** added a handoff AUTO-SUMMARY so a fresh agent/model gets ONE concise brief
  without re-deriving the posture from every tool: a pure `buildHandoffSummary(inputs)` in
  `tools/handoffSummary.mjs` folds the EXISTING local status/readiness inputs — version, git
  commit, live URL, the current gate verdict (consumed from the `releaseReadiness` summary via the
  exported `gatherReleaseReadiness()`; no check re-implemented), regression count + test-profile
  counts, latest reports, the recommended next SAFE task (`DEFAULT_NEXT_SAFE_TASK`), the standing
  `KEY_CONSTRAINTS`, and the exact `VERIFY_COMMANDS` — into a stable, JSON-serialisable brief
  (schema `torii.handoff-summary` v1). `formatHandoffSummary` (text) + `formatHandoffSummaryMarkdown`
  (markdown) are pure. The thin CLI `tools/handoff-summary.mjs` (`npm run handoff:summary`) prints
  text by default, with `--json`, `--markdown`/`--md`, and an opt-in `--write[=path]` (default
  `handoff-summary.md`) — `--write` is the ONLY thing that writes; without it the tool is
  read-only/local/network-free. Deterministic: `generatedAt` is the only non-deterministic field
  (optional + isolated, omit → `null` for tests). A garbled/missing release input degrades to an
  honest `unknown` gate; never throws. `tests/handoff-summary.test.js` (+13).
  **v0.2.191** added a STALE-DOC DETECTOR that catches docs/status/version drift earlier and
  more clearly than the gated docConsistency guard: a pure `detectStaleDocs({version,docs,reports})`
  in `tools/staleDocs.mjs` REUSES the docConsistency primitives (`CONTINUITY_DOCS`/`findVersionMarkers`/
  `versionInText`) and flags precise version-HEADER drift in each continuity doc, a continuity doc
  that never mentions the current version, a newest report no continuity doc links to, a newest
  report that lags the current version (`reportVersionToken`), and disagreeing test counts across
  the continuity docs (`testCountsInText`). It keeps false positives low by matching HEADER
  assertions only (a `version` token followed by ONLY separator/markup chars, then the marker) and
  by stripping backtick/double-quote spans first, so changelog prose ("version drift fixed
  (v0.2.137)") and quoted examples are ignored. `formatStaleDocs` is pure. The thin CLI
  `tools/stale-docs.mjs` (`npm run docs:stale`) prints text by default, with `--json`; it is
  read-only/local/network-free and ALWAYS exits 0 — it is **ADVISORY**, deliberately NOT wired into
  `npm run check` (the HARD gate stays docConsistency [14]; the finer/higher-recall signals are
  surfaced, not enforced, so they never block safe dev). `tests/stale-docs.test.js` (+25).
  **v0.2.192** prepared GITHUB RELEASE/UPDATE METADATA for the FUTURE torii.quest / VPS
  update-checker — the static metadata an instance reads to surface an inert "update available"
  notice, with NO live update and NO runtime network. A pure `buildReleaseMeta({version,commit,
  owner,repo,generatedAt})` in `tools/releaseMeta.mjs` shapes `{kind, schemaVersion, channel
  (derived from the version tag via `channelForVersion`), version, commit, documentation-only
  GitHub source URLs (the real repo `ChiefmonkeyArt/torii-gate`; `RELEASE_SOURCE` in
  `src/engine/update/updateCheck.js` was corrected to the same real repo in v0.2.193 — documentation-only, no I/O), dist
  artifact expectations (`DIST_SPEC`), `requiredFiles`/`requiredChecks`, and manual/no-auto-update
  consent + notice wording}`. `validateReleaseMeta(meta)` is the SAFETY FLOOR: it ERRORs (not
  warns) if `update.autoUpdate` or `update.actionable` is anything but `false`, machine-enforcing
  the no-auto-update contract; it never throws and is safe on degraded input. The thin CLI
  `tools/release-meta.mjs` (`npm run release:meta`) prints text by default, with `--json`, a
  `--write` that emits the DETERMINISTIC `public/release-metadata.json` (no commit/timestamp baked
  in, so re-running never churns the tree), and a `--stamp` that bakes the live git commit + ISO
  time for a deploy step; it is read-only by default, writes ONLY the in-repo safe path under
  `--write`, and ALWAYS exits 0. The spec is mirrored into `UPDATE_CHECK.md` §5 and the manual-
  update story in `VPS_INSTALL.md` §12. `tests/release-meta.test.js` (+23).
  **v0.2.193** added a VPS INSTALL DRY-RUN — a local, read-only readiness checklist an operator
  runs BEFORE deploying torii.quest to a VPS/static host, with NO SSH, network, DNS, or server
  change. A pure `runVpsDryRun({docs,dist,releaseMeta})` in `tools/vpsDryRun.mjs` REUSES the
  shipped pure guards (`validateReleaseMeta()` for the manual-only/non-actionable floor and
  `fallbackEvidence()` for the `/zone/*` SPA fallback) and folds 11 checklist rows: required deploy
  docs present; `dist/` (if built) carries `index.html` (+ the copied `release-metadata.json`);
  `public/release-metadata.json` present + manual-only; metadata + `UPDATE_CHECK.md` point at the
  real repo `ChiefmonkeyArt/torii-gate`; the `/zone/*` SPA fallback documented; `VPS_INSTALL.md`
  build/manual-update/rollback/security sections; the `npm run build`/`npm run check` commands
  documented; rollback + manual/no-auto-update wording; the service-worker stance documented; and
  live URL references clear. `ok` is true iff NO check FAILED (warn/skip never flip it); never
  throws. The thin CLI `tools/vps-dry-run.mjs` (`npm run vps:dry-run`) reads local files only,
  prints text by default with `--json`, and exits non-zero ONLY on a blocking FAIL — it is NOT
  wired into `npm run check` (standalone operator tool). Documented in `VPS_INSTALL.md` §13 + the
  §9 service-worker caveat. `tests/vps-dry-run.test.js` (+43).
  **v0.2.194** added a NOSTR READ-PATH HEALTH model — a pure, node-safe read-only health model
  (`src/engine/nostr/readHealth.js`) that folds the shipped read-path proofs into ONE report an
  operator / dashboard / AI handoff can inspect to confirm the Nostr surface is still READ-ONLY at
  the MVP stage and every live-write path stays gated behind explicit consent. `runReadHealth({
  profileEvents,scoreEvents})` → `{ok,badge,signals,summary,readOnly:true,signed:false,
  published:false,errors}` over SIX signals: relay read model present (read-only `{read}` adapter,
  no publish/sign/send/connect/close); no `EVENT` publish verb in the relay read path
  (`RELAY_READ_VERBS`=`['REQ','CLOSE']`); kind:0 profile read path; kind-30000 leaderboard read
  path; write paths consent-gated (reads allowed / writes blocked without a grant); SEC-1/SEC-2/
  SEC-3 still future-gated. It EXERCISES only the already-pure read helpers over deterministic
  LOCAL sample events + reads the consent registry — NO relay I/O, NO WebSocket, NO signing, NO
  publishing, NO NIP-07, NO key handling, NO network; every signal pins `signed:false`/
  `published:false`/`readOnly:true` and degrades safely on null/empty input. Surfaced via the SDK
  (`nostrReadHealth`, EXPERIMENTAL), the debug shell (`ToriiDebug.shells.readHealth` /
  `readHealthReport()` in `shellReport.js`), and a new **Nostr read-path health** Torii Continuum
  panel (`buildReadHealthModel` in `continuumData.js` maps each signal onto the existing pill
  vocabulary → the continuum CSP/script-hash are untouched). `tests/nostr-read-health.test.js`
  (+16) + 7 dashboard-panel tests.
  Latest slice report: `torii-v0.2.194-nostr-read-health-report.md`.
  v0.2.171 added `continuum` (the Torii Continuum project-oversight dashboard
  data model + pure static-page renderer — read-only, no live writes; v0.2.174
  added a `buildContinuumModel(overrides)` merge seam fed by the build-time doc
  parser `tools/continuumParse.mjs`, so the page DERIVES its list sections from
  progress.md/todo.md with a safe curated fallback; v0.2.175 added a pure
  browser-safe `buildHealthModel(input)` + `HEALTH_LASTKNOWN` baseline that
  surface an **Engineering health** section on the page — profile/test-file
  counts, parser gaps, version + doc-sync GENERATED at build, total tests /
  timings / bundle baseline / last-green gate LABELLED last-known via provenance
  chips. No new `<script>`; CSP hash unchanged; v0.2.176 added a pure
  `buildMilestoneModel(input)` + `SEED_MILESTONES` that surface a **Milestones**
  section — the 15-hour MVP route as the ONE ACTIVE milestone (leanRoute slices ARE
  its tasks, folded into DERIVED total/done/active/pending + a directional % bar)
  plus clearly-labelled SEED future milestones, and grouped card values now render
  as bullet lists via `_cardValueHtml`. No new `<script>`; CSP hash unchanged.
  v0.2.177 ran the first **DASHBOARD-LAYOUT-1** pass — promoted the ACTIVE-milestone
  headline above At-a-glance, gave every section a one-line lead caption + an
  `_h2(title,count)` heading row with an item-count chip, reflowed the Now/Archive/Done
  columns onto a responsive auto-fit grid (`minmax(260px,1fr)`), and tightened spacing/
  typography. DERIVED/GENERATED/LAST-KNOWN/SEED chips stay visible; no new `<script>`/asset;
  CSP hash unchanged. A larger visual redesign remains a documented future follow-up)
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
npm run release:status # one concise release-readiness verdict aggregating the local signals (v0.2.187; read-only, network-free, exits 0 — not a gate; v0.2.188 exposes `gatherReleaseReadiness(root)` so the Continuum Ship-readiness section folds the SAME verdict)
npm run release:status:json # the SAME verdict as a machine-readable JSON envelope on stdout (v0.2.189; or: node tools/release-readiness.mjs --json) for dashboard/handoff/updater/agent consumption — read-only, network-free, exits 0; `node tools/release-readiness.mjs --json` is pure JSON, plain `npm run` prepends a lifecycle banner to stdout so scripted consumers use `npm run --silent release:status:json`
npm run handoff:summary # ONE concise AI-handoff brief for the next agent/model (v0.2.190): version, git commit, live URL, current gate verdict (folds gatherReleaseReadiness()), regression + test-profile counts, latest reports, next SAFE task, key constraints, exact release-verify commands. Text default; --json (schema torii.handoff-summary v1; scripted: npm run --silent handoff:summary -- --json); --markdown; opt-in --write[=path] is the ONLY writer — read-only/local/network-free otherwise; exits 0
npm run docs:stale # ADVISORY stale-doc detector (v0.2.191): catches docs/status/version drift earlier/clearer than docConsistency — version-HEADER drift per continuity doc, a doc that never mentions the current version, a newest report nobody links, a newest report lagging the current version, disagreeing test counts across continuity docs. Low false positives (HEADER-only matching + quoted-span stripping). Text default; --json; read-only/local/network-free; ALWAYS exits 0 — NOT in `npm run check` (the hard gate stays docConsistency [14])
npm run release:meta # GitHub release/update METADATA for the FUTURE torii.quest/VPS update-checker (v0.2.192): shapes {kind, schemaVersion, channel (from version tag), version, commit, doc-only GitHub source URLs, dist artifact expectations, requiredFiles/requiredChecks, manual/no-auto-update consent+notice}. validateReleaseMeta ERRORs if update.autoUpdate/actionable is not false (no-auto-update safety floor). Text default; --json; --write the DETERMINISTIC public/release-metadata.json (re-runs never churn); --stamp bakes live commit/time for a deploy step. Read-only by default, writes only the in-repo safe path under --write; ALWAYS exits 0. NO live update execution, NO runtime network
npm run vps:dry-run # LOCAL VPS/static-host install DRY-RUN readiness checklist (v0.2.193): an operator runs it BEFORE deploying torii.quest — NO SSH/network/DNS/server change. Pure runVpsDryRun() reuses validateReleaseMeta() + fallbackEvidence() and folds 11 checks (required deploy docs; dist/ index.html + copied release-metadata.json; metadata present + manual-only; real repo ChiefmonkeyArt/torii-gate; /zone/* fallback; VPS_INSTALL.md sections; build/verify commands; rollback + manual wording; service-worker stance; live URLs). Text default; --json; read-only/local/network-free; exits non-zero ONLY on a blocking FAIL (warn/skip never fail). NOT in `npm run check` (standalone operator tool)
```

**Test profiles (v0.2.173).** The `test:fast`/`test:foundation` profiles are explicit,
deterministic curated file lists (`tools/testProfiles.mjs`; no git-diff heuristics) run via
`tools/test-profile.mjs`, which validates every listed test still exists on disk and that
`fast ⊆ foundation`, then prints a timing footer. **Agents may run `test:fast`/`test:foundation`
during implementation, but every public deploy/publish/push still requires `npm run test:release`
(the FULL suite + check + build + bundle + handoff) or equivalent full parent verification — the
profiles speed up iteration, they NEVER replace the release gate.**

A change is "green" when **build + check + test** all pass. Current baseline:
**821 tests / 60 files**, all 14 regression checks GREEN, build clean. Built bundle
sizes are tracked as an advisory baseline — `npm run bundle:report` (full table) or the
non-failing `[13]` line in `npm run check` (v0.2.153). Docs/status drift is guarded by
check `[14]` (v0.2.154) — the continuity docs (`todo.md`/`progress.md`/`HANDOFF.md`) must
carry the current version or `npm run check` fails; its stale-live-version ADVISORY ignores
quoted/changelog prose (v0.2.155) so it only flags plainly-stated status lines. For a
one-glance snapshot of all of the above (VERSION/pkg sync, git commit, live URL, checks,
core-doc presence, latest reports, bundle baseline) run `npm run handoff:status` (v0.2.156;
visibility tool, network-free, always exits 0 — not a gate). For ONE concise release-readiness
verdict that folds the ship signals together — version sync, test-profile counts, the
regression-gate check count, the advisory bundle baseline, the `/zone/*` SPA-fallback verdict,
docs/status consistency, and the latest reports, with an honest READY / NOT READY / INCOMPLETE
status — run `npm run release:status` (v0.2.187; pure aggregator `tools/releaseReadiness.mjs` +
read-only CLI, network-free, exits 0 — the authority stays `npm run check` / `npm run test:release`).

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
- `.shells.{gateway,gatewayPreview,product,productPreview,leaderboard,leaderboardPreview,updatePreview,mvpLoop,handoffPlan,handoffExecute,hostTransport,gatewayActivation,gatewayPortalActivation,report,summary,diff,surfaceSpecs,surfaceSpecCheck,anchorTransforms,surfaceRender,surfaceBindings,surfaceGate}()` —
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

**SPA `/zone/<slug>` deep-link rewrite (v0.2.182 — REQUIRED for hard-refresh to
work).** The app is a single-page app served from one `index.html`. The v0.2.182
`zoneRoute` parser gives the `/zone/<slug>` URL a safe client-side interpretation,
but it can only run AFTER `index.html` + the JS bundle have been served. On a cold
hard-refresh / shared deep-link to `/zone/<slug>` a static host will try to serve a
file at that path, 404, and never load the app. The fix is a host-level SPA fallback
that serves `index.html` for any unmatched path (the app then reads the URL and shows
the inert zone notice). This is a hosting-config requirement OUTSIDE the repo — it is
documented here, not faked in app code. Examples:
- **Nginx:** `location / { try_files $uri $uri/ /index.html; }`
- **Caddy:** `try_files {path} /index.html` (or the `file_server` + `rewrite` pair).
- **Static CDN / object storage:** set the SPA/404 fallback document to `index.html`.
Keep the existing CSP unchanged; the fallback only affects path routing. Until the
rewrite is configured, `/zone/*` deep links 404 at the edge; same-origin in-app
navigation (the v0.2.181 portal hop via `history.pushState`) is unaffected.

Since **v0.2.185** this prerequisite is operationally explicit and LOCALLY checkable
before publish: `npm run zones:check` (read-only, network-free; also regression-check
[15]) verifies this doc + `VPS_INSTALL.md` describe the `index.html` SPA fallback and
that a built `dist/` has an `index.html` with no static file under `/zone/*` shadowing
it. The full pre-publish checklist + non-goals live in `ZONE_FALLBACK_READINESS.md`;
the concrete server blocks are in `VPS_INSTALL.md` §6a/§6b/§11. Configuring the real
host fallback remains a manual maintainer step — this repo touches no server.

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
  wired.** **v0.2.178 LIVE-WIRED that transport behind a confirmation gate
  (`gatewayActivation.js`): `resolveHostTransport(source)` turns an injected
  transport / a window (`history.pushState`) / a recording host into a usable
  transport WITHOUT navigating, and `activateGatewayHandoff(input,grant,opts)` only
  resolves + drives it after THREE ordered gates — literal `confirmed:true`, the
  consent-gated dry-run plan `ok`, and an optional same-origin route allowlist — so a
  preview/render/unconfirmed path can never navigate. Failed navigates roll back to
  the rollback route (back-home); `external/worldReloaded/signed/published/network`
  stay false; reachable read-only via `ToriiDebug.shells.gatewayActivation()` over an
  in-memory recording host.** **v0.2.180 added the PORTAL-BOUNDARY seam
  (`gatewayPortalActivation.js`) that bridges an in-world gateway COMPONENT to that
  confirmed hop: `portalActivationInput(component,context)` maps the component's
  `target`→`zoneId` and DROPS the external `website` (an external profile URL is
  never built/navigated), `sanitizePortalAllowlist` folds `['/']`→`['/zone/']` (the
  boundary can never be permit-everything), `withinPortalRange` is a scalar
  squared-distance check (no Vector3), and `createGatewayPortalBoundary(opts)` is a
  one-shot `arm`→`confirm` controller that captures the injected
  window/transport/host ONCE and delegates to `activateGatewayHandoff` (so all three
  gates above still apply); `external/worldReloaded/signed/published/network` pinned
  false, reachable read-only via `ToriiDebug.shells.gatewayPortalActivation()` over a
  recording host.** Next: drive `gatewayPortalActivation` from a real injected
  host router (app/browser window + CSP-scoped allowlist) + the
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
