# Torii Quest — v0.2.135-alpha Report (component loader/registry · gateway handoff shell · product panel view-model · leaderboard publisher)

> Batch report for v0.2.135-alpha. A **safe foundation batch** for the lean
> prototype: every item is a pure, node-safe module. Nothing here needs
> torii.quest DNS/VPS credentials, and **no deploy/publish/push/upload is
> performed** — the maintainer/main agent ships after a manual smoke test.

---

## 1. Summary

Four foundation slices toward the lean freedom-tech loop, plus docs:

1. **CMP-7 — component loader/registry.** New pure `src/engine/components/registry.js`
   (`createRegistry` / `createBuiltinRegistry` / `builtinRegistry`). Registers
   LOCAL built-in component factories by id/kind, probes + validates
   manifest/contract on register, and `load(id, config)` returns a FRESH
   contract-valid instance per call (unknown/incompatible loads degrade, never
   throw). NO eval / dynamic-import / remote fetch — local code only.
2. **CMP-8 (cont.) — gateway portal/handoff shell.** New pure
   `src/engine/gateway/gatewayHandoff.js` (`gatewayDestination` /
   `planGatewayTravel` / `gatewayTravelUrl`) maps a gateway component's
   destination block onto a validated travel intent / URL via `travelIntent.js`.
   Pure return values; NO `window.location` / relay / signing.
3. **CMP-13 (cont.) — product panel view-model.** New pure
   `src/engine/components/productPanel.js` (`productPanelViewModel` / `priceLabel`)
   turns a validated product into a flat, render-ready bag for a future panel
   mesh. Still read-only — NO checkout/pay/zap/publish surface.
4. **LB-1 (cont.) — leaderboard publisher adapter shape.** New pure
   `src/engine/nostr/leaderboardPublisher.js`
   (`createLeaderboardPublisher({ sign, publish })`). INJECTED signer/publisher
   deps; build-only by default; captures sign/publish failures without throwing.
   No keys / relay / secrets.

All four surfaced via the SDK at the **experimental** tier.

---

## 2. Changes by file

| File | Change |
|---|---|
| `src/config.js` | `VERSION` → `v0.2.135-alpha`. |
| `index.html` | `#version-label` + `#ver` → `v0.2.135-alpha`. |
| `tools/regression-check.mjs` | header + `EXPECTED_VERSION` → `v0.2.135-alpha`; stale-version guard now flags `v0.2.134-alpha`. |
| `src/engine/components/registry.js` | NEW — pure component loader/registry (CMP-7). |
| `tests/registry.test.js` | NEW — register/discovery, rejects non-fn/non-component/duplicate, fresh+independent instances, unknown/incompatible degrade, built-in registry, SDK exposure (11). |
| `src/engine/gateway/gatewayHandoff.js` | NEW — pure gateway → travel intent/URL shell (CMP-8 cont.). |
| `tests/gateway-handoff.test.js` | NEW — destination extract/null, plan mapping/npub-fallback/bad-traveller/non-gateway, URL round-trip/empty-on-invalid, SDK exposure (9). |
| `src/engine/components/productPanel.js` | NEW — read-only product panel view-model (CMP-13 cont.). |
| `tests/product-panel.test.js` | NEW — priceLabel rules, full/partial views, invalid degrades, no checkout surface, SDK exposure (6). |
| `src/engine/nostr/leaderboardPublisher.js` | NEW — publisher adapter shape (LB-1 cont.). |
| `tests/leaderboard-publisher.test.js` | NEW — build-only, signer-only, signer+publisher, sign/publish failure capture, invalid-throws-before-sign, SDK exposure (7). |
| `src/sdk/index.js` | `registry` / `gatewayHandoff` / `productPanel` / `leaderboardPublisher` namespace re-exports + `SDK_SURFACE` entries (experimental). |
| `CODE_INDEX.md`, `COMPONENTS.md`, `GATEWAY_PROTOCOL.md`, `HANDOFF.md`, `progress.md`, `strategy.md`, `todo.md` | v0.2.135 doc upkeep. |

---

## 3. The pieces

### 3.1 Component loader/registry (CMP-7)

`createRegistry()` returns a registry backed by a `Map` of `id → { id, kind,
factory }`. `register(factory)` probes the factory ONCE, asserts the result is a
valid component (`isComponent` + `validateManifest` pass) and records it by
`id`/`kind` — throwing on a non-factory, a non-component, or a duplicate id.
`has(id)` / `ids()` / `kinds()` / `byKind(kind)` / `size` query it.
`load(id, config)` builds a FRESH instance per call (instances are independent),
re-validates the manifest, and flags an `incompatible contract version` when
`manifest.contract !== COMPONENT_CONTRACT_VERSION`. Unknown ids and incompatible
loads return `{ ok:false, errors }` — `load` NEVER throws. `createBuiltinRegistry()`
/ `builtinRegistry` register the in-repo built-ins (`createToriiGateway`,
`createProductDisplay`). SECURITY: local factories only — no eval / dynamic
import / remote fetch; the remote/Nostr-event path with signature/hash/capability
enforcement is later CMP work.

### 3.2 Gateway handoff shell (CMP-8 cont.)

`gatewayDestination(component)` returns `manifest.gateway` when the component is a
`kind:'gateway'` with a destination block, else `null`. `planGatewayTravel(
component, context)` maps `gateway.target || gateway.npub` → `to`, `gateway.relay`
→ `relays:[…]`, merges host context (`from`/`player`/`spawn`/`return`/`zoneType`/
`state`), and returns a validated `{ valid, errors, intent }` via
`validateTravelIntent`. `gatewayTravelUrl(component, context, { base })`
serialises a valid plan (`url=''` on invalid). NO navigation / relay / signing.

### 3.3 Product panel view-model (CMP-13 cont.)

`priceLabel(priceSats)` → `'See price'` (null), `'Free'` (0), else `'<n> sats'`.
`productPanelViewModel(product)` validates first (via `validateProduct`), then
returns `{ ok, errors, view }` where `view` is a flat render-ready bag
(`title`, `imageUrl`, `hasImage`, `priceLabel`, `seller`, `linkUrl`,
`linkLabel:'View on Plebeian.Market'`, `reward`, `hasReward`). Read-only — no
`checkout`/`pay`/`zap`/`buy`/`publish` key (asserted by the test).

### 3.4 Leaderboard publisher adapter (LB-1 cont.)

`createLeaderboardPublisher({ sign=null, publish=null })` → `{ publishScore }`.
`async publishScore(stats)` builds the unsigned kind-30000 template (via
`buildScoreEventTemplate`, which throws on an invalid score BEFORE any sign call),
then: no signer → build-only (`{ ok:true, template, signed:false }`); signer →
`event = await sign(template)`, `signed:true`; signer + publisher →
`await publish(event)`, `published:true`. Sign/publish failures are captured in
`errors` with `ok:false` — not thrown. No keys / relay / secrets.

---

## 4. Verification

- `npm run build` — clean (dist rebuilt to v0.2.135 so `[6]` dist markers pass).
- `npm run check` — all 11 regression guardrails GREEN (`[5]` version markers ==
  `v0.2.135-alpha`; `[11]` 24 test files).
- `npm test` — **274 passed / 24 files**.

Constraints honoured: `godMode` false; no new `setTimeout`; no new
`Vector3`/`Matrix4` (new modules import no THREE); "nostrich"/"Chiefmonkey"
spelling intact; debug tools unconditional; split by concern.

---

## 5. Deferred

None. All four work-order items landed (the prioritisation fallback to defer
product panel / leaderboard publisher was not needed). The non-pure follow-ons
remain tracked, not in scope for this batch: the gateway portal mesh + acting on
a validated intent in `world/handoff.js`, the in-world product panel mesh, the
real leaderboard signer/publisher + relay read, and the loader's remote/Nostr
distribution path with signature/hash/capability enforcement.

---

## 6. Next

- Manual smoke test on real hardware (TQ-MANUAL-113), then publish — a separate
  manual maintainer/main-agent step. **No deploy/publish/push/upload performed by
  this task.**
- LEAN-2: wire `gatewayHandoff` + the gateway portal mesh into `world/handoff.js`
  to ACT on a validated travel intent (move the player).
- LEAN-3: the in-world product panel mesh over `productPanel` view-model.
- LEAN-4: the real leaderboard signer/publisher injected into
  `createLeaderboardPublisher` + relay read.
