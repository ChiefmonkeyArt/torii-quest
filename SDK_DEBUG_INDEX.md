# Torii Quest — SDK & Debug Surface Index

> **Status:** discoverability index (v0.2.149-alpha). A one-page map of the public
> SDK namespaces, the four MVP proof surfaces, and the read-only `ToriiDebug.shells`
> reports — for AI handoffs and FOSS contributors. **Everything listed here is pure
> and inert:** no network, no navigation, no signing/publishing, no auto-update.
> Source of truth for the SDK surface is `src/sdk/index.js` (`SDK_SURFACE`); for the
> debug reports it is `src/engine/debug/shellReport.js`. See `CODE_INDEX.md` for the
> full file-by-file map and `HANDOFF.md` for onboarding.

---

## 1. SDK entrypoint

`import * as torii from 'src/sdk/index.js'` (or destructure namespaces). It re-exports
ONLY pure, node-safe leaf modules — nothing transitively imports `scene.js`, so the
SDK loads in a plain node/vitest env. Each surface carries a `STABILITY` tier in the
frozen `SDK_SURFACE` map; `surfacesByTier(tier)` lists names at a tier.

- `SDK_VERSION` — tracks `config.js` `VERSION`.
- `STABILITY` — `{ STABLE, EXPERIMENTAL, INTERNAL }`.
- `SDK_SURFACE` — `{ name: { tier, module } }` (module `null` = forward-declared internal).

### STABLE namespaces (locked by tests; safe to depend on)

| Namespace | Module | What it is |
|---|---|---|
| `aim` | `engine/combat/aim.js` | barrel→crosshair aiming (`crosshairPoint`/`aimDirection`/`CONVERGE_DIST`) |
| `classifier` | `engine/combat/classifier.js` | head-vs-body hit geometry |
| `damage` | `engine/combat/damage.js` | head/body damage + kill-threshold contract |
| `interactions` | `engine/physics/interactions.js` | allocation-free `nudgeImpulse`/`applyNudge` |
| `raycastService` | `engine/physics/raycastService.js` | injectable raycast facade (`createRaycastService`, `raycastService`) |
| `reloadPose` | `engine/weapons/reloadPose.js` | reload viewmodel dip curve |
| `muzzle` | `engine/weapons/muzzle.js` | muzzle/barrel world-position math |

### EXPERIMENTAL namespaces (work + tested; shape may change)

`botAgent`, `snapshot`, `phaseScreens`, `component`, `registry`, `toriiGateway`,
`productDisplay`, `productPanel`, `productPanelShell`, `productPreview`,
`travelIntent`, `gatewayHandoff`, `gatewayPortal`, `gatewayPreview`, `leaderboard`,
`leaderboardPublisher`, `leaderboardView`, `leaderboardPreview`, `updateCheck`,
`updatePreview`, `mvpLoop`, `proofSurfaceSpecs`, `anchorTransforms`.

### INTERNAL (forward-declared, `module:null` — do NOT depend on yet)

`physicsBodies`, `physicsRaycast`, `player`, `identity`.

---

## 2. The four MVP proof surfaces + the loop

The 15-hour proof-of-concept route renders four inert title-screen preview cards,
framed as one **Travel → Market → Score → Update** loop. Each card is fed by a pure
SDK preview module and mirrored read-only on `ToriiDebug.shells`.

| Step | LEAN | Card / SDK namespace | `ToriiDebug.shells` report | Inert invariants |
|---|---|---|---|---|
| 1 · TRAVEL | LEAN-2 | `gatewayPreview` | `gatewayPreview()` | `readOnly:true`, `actionable:false` — never navigates |
| 2 · MARKET | LEAN-3 | `productPreview` | `productPreview()` | `readOnly:true`, `actionable:false` — no checkout/pay/zap |
| 3 · SCORE | LEAN-4 | `leaderboardPreview` | `leaderboardPreview()` | `readOnly:true`, `actionable:false`, `signed:false`, `published:false` |
| 4 · UPDATE | LEAN-5 | `updatePreview` | `updatePreview()` | `readOnly:true`, `actionable:false` — no fetch/install/auto-update |
| (header) | — | `mvpLoop` | `mvpLoop()` | `readOnly:true`, `actionable:false` — content/labelling only |

Underlying view/shell modules behind these previews: `gatewayPortal` (LEAN-2),
`productPanelShell` (LEAN-3), `leaderboardView` (LEAN-4), `updateCheck` (LEAN-5).
The `*Preview` modules are the visible-but-inert presentation layer over them.

As of **v0.2.146** all four previews expose the same `readOnly:true` +
`actionable:false` invariant pair (the gateway preview gained `readOnly` for
symmetry), so a reviewer can assert one consistent shape across every proof surface.

---

## 3. `ToriiDebug.shells.*` reports

Read-only DEBUG reports over the proof surfaces, with safe frozen demo fixtures
(`DEMO_GATEWAY`/`DEMO_PRODUCT`/`DEMO_SCORES`/`DEMO_RELEASE`) so each works
out-of-the-box. They ONLY read the shells' pure return values — no signer, relay,
publish, or navigation. Pass overrides to inspect your own data.

| Call | Returns (shape highlights) |
|---|---|
| `shells.gateway(c?,ctx?,o?)` | gateway portal VIEW summary — `{status,isGateway,armed,destinationLabel,relay,prompt,urlPreview,errors}` |
| `shells.gatewayPreview(c?,ctx?,o?)` | LEAN-2 preview block — `{title,status,statusLabel,armed,destination,relay,intent,urlPreview,badge,lines,readOnly:true,actionable:false}` |
| `shells.product(p?)` | product panel RENDER summary — `{ok,errors,title,lineCount,lines,footer,actionable:false,actionCount:0,readOnly:true}` |
| `shells.productPreview(p?,o?)` | LEAN-3 preview block — `{title,ok,seller,sellerFull,marketplace,badge,lines,readOnly:true,actionable:false,errors}` |
| `shells.leaderboard(s?,o?)` | ranked summary — `{mode,count,skipped,rows,signed:false,published:false}` |
| `shells.leaderboardPreview(s?,o?)` | LEAN-4 preview block — `{title,mode,modeLabel,badge,signed:false,published:false,signer,count,shown,skipped,proof,rows,lines,readOnly:true,actionable:false}` |
| `shells.updatePreview(r?,o?)` | LEAN-5 preview block — `{title,badge,status,statusLabel,currentVersion,latestVersion,updateAvailable,prompt,source,lines,readOnly:true,actionable:false}` |
| `shells.mvpLoop(o?)` | loop header block — `{title,badge,flow,note,version,steps,lines,readOnly:true,actionable:false}` |
| `shells.report(inputs?)` | composite of all of the above (each section overridable via `inputs`) |
| `shells.summary(inputs?)` | **v0.2.145** discoverability aggregate (see §4) |
| `shells.diff(a?,b?)` | **v0.2.146** pure diff of two `summary()` outputs, flagging invariant flips that loosen inertness (see §4.1) |
| `shells.surfaceSpecs()` | **v0.2.147** pure in-world proof-surface LAYOUT/SPEC layer — `{badge,anchorZone,count,bounds,specs,allInert,rendered:false,actionable:false}` (see §4.2) |
| `shells.surfaceSpecCheck(map?,specs?)` | **v0.2.148** pure cross-check that each spec's `previewSdk`/`shell` align with the live SDK + shells registries + inert invariants — `{ok,badge,checked,errors,warnings,surfaces}` (see §4.3) |
| `shells.anchorTransforms(specs?)` | **v0.2.149** pure anchor→transform resolution — binds each spec's `anchor` id to a plain transform descriptor (origin/position/offset/size/yawRad) + lists unresolved anchors — `{ok,badge,count,resolved,unresolved}` (see §4.4) |

Other namespaces on `ToriiDebug`: `snapshot()` / `combat.report()` / `physics.report()`
(JSON-serialisable status), `bots`, `player`, `physics`, `world`, `identity`, `fx`.

---

## 4. `ToriiDebug.shells.summary()` — one-call overview (v0.2.145)

`shells.summary()` (pure `shellsSummary()` in `shellReport.js`) returns a compact,
JSON-serialisable map of the four proof surfaces framed by the loop. Every invariant
is **read from the live report output**, so the summary cannot claim an inertness the
underlying shell does not have. Shape:

```js
{
  version,            // === config VERSION
  flow,               // "Travel → Market → Score → Update"
  loop: { key:'mvpLoop', sdk, shell, title, flow, invariants:{readOnly,actionable} },
  surfaces: [         // 4 entries, in loop order
    { key, lean, step, sdk, shell, title, invariants:{ readOnly, actionable, signed?, published? } },
    ...
  ],
  count: 4,
  allInert,           // true iff no surface/loop is actionable and none claim signed/published
  network: false,     // false by construction across every proof surface
  autoUpdate: false,  // false by construction
}
```

`allInert` is the single boolean a reviewer (human or AI) can assert to confirm the
proof surfaces remain display-only. Every surface carries `readOnly` + `actionable`
(v0.2.146 symmetry); the leaderboard adds `signed` + `published`.

---

## 4.1. `ToriiDebug.shells.diff(a, b)` — promotion review helper (v0.2.146)

`shells.diff(a, b)` (pure `shellsDiff()` in `shellReport.js`) compares two
`summary()` outputs — `a` = before/preview, `b` = after/promoted — and classifies
each invariant flip so a preview→live promotion can be reviewed mechanically. It
performs NO network/actions/DOM/THREE; it only compares two already-computed
summaries. Shape:

```js
{
  changed,                 // any flip at all
  safe,                    // true iff NO flip loosens inertness
  fromVersion, toVersion,
  flips: [                 // every difference found
    { scope:'summary',  key, from, to, loosens },                 // allInert/network/autoUpdate
    { scope:'surface',  key, invariant, from, to, loosens },      // per-surface invariant
    { scope:'surface',  key, change:'added'|'removed', loosens:false },
  ],
  loosened,                // subset of flips where loosens===true — the review checklist
}
```

A flip **loosens** inertness when it moves an invariant to its unsafe value
(`actionable→true`, `readOnly→false`, `signed→true`, `published→true`,
`allInert→false`, `network→true`, `autoUpdate→true`). `safe===true` means the diff
only changed display/labels or *tightened* inertness — exactly the property a
reviewer wants before approving a promotion. Untracked keys never count as loosening.

---

## 4.2. `ToriiDebug.shells.surfaceSpecs()` — in-world layout/spec layer (v0.2.147)

`shells.surfaceSpecs()` (pure `proofSurfaceLayout()` in
`engine/world/proofSurfaceSpecs.js`) returns the spec/contract layer for the FUTURE
in-world proof meshes — placement data for the four MVP proof surfaces as PLAIN data
only. It builds NO Three.js objects, touches NO DOM/renderer, and integrates NO
gameplay: `position`/`size` are `{x,y,z}`/`{width,height,depth}` plain objects and
facing is a plain `yawRad` number, so the module stays node-testable. Shape:

```js
{
  badge,               // "SPEC · INERT · LAYOUT-ONLY"
  anchorZone: 'nap-zone',
  count: 4,
  bounds: { minX, maxX, minZ, maxZ },   // all within the NAP zone (x in [NAP_X, NAP_FAR_X])
  specs: [             // PROOF_SURFACE_SPECS — 4 frozen specs in loop order
    { id, step, lean, title, kind, previewSdk, shell, anchor,
      position:{x,y,z}, size:{width,height,depth}, yawRad,
      invariants:{ readOnly:true, actionable:false, signed?, published? } },
    ...
  ],
  allInert,            // true iff no spec is actionable and none claim signed/published
  rendered: false,     // nothing is in-world yet — spec/contract layer only
  actionable: false,
}
```

The four specs are `gateway-portal-panel` (TRAVEL/LEAN-2), `product-stall-panel`
(MARKET/LEAN-3), `leaderboard-board` (SCORE/LEAN-4), `update-prompt-board`
(UPDATE/LEAN-5). `getProofSurfaceSpec(id)` returns one spec or null. This is the
contract a future mesh pass binds against; `rendered:false`/`allInert` are the gates
a reviewer asserts to confirm nothing has gone live yet.

---

## 4.3. `ToriiDebug.shells.surfaceSpecCheck()` — spec↔registry cross-check (v0.2.148)

`shells.surfaceSpecCheck(map?, specs?)` (pure `checkProofSurfaceSpecs()` in
`engine/debug/proofSurfaceCheck.js`) verifies the proof-surface specs stay ALIGNED
with the live registries they claim to feed from — the guard you run BEFORE the
future mesh pass binds a mesh to a spec. It performs NO render/network/DOM; it only
reads static `SDK_SURFACE` metadata + the deterministic demo output of
`buildShellReport()`. For each spec it checks:

- `previewSdk` names a real SDK **experimental** namespace (unknown → error;
  known-but-non-experimental → warning),
- `shell` names a real `ToriiDebug.shells` report (a `buildShellReport()` key),
- the inert invariants hold (`readOnly:true`/`actionable:false`, never
  `signed`/`published` true), and
- no live-action key (`fetch`/`navigate`/`href`/`sign`/`publish`/`checkout`/
  `onClick`/`mesh`/`geometry`/…) has crept onto the spec.

Shape:

```js
{
  badge: 'SPEC-CHECK · READ-ONLY · NO RENDER',
  checked,                 // number of specs checked
  ok,                      // true iff errors.length === 0
  errors,                  // alignment/invariant violations (fail ok)
  warnings,                // non-fatal (e.g. a non-experimental SDK reference)
  surfaces: [ { id, previewSdk, shell, sdkOk, shellOk, inert }, ... ],
}
```

Pass `{ sdk, shells }` (each a Set or array of names) to check against your own
registries instead of the live defaults; pass `specs` to check a candidate spec set.
`ok===true` is the single boolean a reviewer asserts to confirm the spec layer is
wired correctly before promotion.

---

## 4.4. `ToriiDebug.shells.anchorTransforms()` — anchor→transform contract (v0.2.149)

`shells.anchorTransforms(specs?)` (pure `resolveAllAnchors()` in
`engine/world/anchorTransforms.js`) is the single source of truth for what each
proof-surface `anchor` id MEANS in world space, so the future mesh pass can resolve
placement without re-deriving coordinates. It builds NO Three.js objects, touches NO
DOM/renderer, integrates NO gameplay: every coordinate is a plain `{x,y,z}` object /
plain number. The anchor registry (`PROOF_SURFACE_ANCHORS`, keyed by the four anchor
ids) maps each anchor to a ground `origin` (y:0), a `parent` hint, and its NAP `zone`.
`resolveAnchorTransform(spec)` binds one spec to its anchor; `resolveAllAnchors(specs)`
resolves the set. Shape:

```js
{
  badge: 'ANCHOR · PLAIN-TRANSFORM · NO RENDER',
  count,                   // number of specs considered
  ok,                      // true iff every spec's anchor resolved (unresolved empty)
  resolved: [              // one descriptor per resolvable spec
    { badge, surfaceId, anchor, parent, zone,
      origin:{x,y,z},      // anchor ground point (y:0)
      position:{x,y,z},    // surface world position (from the spec)
      offset:{x,y,z},      // position − origin (local offset to apply at the anchor)
      size:{width,height,depth}, yawRad,
      rendered:false, actionable:false },
    ...
  ],
  unresolved: [ { surfaceId, anchor }, ... ],   // specs pointing at an unknown anchor
  rendered: false,
  actionable: false,
}
```

The four anchors are `torii-gate-threshold` (parent `torii-gate`),
`nap-zone-north-stall`, `nap-zone-far-centre`, and `nap-zone-south-board` (parent
`nap-zone-floor`). `getAnchor(id)` returns one anchor or null. The invariant
`origin + offset === position` lets a mesh pass parent to the anchor and apply a
local offset; `ok===true` confirms every spec resolves before any mesh binds.

---

## 5. Where the tests live

| Surface | Test file |
|---|---|
| SDK entrypoint (`SDK_SURFACE`, tiers, re-exports) | `tests/sdk.test.js` |
| `gatewayPreview` | `tests/gateway-preview.test.js` |
| `productPreview` | `tests/product-preview.test.js` |
| `leaderboardPreview` | `tests/leaderboard-preview.test.js` |
| `updatePreview` | `tests/update-preview.test.js` |
| `mvpLoop` | `tests/mvp-loop.test.js` |
| `ToriiDebug.shells.*` reports + `summary()` | `tests/shell-report.test.js` |
| `proofSurfaceSpecs` / `shells.surfaceSpecs()` | `tests/proof-surface-specs.test.js` |
| `shells.surfaceSpecCheck()` (spec↔registry cross-check) | `tests/proof-surface-check.test.js` |
| `anchorTransforms` / `shells.anchorTransforms()` | `tests/anchor-transforms.test.js` |
| underlying view/shell modules | `tests/gateway-portal.test.js`, `tests/product-panel-shell.test.js`, `tests/leaderboard-view.test.js`, `tests/update-check.test.js` |

Run all with `npm test` (Vitest, node env). `npm run check` separately guards the
scaffold + version markers statically.

---

## 6. How to add a new proof card (or promote preview → live)

### Add a new inert preview card (the safe, established pattern)

1. **Pure module** under `engine/<area>/<name>Preview.js` — export a `*Block(...)`
   formatter returning `{ label, value }` rows + a `*_BADGE` constant. Pin
   `actionable:false` (and `readOnly:true`; `signed:false`/`published:false` if it
   models a transmit). Import only pure deps (config + sibling pure modules) so it
   stays node-testable. **No** THREE/Rapier/DOM, fetch, navigation, or signing.
2. **SDK** — add `export * as <name>` in `src/sdk/index.js` and a `SDK_SURFACE`
   entry at the `EXPERIMENTAL` tier (`tests/sdk.test.js` validates it automatically).
3. **Debug report** — add a `<name>Report(...)` in `shellReport.js` (reads the
   block's pure output, re-pins the inert invariants), add it to `buildShellReport`,
   and surface `shells.<name>(...)` in `toriiDebug.js`. If it is a proof card, add it
   to the `surfaces[]` in `shellsSummary()` so `summary()` and `allInert` cover it.
4. **Render** — in `main.js`, write the rows into the card via `textContent` ONLY
   (no `innerHTML`); add the card markup + CSS in `index.html`.
5. **Test** — add `tests/<name>.test.js` asserting the inert invariants and that no
   live-action keys (`fetch`/`navigate`/`sign`/`publish`/`checkout`/`onClick`) leak.
6. **Docs** — update this index (§2/§3/§5), `CODE_INDEX.md`, `progress.md`, `todo.md`.
7. **Bump the version** and run `npm run build && npm run check && npm test`.

### Promote a preview to a live surface

A "live" surface performs a real side effect (a read-only GitHub fetch, NIP-07
signing, relay publish, in-world navigation). These are **deferred host steps** and
require explicit sign-off — they are NOT safe-slice work. When authorised:

- Keep the pure preview module inert; build the live action as a SEPARATE, guarded
  module (the preview stays the display layer).
- Network reads need a CSP `connect-src` entry and live in the host layer, not the
  pure helper (see `UPDATE_CHECK.md` §3, `VPS_INSTALL.md` §10).
- Signing/publish must go through an injected signer/publisher with explicit user
  confirmation (see `leaderboardPublisher`, SEC-1).
- Flip the relevant invariant deliberately and update `shellsSummary()` + its tests
  so `allInert` reflects reality. Never silently leave `allInert:true` claiming
  inertness a live path has removed.
- Use `shells.diff(before, after)` to review the promotion: its `loosened[]` list is
  the exact set of inertness-reducing flips that need sign-off. A promotion whose
  diff is `safe:true` did not actually loosen anything (likely a no-op or a labelling
  change); a real promotion should show the intended flips in `loosened[]` and
  nothing more.
