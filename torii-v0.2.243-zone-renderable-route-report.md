# Torii Quest — v0.2.243-alpha Zone Renderable-Route Repair Report

**Slice:** v0.2.243-alpha · **Scope:** static-host cold deep-link for `/zone/<slug>` must
*render* in a real browser (not download, not JSON-404) · **No backend, no deploy, no push.**

---

## 1. Root cause

v0.2.242 fixed the JSON-404 by writing a real file at the EXACT extensionless path
`dist/zone/plebeian-market-bazaar`. A plain `fetch` then returned the Torii Quest HTML, so the
404 was gone. But an interactive Playwright `page.goto('…/zone/plebeian-market-bazaar')`
reported **`Download is starting`**.

The live static host (`torii-quest.pplx.app`) infers `Content-Type` from the file
**extension**. An *extensionless* file has no extension to map, so it is served as
`application/octet-stream`. A real browser treats `octet-stream` on a top-level navigation as a
**download**, not a document — hence "Download is starting" and no app shell. So v0.2.242 made
the path exist but not *render*: insufficient for a real-browser hard refresh.

**Key observation that unlocks the fix:** the host DOES perform directory-index resolution for a
**trailing-slash** URL — the same resolution that already serves the root `/` from
`dist/index.html`. A file ending in `.html` is served as `text/html`, which renders.

---

## 2. Decision

Adopt the **trailing-slash directory-index** route as canonical (no backend, no content-type
control needed):

- **Canonical zone route is now `/zone/<slug>/`** (trailing slash). `zoneRouteFor` and
  `handoffRouteFor` generate this form; the portal hop pushes it via `host.pushState`.
- **Shell artifact is `dist/zone/<slug>/index.html`** (directory-index), byte-identical to
  `dist/index.html`. The host resolves `/zone/<slug>/` → that nested `.html` → served as
  renderable `text/html`. Root-absolute asset URLs (`/assets/…`) load the same bundle; the app
  boots and `_applyZoneRoute()` parses the slug exactly as on an in-app portal hop.
- **Parser accepts BOTH** `/zone/<slug>` and `/zone/<slug>/`, normalising its route output to
  the canonical trailing slash. So a cold no-slash hit still resolves client-side once the
  bundle loads; it stays harmless.
- The directory-index file **replaces** the v0.2.242 extensionless file (a file and a directory
  cannot share one name). The guard/tests assert the directory-index shell exists and NO bare
  extensionless file is left behind.

**Residual risk (documented, unverifiable locally):** a COLD no-slash `/zone/<slug>` hit (no
trailing slash, before the bundle loads) still depends on host default behaviour and its
served `Content-Type` cannot be checked from the local filesystem. The canonical route the app
generates and navigates to is the trailing-slash form, which IS renderable. Confirm the
canonical `/zone/<slug>/` URL renders via a live re-smoke after publish.

---

## 3. Files changed

**App (route value only; route *shape*/version unchanged):**
- `src/engine/gateway/zoneRoute.js` — `zoneRouteFor` → `/zone/<slug>/`; `parseZoneRoute`
  strips one trailing slash and accepts both forms; `DEMO_ZONE_ROUTE` → trailing slash;
  `DEPLOYABLE_ZONE_SLUGS` comment → directory-index/text-html rationale.
- `src/engine/gateway/handoffPlan.js` — `handoffRouteFor` → `/zone/<slug>/`.
- `src/engine/gateway/zoneLabel.js` — `_titleFrom` strips a trailing slash before validating.

**Tools / build / guards:**
- `tools/zoneShells.mjs` — `zoneShellPathFor` → `zone/<slug>/index.html`; `zoneShellRouteFor`
  → `/zone/<slug>/`.
- `tools/generate-zone-shells.mjs` — writes `dist/zone/<slug>/index.html` (header rewritten).
- `tools/zoneFallbackReadiness.mjs` — `ZONE_SHELL_RE` → `/zone/<slug>/index.html`;
  `isVerifiedZoneShell` allows only that form byte-identical to `dist/index.html`.
- `tools/zone-fallback-check.mjs`, `tools/build-continuum.mjs`, `tools/regression-check.mjs`
  ([15] guard + `EXPECTED_VERSION='v0.2.243-alpha'`) — regexes reconciled to directory-index.

**Status / docs:**
- `src/config.js`, `package.json`, `public/sw.js`, `MVP_APPROVAL_STATE.json`, `index.html`
  (×2) — version → v0.2.243-alpha.
- `src/engine/dashboard/continuumData.js`, `src/engine/status/mvpReadiness.js` — version +
  `CURRENT_TEST_STATUS`/`DEFAULT_TEST_STATUS` → 1688 passing / 102 files; active-slice prose.
- `HANDOFF.md`, `todo.md` (HARD-57), `progress.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`,
  `ZONE_FALLBACK_READINESS.md` (§1, §3, §4, §5, §7 + v0.2.243 update block) — converted to the
  trailing-slash directory-index strategy.
- `NEXT_ACTION_STATE.json` — regenerated.

**Tests:** `tests/zone-route.test.js` (+3 cases: canonical trailing-slash describe block),
`tests/handoff-plan.test.js`, `tests/handoff-execute.test.js`,
`tests/gateway-activation.test.js`, `tests/gateway-portal-activation.test.js`,
`tests/portal-trigger.test.js`, `tests/host-transport.test.js`,
`tests/zone-hard-refresh.test.js` (planner → directory-index path + route; built-dist asserts
`dist/zone/<slug>/index.html` byte-identical, NO bare file), `tests/zone-fallback-readiness.test.js`
(allows `/zone/<slug>/index.html`, rejects v0.2.242 bare form), `tests/continuum-dashboard.test.js`
(version pins). `safeRoutePath` generic-sanitiser assertions left unchanged (input=output).

---

## 4. Tests & verification

- `npm run build` → emits `[zone-shells] wrote zone/plebeian-market-bazaar/index.html`.
- Artifact: `dist/zone/plebeian-market-bazaar/index.html` exists, **byte-identical** to
  `dist/index.html` (`cmp` clean); NO bare extensionless `dist/zone/plebeian-market-bazaar`.
- `npm run test:release` → **Test Files 102 passed (102) · Tests 1688 passed (1688)**;
  `npm run check` **ALL GREEN** (incl. [15] zone-fallback directory-index guard and the docs
  version guard for v0.2.243-alpha); bundle advisory only (rapier chunk, tracked/not gated);
  handoff:status confirms config/package version in sync.

**Constraints honoured:** version bumped; `godMode` false; no new `setTimeout` (only existing
nostr.js WS-close + hud.js kill-feed); no new hot-path `Vector3`/`Matrix4`; debug tools ship
unconditionally; ESC pause unchanged; panel-locked cursor click never fires weapon; no backend;
v0.2.240 service-worker fail-soft gateway intact; root `/` entry flow + ENTER ARENA preserved.
No deploy / publish / push performed.

---

## 5. Verdict

**SHIP** — the canonical zone route now renders in a real browser via the trailing-slash
directory-index shell (`text/html`), the full release gate is green (1688/102, check ALL
GREEN), and the artifact is verified byte-identical with no shadowing file. One residual,
locally-unverifiable item remains: the COLD no-slash `/zone/<slug>` content-type depends on
host default — **confirm the canonical `/zone/plebeian-market-bazaar/` URL renders via a live
re-smoke after the maintainer publishes the new `dist/`.**
