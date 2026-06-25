# Torii Quest — v0.2.178-alpha · LEAN-2 Gateway Handoff Activation

**Slice:** LEAN-2 — live-wire the existing same-origin host transport into the confirmed
gateway handoff flow so the v0.2.168 executor can ACT on a confirmed same-site hop.
**Status:** complete, full release gate green, committed locally only (no push/deploy/publish).

---

## 1. What path is now live-wired

A NEW pure module, `src/engine/gateway/gatewayActivation.js`, is the activation seam that
finally connects the previously-inert chain end-to-end:

```
prepareTravelIntent (consent)  →  planHandoff (dry-run plan)  →  [GATES]  →  executeHandoff  →  host transport.navigate()
                                                                   ▲
                                                    gatewayActivation.activateGatewayHandoff()
```

Before this slice the v0.2.168 executor + the v0.2.170 `createBrowserHostTransport(window)`
adapter both existed but nothing connected a confirmed travel intent to a real transport — so
a same-origin hop could never actually happen. `gatewayActivation` is that connector.

Exports:
- `ACTIVATION_VERSION = 1`, `ACTIVATION_BADGE = 'GATEWAY · CONFIRMED · SAME-ORIGIN HOP'`
- `ACTIVATION_STATUS` = `{ NAVIGATED, UNCONFIRMED, NO_TRANSPORT, BLOCKED, ROLLED_BACK, FAILED }`
- `TRANSPORT_KIND` = `{ BROWSER, HOST, INJECTED, NONE }`
- `resolveHostTransport(source, opts) → { transport, kind }`
- `activateGatewayHandoff(input, grant, opts) → report`
- `DEMO_ACTIVATION_OPTS` (frozen: `confirmed:true` + `routeAllowlist:['/zone/']`)

`resolveHostTransport(source)` turns one of three things into a usable transport **without
navigating**: an `isHostTransport` object passes through (`injected`); a window-shaped object
(`history.pushState`) becomes a `browser` transport via `createBrowserHostTransport`; an
`isRouteHost` host becomes a `host` transport via `createHostTransport`; anything else → `none`.

## 2. How confirmation / safety works

`activateGatewayHandoff(input, grant, opts)` **always builds the dry-run `planHandoff` first**
(inert, auditable), then enforces THREE gates **in order** — and only resolves a transport AFTER
all three pass, so a preview/render path can never navigate even if a window is handed in:

1. **Confirmation gate** — `opts.confirmed === true` must be the *literal boolean*. Any
   truthy-but-not-true value (`1`, `'true'`, `'yes'`, `{}`, `[]`) → `UNCONFIRMED`, and the
   transport is **never resolved**.
2. **Consent gate (preserved)** — the consent-gated plan must be `ok`. A missing/mismatched
   grant or an unidentifiable destination → `BLOCKED`. (This is the existing v0.2.162/165/167
   gate, unchanged.)
3. **Route gate** — the planned `targetRoute` must pass an optional `routeAllowlist` prefix
   check (`route-not-allowed` → `BLOCKED`). The route itself is already constrained to a safe
   same-origin `/path` by `safeRoutePath` inside the plan + re-validated by the transport
   (defense in depth).

Only then is a transport resolved (from `opts.transport` / `opts.window` / `opts.host`) and
`executeHandoff` called. `live` is `true` only on the real browser-window path. The report PINS
`external:false`, `worldReloaded:false`, `signed:false`, `published:false`, `network:false` — a
tampered plan cannot flip a safety flag. The module is pure/node-safe: the browser `window` is
INJECTED, never referenced at module scope, and it exposes no bare
`open/reload/goto/assign/href/pushState/location/navigate` method.

## 3. Route restrictions

- Same-origin only: `safeRoutePath` (in `handoffPlan.js`) accepts a string only if it starts
  with a single `/` — rejecting `//` protocol-relative, `javascript:`/`data:`/other schemes,
  whitespace, control chars, markup, backslashes, and anything over 256 chars.
- The external `targetUrl` is **never** executed (preview-only, carried over from v0.2.168).
- The optional `routeAllowlist` is a prefix list (e.g. `['/zone/']`); with no allowlist any safe
  same-origin route is allowed. An injected transport re-validates the route itself, so even a
  hostile caller cannot smuggle an external/scheme route through.

## 4. Rollback / back-home state

Reachable and tested. A failed navigate (the transport's `navigate()` returns `false`) triggers
a single synchronous rollback (no timers) to the `rollbackRoute` (back-home) via
`transport.rollback(rollbackRoute)` when supported → status `ROLLED_BACK`. A navigate that throws
with no rollback support → status `FAILED` with captured `errors`. This rides on the existing
v0.2.168/170 rollback machinery; no new rollback code was added.

## 5. Files changed

**New**
- `src/engine/gateway/gatewayActivation.js` — the activation seam (primary deliverable).
- `tests/gateway-activation.test.js` — 25 tests.

**Modified (wiring + exposure)**
- `src/sdk/index.js` — `export * as gatewayActivation` + `SDK_SURFACE` entry (experimental tier).
- `src/engine/debug/shellReport.js` — `gatewayActivationReport(...)` (drives an in-memory
  recording host so debug never live-navigates) + wired into `buildShellReport`.
- `src/engine/debug/toriiDebug.js` — `shells.gatewayActivation(input, grant, opts)`.
- `tools/testProfiles.mjs` — added `gateway-activation.test.js` to the `foundation` profile.

**Version markers (bumped together → v0.2.178-alpha)**
- `src/config.js`, `package.json`, `index.html`, `tools/regression-check.mjs`
  (header + `EXPECTED_VERSION` + stale-guard now flags v0.2.177), `src/engine/dashboard/continuumData.js`
  (`CONTINUUM_VERSION`, metrics, `HEALTH_LASTKNOWN.totalTests`, active-now/completed-24h entries,
  LEAN-2 status text, next-12 item 1), `tests/continuum-dashboard.test.js` (4 strings).

**Docs**
- `todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`,
  `GATEWAY_PROTOCOL.md` — current-version lines + a v0.2.178 activation entry each.
- `public/continuum.html` + `public/continuum-data.json` — regenerated via `npm run build:continuum`.

## 6. Tests / timings

- New `tests/gateway-activation.test.js`: 25 tests covering module shape (no bare nav method),
  `resolveHostTransport` (injected/browser/host/none), the confirmation gate (no-confirm never
  navigates + host untouched; truthy-not-true rejected), the confirmed hop (recording host
  pushState + live browser-window path + safety flags false), consent gate preserved
  (missing grant / empty destination blocked), route restrictions (allowlist reject / no-allowlist
  allow / injected transport only ever sees a `/path`), no-transport + dryRun no-ops, rollback /
  back-home (rolled-back + failed), never-throws, and SDK + debug exposure.
- **Full release gate green:** `npm run test:release` → **861 tests / 61 files passed**,
  regression-check **ALL GREEN (14/14)**, build + bundle advisory + handoff:status all OK.
  Full-suite duration ~39s; `test:fast` ~5s.
- Bundle baseline unchanged: 2.9 MB raw / 1023.5 KB gzip (rapier chunk >700 KB, expected/tracked).

## 7. Commit hash

Feat commit: **`5a6db86`** on branch `v0.2.178` (20 files changed, +773/−85) — lands the module
+ 25 tests + SDK/debug wiring + all version/doc bumps + regenerated continuum. This report is
added in a follow-up docs commit.

## 8. Safety notes

- **No external writes:** no signing, no NIP-07, no relay publish, no private keys, no payments,
  no auto-update. `signed/published/network` pinned false.
- **No external navigation:** same-origin `/path` only; external `targetUrl` never executed; no
  `window.open`/`location.href`/`reload`/`eval`. The window is injected, never reached at module scope.
- **No automatic navigation:** read/preview/render and any unconfirmed path resolve no transport
  and never navigate. Navigation requires a literal `confirmed:true` AND a passing consent grant
  AND (if set) an allowed route.
- **godMode** remains `false`; no new `setTimeout` (rollback is synchronous); no new
  `Vector3/Matrix4` hot-path allocations; debug tools ship unconditionally.
- **Still pre-SEC-2** for any LIVE relay-sourced destination — this slice is local/same-site
  route+history movement only, exactly as scoped.

## 9. Recommended next task

Drive `gatewayActivation` from a **real injected host router**: at the gateway boundary, inject
the live app/browser window (or host transport) + a same-origin route allowlist wired to the page
CSP, so a confirmed in-world hop performs the live navigation — paired with the **in-world gateway
portal mesh** (front-end trigger that surfaces the confirm UX and calls `activateGatewayHandoff`).
That closes LEAN-2's "actually move the player" gap. The signed/relay-mediated travel tier remains
gated behind **SEC-2** (cryptographic verification in `world/handoff.js`).
