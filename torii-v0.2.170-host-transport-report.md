# Torii Quest — v0.2.170-alpha · Same-origin gateway HOST TRANSPORT adapter

## Summary

v0.2.170-alpha adds the **same-origin host transport adapter** the v0.2.168
executor drives: `src/engine/gateway/hostTransport.js`. It builds the `transport`
object that `handoffExecute.executeHandoff(plan, transport)` consumes —
`{ navigate, snapshot, rollback, log }` — from an **injected** host, so the module
itself never touches `window` / `history` / `location` and stays pure/node-safe.

Route handling is **same-origin only**: `navigate`/`rollback` re-validate every
route with `safeRoutePath` (the v0.2.167 validator) as defense in depth, so an
external URL, a protocol-relative `//host` route, a `javascript:`/`data:` scheme,
markup, whitespace, or control chars is rejected before anything reaches the host.
Rollback / back-home escape is a single synchronous call (no timers). With no usable
host the factory returns `null`, so the executor safely NO-OPs.

The real browser wiring is provided as a clearly-marked, **not-yet-wired** seam
(`createBrowserHostTransport(window)`) built over `history.pushState`/`replaceState`
only; hooking it into `world/handoff.js` remains the deferred next step.

## Gateway travel chain (foundation, all node-safe)

```
gatewayRead (v0.2.164)  →  travelConfirm (v0.2.165, prepareTravelIntent)
  →  consentView (v0.2.166)  →  handoffPlan (v0.2.167, dry-run plan)
    →  handoffExecute (v0.2.168, executor)
      →  hostTransport (v0.2.170, same-origin transport adapter)   ← THIS SLICE
```

## What shipped

### New module — `src/engine/gateway/hostTransport.js` (pure, node-safe)

Imports only `safeRoutePath` from `handoffPlan.js`. Exports:

- `HOST_TRANSPORT_VERSION = 1`
- `HOST_TRANSPORT_BADGE = 'TRANSPORT · SAME-ORIGIN · HISTORY-PUSHSTATE'`
- `isRouteHost(host)` — true for a bare callable or an object exposing a `pushState`
  function (pure, never throws).
- `createHostTransport(host, opts={})` — normalises the host into bound
  `push`/`replace`/`read` thunks and returns an executor-compatible
  `{ navigate, snapshot, rollback, log }`, or **`null`** when there is no usable host
  (→ executor NO-OPs). `opts = { home?, onLog? }`.
  - `navigate(route)` — re-validate via `safeRoutePath`; push ONLY a safe same-origin
    path; an unsafe route is logged + returns `false` (never throws), so the executor
    treats it as a navigation failure and rolls back.
  - `snapshot()` — record the current route (`host.read`, sanitised) or `home`; this
    is the back-home escape target.
  - `rollback(route?)` — replace to a safe `route` / the snapshot / `home`;
    `rollback()` with no arg is the back-home escape. One synchronous call, no timers.
  - `log(entry)` — best-effort sink (`opts.onLog`); a throw never breaks execution.
- `createRecordingHost(initialRoute='/')` — DEFAULT-SAFE in-memory host: records every
  `pushState`/`replaceState` call in `host.calls` and updates `host.route`, performing
  NO real navigation. Used by the debug shell + tests so an "acting" run is inert.
- `createBrowserHostTransport(win, opts={})` — the REAL runtime SEAM: returns `null`
  without `win.history.pushState`, otherwise builds a host over ONLY
  `win.history.pushState`/`replaceState` + `win.location.pathname+search` (NO
  reload/href/open) and hands it to `createHostTransport`. NOT invoked anywhere at
  import time; wiring it into the live app is the next, separately-reviewed step.

Browser APIs are fully isolated behind the injected host; the module exposes NO bare
`navigate`/`open`/`reload`/`goto`/`assign`/`href`/`pushState`/`replaceState` method at
module scope.

### Tests — `tests/host-transport.test.js` (21 tests)

Covers: module shape (version/badge present; no bare-navigation method exported at
module scope); `isRouteHost`; `createHostTransport` returns `null` for an unusable
host AND the executor NO-OPs for a missing host; same-origin navigation through a
recording host + a full executor run (`host.calls.pushState === ['/zone/nap-garden']`)
+ a bare-callback host; route rejection (external URLs, protocol-relative `//host`,
unsafe paths) → `navigate` returns false, host untouched; snapshot/rollback/back-home
(`rollback()` returns to snapshot, falls back to home; executor rolls back via the
host when navigate throws → `replaceState === ['/home']`); safety flags stay false; a
source scan (comment lines stripped first) asserting the code contains no
`setTimeout`/`fetch`/`WebSocket`/`location.href`/`window.open`/`.reload(`/`sign(`/
`publish`; `createBrowserHostTransport` (null without a window, builds over a fake
window using pushState/replaceState, still rejects external routes); SDK exposure
(`SDK.hostTransport.createHostTransport`, `SDK_SURFACE.hostTransport.tier ===
EXPERIMENTAL`).

### Wiring

- `src/sdk/index.js` — `export * as hostTransport` + `SDK_SURFACE.hostTransport`
  at the `EXPERIMENTAL` tier.
- `src/engine/debug/shellReport.js` — `hostTransportReport(...)` added to
  `buildShellReport` (builds a recording host, plans then executes — records calls but
  never navigates the live app). The 4-surface `shellsSummary` list NOT touched.
- `src/engine/debug/toriiDebug.js` —
  `shells.hostTransport(input?, grant?, opts?)`.

### Version bump (v0.2.169-alpha → v0.2.170-alpha)

`src/config.js`, `package.json`, `index.html` (×2), `tools/regression-check.mjs`
(header + `EXPECTED_VERSION` + stale-guard now flags v0.2.169-alpha).

### Docs

`todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`,
`GATEWAY_PROTOCOL.md`, and this report.

## Safety / constraint compliance

- godMode remains `false` — never deployed true.
- No new `setTimeout` (rollback/back-home is a single synchronous call — no timers).
- No new `Vector3`/`Matrix4` in hot paths (module is pure data + injected thunks).
- No external/browser navigation, live network writes, signing, NIP-07, key handling,
  payments, auto-update, world reload, or irreversible actions — every browser
  primitive is injected; the runtime seam uses only `history.pushState`/`replaceState`
  and is not wired in.
- Same-origin only: routes re-validated with `safeRoutePath`; external/protocol-
  relative/unsafe rejected.
- Comments use "nostrich"; "Chiefmonkey" spelling untouched.
- Debug tools ship unconditionally; the debug shell acts through an in-memory
  recording host (no real navigation).
- ESC pause / panel-locked cursor behaviour untouched (no main-loop/input changes).
- No gameplay/shooter-feel changes.

## Verification

- `npm test -- --run`: **757 passed / 57 files** (+21 new in `host-transport.test.js`).
- `npm run check`: **ALL GREEN** — version markers v0.2.170-alpha, dist markers present,
  proof-surface gate ok (4 bound, 2 groups), continuity docs reference v0.2.170-alpha
  (5 docs).
- `npm run bundle:report`: total JS 2.9 MB raw / 1017.7 KB gzip (app 157.1 KB, three
  609.1 KB, rapier 2.1 MB). Advisory only: rapier chunk over 700 KB (expected, tracked).
- `npm run handoff:status`: VERSION v0.2.170-alpha, package.json in sync, core docs 7/7.
- `npm run build`: built in ~5.2s, no errors (large-rapier-chunk advisory only).

## Commit

Branch `v0.2.170` off the v0.2.169 HEAD; committed locally only. NOT pushed /
deployed / published — parent agent will verify / security-review / deploy / push /
publish.

Commit: `<FILL>` on branch `v0.2.170` (off `d4480a5`, the v0.2.169 HEAD).
