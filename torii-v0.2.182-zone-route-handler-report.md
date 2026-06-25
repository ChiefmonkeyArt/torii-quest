# Torii Quest v0.2.182-alpha — SPA `/zone/<slug>` Route Handler

**Slice:** LEAN-2 / GATEWAY-ZONE-ROUTE
**Status:** implemented, committed locally only (NOT pushed/deployed/published)
**Date:** 2026-06-25

---

## 1. Goal

Add a minimal SPA `/zone/<slug>` route handler/fallback so the same-origin gateway
URL state (introduced by the v0.2.168–v0.2.181 handoff/portal seams) has a safe
client-side interpretation and does not become brittle after a hard refresh or
popstate navigation. No network, no relay load, same-origin only.

This is the infra slice that closes the "SPA `/zone/<slug>` route handler
(hard-refresh resolution)" deferred step that the v0.2.181 portalTrigger entry
named as next.

---

## 2. What landed

### New pure module — `src/engine/gateway/zoneRoute.js`

A pure, node-safe (no `window`/DOM/fs/crypto at module scope) route parser:

- Exports `ZONE_ROUTE_VERSION=1`, `ZONE_ROUTE_BADGE`, `ZONE_ROUTE_PREFIX='/zone/'`,
  `ZONE_SLUG_MAX_LEN=64`, `ZONE_ROUTE_KIND={HOME:'home',ZONE:'zone',INVALID:'invalid'}`,
  `DEMO_ZONE_ROUTE='/zone/plebeian-market-bazaar'`.
- `isValidZoneSlug(slug)` — STRICT: lowercase alphanumerics with single internal
  hyphens, no leading/trailing/double hyphen, length 1..64.
- `humanizeZoneSlug(slug)` — safe display label (Title Case from hyphen split).
- `zoneRouteFor(slug)` — builds a same-origin `/zone/<slug>` route string (or `null`
  for an invalid slug).
- `parseZoneRoute(path)` — the core handler. Runs `safeRoutePath` (handoffPlan.js)
  FIRST → `INVALID` on any failure (non-string, empty, >256, scheme,
  protocol-relative `//`, control/markup/backslash/whitespace/`%`, `..` traversal),
  strips `?query`/`#hash`, classifies `HOME` (`/`), `ZONE` (`/zone/<valid-slug>`),
  or `INVALID`. Pins `navigated/performed/external/signed/published/network=false`.
- `describeZoneRoute(path)` — inert render-ready display model (badge, kind, slug,
  label, notice copy).

### App/router seam — `src/main.js` (composition root ONLY)

`_applyZoneRoute()` reads the injected `window.location.pathname` on startup and on
`popstate`, routing a valid `/zone/<slug>` into inert local zone state / a safe
placeholder notice, and leaving an invalid or unknown path on the safe HOME default.
NO network, NO auto-travel, NO relay load. The browser `window` is injected at the
composition root, never reached at module scope.

### Debug + SDK

- `ToriiDebug.shells.zoneRoute(path?)` — read-only inert shell (ships
  unconditionally, godMode=false).
- SDK surface: `zoneRoute` exported at tier EXPERIMENTAL.

### Tests — `tests/zone-route.test.js` (28 tests)

Covers: kind enum shape; slug validation (happy + rejection of upper/space/
double-hyphen/leading-hyphen/overlong); happy path `/zone/plebeian-market-bazaar`;
HOME `/`; hardening (traversal `/zone/../admin`, percent `/zone/%2e%2e/admin`,
protocol-relative `//evil`, scheme `javascript:`/`data:`, markup, whitespace,
overlong, non-string); `describeZoneRoute` display; debug shell; SDK exposure.
Added to the FOUNDATION profile (`tools/testProfiles.mjs`).

---

## 3. Security posture (Request C §3–§4)

- **Same-origin only.** `parseZoneRoute` reuses `safeRoutePath` as the gate, so a
  scheme (`javascript:`/`data:`/`http:`), protocol-relative `//host`, backslash,
  markup, control char, whitespace, `%` percent-encoding, `..` traversal, empty, or
  >256-char path all classify `INVALID` — never `ZONE`.
- **No side effects.** No fetch/network/relay/NIP-07/payments/signing/publishing.
  No browser navigation: parsing a path never moves the player; the seam only sets
  inert local state.
- **No auto relay / auto-update / external nav.** Confirmed by the pinned
  `network:false`/`external:false`/`navigated:false` report flags and by the tests.

---

## 4. Hard-refresh / static-host fallback (documented, NOT faked)

A client-side parser cannot, by itself, make `https://host/zone/<slug>` resolve on a
*cold* hard refresh — the static host must serve `index.html` for unknown deep-link
paths so the SPA boots and `_applyZoneRoute()` can interpret the path. This is a
hosting config, outside repo code, and is documented honestly in **HANDOFF.md §7**
and **GATEWAY_PROTOCOL.md §10**:

- Nginx: `try_files $uri $uri/ /index.html;`
- Caddy: `try_files {path} /index.html`
- CDN: 404 → `/index.html` rewrite

Without it, a hard refresh on a deep link 404s before any JS runs. The app provides
the correct client-side behavior for when `index.html` IS served.

---

## 5. Constraints honored

- Version bumped to **v0.2.182-alpha** everywhere (config.js, package.json,
  index.html ×2, regression-check.mjs EXPECTED + stale-guard, continuumData.js
  CONTINUUM_VERSION, continuum-dashboard.test.js, all continuity docs).
- `godMode=false`; debug tools ship unconditionally.
- No new `setTimeout`; no new `Vector3`/`Matrix4` hot-path allocations (the only
  proximity math reuses the v0.2.180 scalar `withinPortalRange`).
- ESC/panel/cursor/weapon behavior not regressed (seam only adds startup + popstate
  zone-state read).
- Comments use *nostrich*.

---

## 6. Verification

- `npm run test:fast` — green.
- `npm run test:foundation` — green (21 files incl. zone-route.test.js).
- `npm run test:release` (`build && vitest run && check && bundle:report &&
  handoff:status`) — green; full suite **940 passing / 64 files**.
- `node tools/build-continuum.mjs` — "docs in sync".

---

## 7. Docs updated

todo.md, progress.md, HANDOFF.md (§1, gateway narrative, §7 deploy SPA-fallback
block), CODE_INDEX.md (World/NAP row), SDK_DEBUG_INDEX.md (surface + narrative +
shell row), GATEWAY_PROTOCOL.md (§10 zoneRoute entry + static-host fallback note).

---

## 8. Boundaries respected

Committed **locally only**. NOT pushed, deployed, published, or uploaded — the
parent agent verifies/security-reviews/deploys.
