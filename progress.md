# Torii Quest — Progress Dashboard

> Visual execution dashboard. See `strategy.md` for vision and decision rules. See `todo.md` for active tasks.
> Current version: **v0.2.139-alpha** | Live: [torii-quest.pplx.app](https://torii-quest.pplx.app)
> **ACTIVE FOCUS: 15-hour proof-of-concept route** — shooter is maintenance-only unless demo-breaking; the active MVP is the freedom-tech loop (gateway/NAP-to-NAP preview, Plebeian/Nostr product panel proof, leaderboard preview, torii.quest GitHub update-check). Retrospective polish after PoC validation. See `strategy.md` → "15-Hour Proof-of-Concept Route".

---

## Track Overview

Baseline totals are marked **[baseline]** — update them as the project grows rather than doing full archaeology.

### Foundation / Agent-Readable Structure

Tasks: ARS-1 through ARS-7 (7 total) | Done: 5 | In progress: 0 | Remaining: 2

```
[####################################..............] 5 / 7
```

Status: ARS-1 (snapshot tooling), ARS-2 (interactions API), ARS-3 (RaycastService), ARS-7 (HANDOFF.md) landed in v0.2.130; ARS-5 (`src/sdk/index.js` public entrypoint + stability tiers) landed in v0.2.131. Remaining: ARS-4 (FSM fold — partial: v0.2.130 canShoot/canReload + v0.2.131 isEngaged/needsPointerLock pointer-lock predicates + v0.2.132 `isReloading`/`tickReload` reload sub-state fold + v0.2.133 real `GAMEOVER` edge `GAME_EVENT.END`/`endRun()`), ARS-6 (ongoing CODE_INDEX upkeep). ARS-3 follow-up: bot-LOS call-site migrated to the facade in v0.2.131; weapons/player bullet+aim ray call-sites migrated to `raycastService.ray`/`.rayStatic` in v0.2.132; the last direct `castRay` consumer (reticle preview) migrated in v0.2.133 + injected-world tests added — ARS-3 cleanup done.

---

### Combat / Game Feel

Tracked fixes (v0.2.100–v0.2.129): 30 [baseline] | Done: 30 | Open: 1 (travel-time lead on moving targets)

```
[##################################################] 30 / 30 landed | 1 open edge
```

Major closed: hit-reg parallax, head-zone height, re-entry collider orphan, muzzle side, reload snap, barrel→crosshair aim, reticle/classifier split, v0.2.111 regression batch.

---

### Rapier / Physics

Seams extracted: bodies, raycast, RaycastService facade (ARS-3, consumed by bot LOS + weapons/player bullet+aim rays as of v0.2.132 + the reticle preview as of v0.2.133; injected-fake-world tests added v0.2.133; no direct `castRay` consumers remain) | ARS-3 raycast migration COMPLETE

```
[##############################################....] 5 / ~5 SDK seams
```

---

### SDK / API

SDK boundaries started: 6 (physics raycast, physics bodies, combat classifier, combat damage, combat aim, reload pose) [baseline] + `src/sdk/index.js` public entrypoint (ARS-5, v0.2.131) + component contract (`engine/components/contract.js`, CMP-1/2, v0.2.132) + reference components (gateway CMP-8 v0.2.133; read-only product display CMP-13 v0.2.134) + gateway-protocol URL-handoff helpers (`engine/gateway/travelIntent.js`, GWPROTO-1, v0.2.134) + Nostr leaderboard score-event helpers (`engine/nostr/leaderboard.js`, LB-1, v0.2.134) + component loader/registry (`engine/components/registry.js`, CMP-7, v0.2.135) + gateway portal/handoff shell (`engine/gateway/gatewayHandoff.js`, CMP-8, v0.2.135) + product panel view-model (`engine/components/productPanel.js`, v0.2.135) + leaderboard publisher adapter (`engine/nostr/leaderboardPublisher.js`, LB-1, v0.2.135) + gateway portal VIEW shell (`engine/gateway/gatewayPortal.js`, CMP-8, v0.2.136) + product panel RENDER shell (`engine/components/productPanelShell.js`, CMP-13, v0.2.136) + read-only leaderboard display/preview shell (`engine/nostr/leaderboardView.js`, LB-1, v0.2.136)
Remaining before Layer 1 complete: player boundary full lift, BotAgent runtime, grow the SDK surface as boundaries stabilise

```
[###########################################.......] 18 / ~21 Layer 1 boundaries
```

---

### Nostr / Plebeian / Open-World

Skeletons present: NAP zone module, world handoff, presence | Protocol drafted: 1 (Gateway Protocol) | Formalised: 0

```
[########..................................................] 0 / 5+ formalised (Gateway Protocol drafted v0.2.134; skeletons only)
```

v0.2.134 added the open **Gateway Protocol** draft (`GATEWAY_PROTOCOL.md`) + pure URL-handoff helpers (`travelIntent.js`) and pure unsigned Nostr leaderboard score-event helpers (`leaderboard.js`) — wire-format + helpers, not yet wired to relays/handoff. v0.2.135 added the component loader/registry (`registry.js`, CMP-7), the gateway portal/handoff shell (`gatewayHandoff.js`, CMP-8 — turns a gateway component into a validated travel intent/URL, pure return values, no navigation), the product panel view-model (`productPanel.js`), and the leaderboard publisher adapter shape (`leaderboardPublisher.js`, LB-1 — injected signer/publisher, build-only by default, no relay/secrets). v0.2.136 turned that infrastructure into pure, render-ready VIEW shells with no side effects: the gateway portal view shell (`gatewayPortal.js` — destination labels/prompt/armed debug state + URL preview, never navigates), the product panel render shell (`productPanelShell.js` — read-only panel layout, `actionable:false` footer + empty `actions[]`, no checkout surface), and the read-only leaderboard display/preview shell (`leaderboardView.js` — ranks scores + build-only `leaderboardPreview` with no signer/relay).
Blocked on: SDK Layer 1 close-out, identity boundary, kind:0 profile sync, the real signer/publisher + relay read, and wiring the gateway handoff into `world/handoff.js` + a portal mesh to actually move the player.

**Security gates (v0.2.135 review):** SEC-1 — require explicit user consent before any live NIP-07 signing or relay publish (leaderboardPublisher is currently pure/injected, not wired). SEC-2 — add cryptographic verification / signing-layer checks to `world/handoff.js` before it acts on live relay data. SEC-3 — tighten product URL validation from regex-only to `URL`-object parsing before productDisplay/productPanel URLs become clickable or fetched. **v0.2.136 preserves all three:** `gatewayPortal.urlPreview` is display-only (never assigned to `window.location`), `productPanelShell.footer` is `actionable:false` with empty `actions[]`, and `leaderboardView.leaderboardPreview` runs build-only through a no-signer/no-publisher adapter.

---

### Deployment / VPS / Update System

Source reconciliation: done | Source is build truth: yes | Live published version: v0.2.113-alpha
Clean source ahead of live by: 20 versions (v0.2.133 source vs v0.2.113 live)

```
[#########################.........................] source clean, live behind
```

Next: manual smoke test v0.2.133 → publish source-built artifact to `torii-quest.pplx.app`.

---

## 15-Hour Proof-of-Concept Route (ACTIVE)

The active MVP — demonstrate the end-to-end freedom-tech loop (thin vertical slices, not polish). **Shooter is maintenance-only unless demo-breaking; retrospective polish after PoC validation.** See `strategy.md`/`todo.md` → "15-Hour Proof-of-Concept Route".

| # | Slice | Status |
|---|-------|--------|
| LEAN-1 | Torii.quest live (publish current green source — manual maintainer deploy) | pending (smoke first) |
| LEAN-2 | Gateway / NAP-to-NAP preview via Torii Gateway component (relay-mediated) | foundation in (v0.2.134 protocol + `travelIntent`; v0.2.135: CMP-7 `registry` loader + CMP-8 `gatewayHandoff` shell turns a gate into a validated travel intent/URL; v0.2.136: `gatewayPortal` VIEW shell — render-ready portal view-model with label/prompt/armed/urlPreview, never navigates; v0.2.139: `gatewayPreview` VISIBLE — inert title-screen card via `gatewayPreviewBlock` (destination/status/relay/intent/URL rows + "PREVIEW · SAFE · INERT" badge), rendered with `textContent` only, read-only at `ToriiDebug.shells.gatewayPreview()`); needs the portal mesh + `world/handoff.js` to ACT on the intent |
| LEAN-3 | Plebeian / Nostr product panel proof (Plebeian.Market product display) | skeleton in (v0.2.134: read-only `productDisplay`; v0.2.135: `productPanel` view-model shell; v0.2.136: `productPanelShell` render shell — read-only panel layout, `actionable:false` footer, no checkout); needs the in-world panel mesh over the shell |
| LEAN-4 | Leaderboard preview (Nostr signed events) | skeleton in (v0.2.134: pure unsigned `leaderboard`; v0.2.135: `leaderboardPublisher` adapter shape — injected signer/publisher; v0.2.136: `leaderboardView` read-only display + build-only `leaderboardPreview`); needs the real signer + relay read |
| LEAN-5 | torii.quest GitHub update-check architecture | helper + view-model + docs in (v0.2.138: pure `engine/update/updateCheck.js` — `compareVersions`/`parseRelease`/`evaluateUpdate`/`updateCheckView`, inert `actionable:false` view-model, NO network/auto-update; `UPDATE_CHECK.md`; `tests/update-check.test.js`); needs the read-only releases fetch + in-world prompt mesh |

---

## Active Goals

1. Close out **ARS-1 through ARS-7** — agent-readable structure layer. Enables safe cross-session, cross-agent handoff.
2. **Lift source-built artifact to live** — publish v0.2.129 (or latest passing smoke test) to `torii-quest.pplx.app`.
3. **Player boundary full extraction** — movement tick, combat, lifecycle, body-state behind the seam.
4. **BotAgent runtime migration** — wire `decideActions`, migrate stateful tick/shoot/blowback.
5. **Formalise NAP zone + handoff** — promote skeletons to working boundaries before Nostr/world features scale.

---

## Current Sprint

| # | Track | Task | Status |
|---|-------|------|--------|
| ARS-1 | Foundation | ToriiDebug.snapshot() / combat.report() / physics.report() | done (v0.2.130) |
| ARS-2 | Rapier | Physics interaction API (pure interactions.js + mock tests) | done (v0.2.130) |
| ARS-3 | Rapier | RaycastService injectable facade (+ bot-LOS call-site migrated v0.2.131) | done (v0.2.130) |
| ARS-4 | Foundation | Fold reloading/pointerLocked into guarded FSM + GAMEOVER edge | partial — canShoot/canReload + isEngaged/needsPointerLock + isReloading/tickReload (v0.2.132) predicates extracted; real GAMEOVER edge (`END`/`endRun()`) wired v0.2.133 |
| ARS-3+ | Rapier | Weapons/player bullet+aim ray migration to RaycastService | done (v0.2.132); reticle preview migrated + injected-world tests v0.2.133 → ARS-3 cleanup done |
| CMP-1/2 | SDK/Nostr | Component contract + manifest spec (`COMPONENTS.md`, `contract.js`, SDK `component`) | done (v0.2.132) |
| CMP-8 | SDK | First reference component — Torii gateway skeleton (`toriiGateway.js`, SDK `toriiGateway`) | done (v0.2.133) |
| GWPROTO-1 | SDK/Nostr | Gateway Protocol draft (`GATEWAY_PROTOCOL.md`) + pure URL-handoff helpers (`engine/gateway/travelIntent.js`, SDK `travelIntent`) | done (v0.2.134) |
| CMP-13 | SDK | Read-only product display reference component (`productDisplay.js`, SDK `productDisplay`) | done (v0.2.134); panel view-model `productPanel.js` added v0.2.135 |
| LB-1 | Nostr | Leaderboard score-event helpers — pure unsigned template (`engine/nostr/leaderboard.js`, SDK `leaderboard`) | done (v0.2.134); publisher adapter shape `leaderboardPublisher.js` added v0.2.135 |
| CMP-7 | SDK | Component loader/registry — local built-in lookup, validates before load (`engine/components/registry.js`, SDK `registry`) | done (v0.2.135) |
| CMP-8+ | SDK | Gateway portal/handoff shell — gateway component → validated travel intent/URL (`engine/gateway/gatewayHandoff.js`, SDK `gatewayHandoff`) | done (v0.2.135); needs portal mesh + `world/handoff.js` to act on the intent |
| CMP-8++ | SDK | Gateway portal VIEW shell — render-ready portal view-model (`engine/gateway/gatewayPortal.js`, SDK `gatewayPortal`) | done (v0.2.136); display-only, never navigates; needs portal mesh to render it |
| CMP-13+ | SDK | Product panel RENDER shell — read-only panel layout (`engine/components/productPanelShell.js`, SDK `productPanelShell`) | done (v0.2.136); `actionable:false` + empty `actions[]`; needs panel mesh |
| LB-1+ | Nostr | Read-only leaderboard display + build-only preview shell (`engine/nostr/leaderboardView.js`, SDK `leaderboardView`) | done (v0.2.136); no signing/relay; needs real signer + relay read |
| HARD-1..4 | Tooling/UI/Security/Debug | Safe-hardening batch — version-drift guard, mock-chat marked non-live, CSP gstatic documented, `ToriiDebug.shells.*` read-only reports (`engine/debug/shellReport.js`) | done (v0.2.137) |
| MVP-pivot | Docs | Refocus living docs onto the 15-hour proof-of-concept route — shooter maintenance-only unless demo-breaking; active MVP = the freedom-tech loop | done (v0.2.138) |
| LEAN-5 | Infra/SDK | torii.quest GitHub update-check architecture — pure `engine/update/updateCheck.js` + inert view-model + `UPDATE_CHECK.md` (no network/auto-update) | done (v0.2.138); needs releases fetch + prompt mesh |
| LEAN-2+ | SDK/UI | Gateway/NAP-to-NAP VISIBLE preview — inert title-screen card (`engine/gateway/gatewayPreview.js`, SDK `gatewayPreview`); rendered by `main.js` via `textContent` only, read-only at `ToriiDebug.shells.gatewayPreview()` | done (v0.2.139); display-only, never navigates; needs portal mesh + `world/handoff.js` to act |
| ARS-5 | SDK | src/sdk/index.js skeleton with stability tiers | done (v0.2.131) |
| ARS-6 | Foundation | CODE_INDEX.md upkeep pass after each ARS task | ongoing |
| ARS-7 | Foundation | HANDOFF.md template | done (v0.2.130) |
| TQ-MANUAL-113 | Combat | Manual smoke test on real hardware | pending |
| PROGRESS-1 | Docs | Formalise / maintain progress.md | in progress |

---

## Completed Last 24h

Items stay here (crossed out) for ~24 hours, then move to Archive below.

- v0.2.139-alpha LEAN-2 visible gateway/NAP-to-NAP preview (safe — no deploy/network/gameplay change; pure helper + inert title card) — made the gateway/NAP-to-NAP hop VISIBLE on the title screen. New pure node-safe `engine/gateway/gatewayPreview.js` (`gatewayPreviewBlock` flattens the `gatewayPortal` VIEW shell into a render-ready block of label/value rows — destination, status, relay hint, travel intent, capped URL preview — plus `statusText`/`previewUrl` helpers and a "PREVIEW · SAFE · INERT" badge; every block is `actionable:false`). `main.js` renders the inert card into `#gateway-preview` using `textContent` only — NO link, NO navigation, NO fetch, NO signing. Surfaced read-only at `ToriiDebug.shells.gatewayPreview()` (via `engine/debug/shellReport.js`) and in the SDK as `gatewayPreview` (experimental). SEC-1/2/3 gates intact; godMode false; no new setTimeout/hot-path alloc; firing rule unchanged. +12 tests (330 total / 30 files)
- ~~v0.2.138-alpha MVP-pivot + torii.quest update-check batch~~ (safe — no DNS/VPS/deploy; docs + pure helper only) — **refocused the project onto the 15-hour proof-of-concept route**: pivoted the living docs (todo.md, strategy.md, progress.md, HANDOFF.md, CODE_INDEX.md) so shooter polish is MAINTENANCE-ONLY unless demo-breaking and the active MVP is the freedom-tech loop (gateway/NAP-to-NAP preview, Plebeian/Nostr product panel proof, leaderboard preview, torii.quest GitHub update-check), with retrospective polish after PoC validation. LEAN-5: scaffolded the torii.quest GitHub update-check architecture — pure node-safe `engine/update/updateCheck.js` (`compareVersions` tolerant semver compare, `parseRelease` GitHub-release normaliser, `evaluateUpdate`, `updateCheckView` + `RELEASE_SOURCE`/`UPDATE_STATUS`) that compares a release manifest's tag against runtime `VERSION` and returns an INERT "update available" view-model (`actionable:false`) — NO network fetch, NO auto-update, NO install; the releases fetch + in-world prompt mesh are documented deferred host steps. Surfaced via SDK `updateCheck` (experimental); `UPDATE_CHECK.md`; `tests/update-check.test.js`. SEC-1/2/3 gates intact; godMode false; no new setTimeout/hot-path alloc. +13 tests (318 total / 29 files)
- ~~v0.2.137-alpha safe-hardening batch (safe — no DNS/VPS/deploy; no gameplay-risk change) — addressed security/handoff-review warnings without touching gameplay. HARD-1: fixed package/runtime version drift (`package.json` 0.2.1 → semver `0.2.137-alpha`) + regression-check [5] now ties `package.json version` to `EXPECTED_VERSION` (v-stripped) so they can't drift again. HARD-2: marked the mock chat non-live — `#chat-input`/`#chat-send` disabled + greyed (`:disabled` CSS), placeholder "chat preview — not live", header "LIVE CHAT (preview)", comment added; still non-transmitting, no networking. HARD-3: reviewed + documented the CSP `connect-src https://www.gstatic.com` entry as REQUIRED (DRACO decoder fetch in arena.js/weapons.js); kept, not broadened. HARD-4: `engine/debug/shellReport.js` read-only debug reports over the v0.2.136 shells (`gatewayReport`/`productReport`/`leaderboardReport`/`buildShellReport` + demo fixtures) on `ToriiDebug.shells.*` — no signer/relay/publish/navigation; `tests/shell-report.test.js`. SEC-1/2/3 gates intact. +8 tests (305 total / 28 files)~~
- ~~v0.2.136-alpha visible-shells batch (safe — no DNS/VPS/deploy; no side effects) — turned the v0.2.135 pure infrastructure into render-ready VIEW shells, all node-pure (no THREE/Rapier/DOM/scene imports), all security gates intact. CMP-8 `engine/gateway/gatewayPortal.js` gateway portal VIEW shell (`gatewayPortalView`/`destinationLabel`/`shortKey` + `PORTAL_PROMPT`; emits status/isGateway/armed/destination/relay/prompt/plan/urlPreview — `armed = plan.valid`, prompt+urlPreview blank unless armed; DISPLAY-ONLY, never assigns window.location/contacts relay/signs; `tests/gateway-portal.test.js`); CMP-13 `engine/components/productPanelShell.js` product panel RENDER shell (`productPanelShell` → ordered `{title,imageUrl,lines[Price/Seller/(reward)],footer{kind:'link',actionable:false},actions:[],readOnly:true}`; invalid product degrades to `panel:null`; NO checkout/pay/zap/buy surface; `tests/product-panel-shell.test.js`); LB-1 `engine/nostr/leaderboardView.js` read-only leaderboard display + build-only preview (`rankScores` deterministic desc sort + 1-based rank, `leaderboardView({mode})` rejects any non-mock/build mode i.e. no 'live'/relay, `accuracyLabel`, `leaderboardPreview` runs through a no-signer/no-publisher adapter → `signed:false/published:false`; `tests/leaderboard-view.test.js`); all three surfaced via the SDK at the experimental tier. +23 tests (297 total / 27 files)~~
- ~~v0.2.135-alpha component-loader + handoff batch (safe — no DNS/VPS/deploy) — CMP-7 pure `engine/components/registry.js` component loader/registry (`createRegistry`/`createBuiltinRegistry`/`builtinRegistry`; register-by-factory probes + validates manifest/contract, `load(id, config)` returns a FRESH contract-valid instance, unknown/incompatible loads degrade safely; LOCAL built-ins only — no eval/dynamic-import/remote code; `tests/registry.test.js`); CMP-8 pure `engine/gateway/gatewayHandoff.js` portal/handoff shell (`gatewayDestination`/`planGatewayTravel`/`gatewayTravelUrl` map a gateway component's destination onto a validated travel intent / URL string; pure return values, NO window.location/relay/signing; `tests/gateway-handoff.test.js`); `engine/components/productPanel.js` read-only product panel view-model (`productPanelViewModel`/`priceLabel`; flat render-ready bag, no checkout surface; `tests/product-panel.test.js`); LB-1 `engine/nostr/leaderboardPublisher.js` publisher adapter shape (`createLeaderboardPublisher({sign,publish})`; INJECTED deps, build-only by default, captures sign/publish failures without throwing, no relay/secrets; `tests/leaderboard-publisher.test.js`); all four surfaced via the SDK at the experimental tier. +33 tests (274 total / 24 files)~~
- ~~v0.2.134-alpha lean-MVP foundation batch (safe — no DNS/VPS/deploy) — GWPROTO-1 `GATEWAY_PROTOCOL.md` n2n spatial-hop protocol DRAFT (relay-first hybrid discovery, URL handoff MVP, world/zone/gateway identity, travel intent, return path, signed-event future, security tiers, NIP path; "component is code, protocol is agreement") + pure `engine/gateway/travelIntent.js` URL-handoff helpers (`buildTravelIntent`/`validateTravelIntent`/`buildTravelUrl`/`parseTravelUrl`; no navigation/relay/signing; `tests/travel-intent.test.js`); CMP-13 read-only `engine/components/productDisplay.js` reference component (`createProductDisplay`/`productDisplay`/`validateProduct`, manifest kind:'product'/mountTarget:'panel', links OUT to Plebeian.Market, NO checkout/pay/zap/publish, safe https-only validation; `tests/product-display.test.js`); LB-1 pure `engine/nostr/leaderboard.js` unsigned Nostr score-event helpers (`buildScore`/`validateScore`/`buildScoreEventTemplate`, kind 30000, indexable tags, headshots≤kills; no signing/relay/publish; `tests/leaderboard.test.js`); all three surfaced via the SDK at the experimental tier. +41 tests (241 total / 20 files)~~
- ~~v0.2.133-alpha gateway batch (reconciled onto published v0.2.132 — no v0.2.132 work dropped) — ARS-4 real `GAMEOVER` edge (`GAME_EVENT.END` + `endRun()` in state.js, PLAYING/DEAD → terminal GAMEOVER; behaviour-preserving, no live caller yet; +state tests); ARS-3 final raycast cleanup (reticle preview `targetReticle.js` → `raycastService.ray`, no direct `castRay` consumers remain; +injected-fake-world ray/LOS tests); CMP-8 first reference component `engine/components/toriiGateway.js` (`createToriiGateway`/`toriiGateway`, skeleton no-op lifecycle, manifest kind:'gateway'/mountTarget:'scene', SDK `toriiGateway` experimental namespace; `tests/torii-gateway.test.js`). +15 tests (200 total / 17 files)~~
- ~~v0.2.132-alpha infrastructure batch — ARS-4 reload sub-state fold (`isReloading`/`tickReload` pure predicates in state.js, adopted in player.js/weapons.js/main.js; +5 state tests); ARS-3 weapons/player bullet+aim ray migration to `raycastService.ray`/`.rayStatic` (behaviour-identical, barrel→crosshair preserved; +3 service-wiring tests); CMP-1 `COMPONENTS.md` manifest spec (identity/provenance/npub, bundle hash, capabilities, deps, assets, config→mount options, pricing/zap split, Nostr listing events, security rules); CMP-2 `src/engine/components/contract.js` pure lifecycle contract (`validateManifest`/`isComponent`/`defineComponent`, idempotent mount/unmount) surfaced via SDK `component` namespace (experimental tier); `tests/component.test.js` (+14 tests). +22 tests (185 total / 16 files)~~
- ~~v0.2.131 foundation batch — ARS-5 `src/sdk/index.js` public SDK entrypoint (curated node-safe re-exports + `SDK_VERSION`/`STABILITY`/frozen `SDK_SURFACE` tier map; `tests/sdk.test.js`); ARS-3 follow-up: bot-LOS call-site migrated to `raycastService.lineOfSight()`; ARS-4 pointer-lock fold (`isEngaged`/`needsPointerLock` predicates in state.js, adopted at the main.js canvas re-lock guard; +4 state tests); CMP-1..16 component-marketplace tasks added to todo.md (Later track); esbuild dev-server advisory assessed + deferred (audit fix too broad). +11 tests (163 total / 15 files)~~
- ~~v0.2.130 no-blocker foundation batch — ARS-1 `engine/debug/snapshot.js` (`ToriiDebug.snapshot()`/`combat.report()`/`physics.report()`); ARS-2 `engine/physics/interactions.js` (pure `nudgeImpulse`/`applyNudge`, crate nudge tuning moved off weapons.js); ARS-3 `engine/physics/raycastService.js` (injectable facade on `ToriiDebug.physics.service`); FSM slice `canShoot`/`canReload` predicates in state.js (dead `state.paused` removed); ARS-7 `HANDOFF.md`; +26 tests (152 total / 14 files)~~
- ~~v0.2.129 muzzle origin side fix — `engine/weapons/muzzle.js`; `camera.getWorldQuaternion()` so barrel tracks yaw; +11 muzzle tests (126 total / 11 files)~~
- ~~v0.2.128 head-zone lowered (centre 1.65→1.55, radius 0.22→0.20); `_arenaBootstrapped` guard fixes re-entry collider orphan; +7 classifier tests~~
- ~~v0.2.127 reload snap viewmodel — pure `engine/weapons/reloadPose.js`; +8 reload-pose tests~~
- ~~v0.2.126 barrel→crosshair aim — pure `engine/combat/aim.js`; `tests/aim.test.js` (100 tests / 9 files)~~
- ~~v0.2.125 headshot damage extracted — `engine/combat/damage.js`; one-shot headshot / two-shot body contract locked~~
- ~~v0.2.124 shot diagnostics — `engine/combat/shotDiagnostics.js`; `ToriiDebug.combat.lastShot/lastMiss`~~
- ~~v0.2.123 player movement heading basis extracted to `engine/entities/player.js`; import narrowed to pure `bodies.js` leaf~~
- ~~v0.2.122 BotAgent SDK boundary first slice — pure `engine/entities/bot-agent.js`; BotAgent scalar helpers wired into bots.js~~
- ~~v0.2.121 first PHASE_CHANGE subscriber — screen visibility centralised in `engine/ui/phaseScreens.js`~~
- ~~v0.2.120 Vitest added; state machine, event bus, headshot classifier suites~~
- ~~v0.2.119 mirror handle accessor — last functional window.* global decoupled~~
- ~~v0.2.118 foliage shader materials moved off window into module-scope registry~~
- ~~v0.2.117 bot-hit bridge migrated onto event bus (EV.BOT_HIT_BY_PLAYER)~~
- ~~v0.2.116 event-bus seam formalised; EV.PHASE_CHANGE wired~~
- ~~v0.2.115 state-machine first slice — explicit FSM in state.js~~
- ~~v0.2.114 player boundary first slice — pure geometry/spawn/look-down POV math~~
- ~~progress.md created and added to todo.md, strategy.md, CODE_INDEX.md~~

---

## Archive

Completed items older than ~24h live here. Newest first.

### v0.2.100 – v0.2.113 — Foundation and Source Reconciliation (2026-06-23)

- Source reconciliation (v0.2.100–v0.2.108) reverse-ported into clean source by concern.
- v0.2.109 source reconciliation build.
- v0.2.110 foundation sprint: physics SDK seams, ToriiDebug namespace, hardening, NAP/handoff/presence skeletons, regression tooling.
- v0.2.111 regression repair: FP neck clipping, footstep drumroll, reflected gun roll, headshot classification, NAP NPC, reload viewmodel.
- v0.2.112 collision/POV tuning: widened bot head/body colliders, look-down camera arc, ToriiDebug.combat.lastHit.
- v0.2.113 foundation tuning: shared classifier for bullets + HUD, reticle restored, crate bullet nudges, faster reload.
- Safety hardening batch: CSP header, Nostr avatar URL validation, kill-feed innerHTML → safe DOM.
- All functional window.* globals decoupled across v0.2.117–v0.2.119.

---

## Update Rules

1. **Completed todo items** stay crossed out in `todo.md` for roughly 24 hours so context is preserved in active sessions.
2. After ~24 hours, move them from the "Completed Last 24h" section here into Archive, grouped by date or sprint.
3. `todo.md` should remain focused on active and near-term work only — no graveyard of old completions.
4. `progress.md` (this file) is the visual execution layer. `strategy.md` owns vision and decision rules. `todo.md` owns the active task queue.
5. Update track bars when a seam is extracted, a sprint block closes, or a major fix lands. Exact counts are less important than directional accuracy.
6. Version the Archive entries by sprint or date cluster — avoid per-version archaeology.
7. Do not list Google, Cloudflare, Microsoft, or Babylon.js anywhere in this file.
