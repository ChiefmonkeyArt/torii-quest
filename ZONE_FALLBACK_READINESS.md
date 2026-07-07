# torii.quest `/zone/*` SPA Fallback — Deployment Readiness Checklist

> **Status:** documentation + a pure local CHECK only (v0.2.244-alpha). **No code in this
> repo touches a server, performs a deploy, or changes app runtime behaviour.** This page
> makes the one outstanding hosting prerequisite for the gateway travel feature —
> *serve `index.html` for any `/zone/<slug>` path* — explicit and locally checkable BEFORE a
> maintainer publishes the static `dist/` bundle to `torii.quest` (or any static host).
>
> **v0.2.243 update — trailing-slash directory-index shell (renderable).** The live host
> (`torii-quest.pplx.app`) serves by EXACT path with NO SPA rewrite and NO backend, so a
> host-level `try_files … /index.html` rule (§2) is NOT available there. The v0.2.242
> EXTENSIONLESS file `dist/zone/<slug>` made the exact no-slash URL return bytes, but the host
> infers Content-Type from file EXTENSION, so it served the extensionless file as
> `application/octet-stream` — a real browser DOWNLOADED it (Playwright: "Download is
> starting") instead of rendering. The host DOES, however, do **directory-index resolution**
> for a TRAILING-SLASH URL (the same resolution that serves root `/` from `index.html`). So
> v0.2.243 ships a **byte-identical directory-index shell** at `dist/zone/<slug>/index.html`
> for every `DEPLOYABLE_ZONE_SLUGS` entry (see §7): the canonical trailing-slash route
> `/zone/<slug>/` resolves to that nested `.html` file and is served as renderable
> `text/html`. The canonical generated + navigated route is now the trailing-slash form
> (`zoneRouteFor` / `handoffRouteFor`), and the parser accepts BOTH `/zone/<slug>` and
> `/zone/<slug>/` (normalising to the canonical trailing slash). NOTE: a file
> `dist/zone/<slug>` and a directory `dist/zone/<slug>/` cannot coexist under one name, so the
> directory-index shell REPLACES the v0.2.242 extensionless file. These verified shells are an
> intentional, allowed exception to the "nothing shadows the fallback" rule below — the guard
> distinguishes a byte-identical `/zone/<slug>/index.html` shell from a rogue `/zone/*` file.
> RESIDUAL RISK: a COLD no-slash `/zone/<slug>` hit (no trailing slash) still depends on host
> default behaviour and is unverifiable locally — confirm via a live re-smoke after publish.
>
> **v0.2.244 update — canonical route is now the URL FRAGMENT `/#/zone/<slug>` (no shell on
> pplx.app).** The live rendered screenshot of `/zone/plebeian-market-bazaar/` STILL showed the
> JSON 404, confirming the published host (`torii-quest.pplx.app`) normalises BOTH `/zone/<slug>`
> AND `/zone/<slug>/` to an exact static-asset lookup with no directory index — so the v0.2.243
> directory-index shell 404d too and EVERY `/zone/*` PATH strategy is non-viable on this host.
> Only the root `/` reliably serves `index.html` as `text/html`. v0.2.244 therefore moves the
> zone into the URL FRAGMENT: the canonical route is `/#/zone/<slug>`, whose request path is
> always `/` (the fragment is never sent to the server), so the root shell always renders on a
> hard refresh and the client parser reads the fragment. **No per-slug static shell is generated
> any more** — the build step and `tools/zoneShells.mjs` / `tools/generate-zone-shells.mjs` were
> removed, and the dist ships NO `/zone/*` file (so §7 below is historical). The legacy
> `/zone/<slug>` path still PARSES client-side (normalised to the canonical hash route) but is
> NON-CANONICAL on pplx.app — never generate/share it as a cold deep-link, because it 404s before
> the bundle loads. The `index.html` SPA-fallback documented below remains the right model for any
> non-pplx host that supports a `try_files … /index.html` rewrite, and is kept for that case.
>
> See also: `torii-quest-handoff.md` §7 (the SPA-rewrite note), `VPS_INSTALL.md` §6a/§6b/§11 (the
> concrete Caddy/Nginx config), `GATEWAY_PROTOCOL.md`, and `UPDATE_CHECK.md` §4 (the
> manual/no-auto-update boundary this slice does not relax).

---

## 1. Why this exists

The game is a single-page app served from one `index.html`. Since **v0.2.182** the pure
`zoneRoute` parser gives a same-origin `/zone/<slug>` URL a safe client-side interpretation
(the inert zone notice), and the **v0.2.181** portal hop pushes that URL with
`history.pushState`. That fully covers *in-app* navigation.

It does **not** cover a **cold hard-refresh or shared deep-link** to `/zone/<slug>`. On a
cold hit the static host looks for a file at that path, finds none, and returns its 404 —
the JS bundle never loads, so the parser never runs. The fix is a host-level **SPA
fallback**: serve `index.html` for any unmatched path. This is a *hosting-config*
requirement that lives OUTSIDE the app bundle; it is documented here and checked by tooling,
**never faked in app code**.

There are two ways to satisfy the cold hit, and the repo now ships BOTH where applicable:

1. **Host-level SPA fallback** (`try_files … /index.html`) on a host that supports rewrites
   (self-hosted Caddy/Nginx, §2). Preferred when available.
2. **Static per-zone shells** (v0.2.243) for an exact-path host with no rewrite capability
   (the live `torii-quest.pplx.app`). The build copies `dist/index.html` byte-for-byte to the
   directory-index file `dist/zone/<slug>/index.html` for every `DEPLOYABLE_ZONE_SLUGS` entry,
   so the canonical trailing-slash URL `/zone/<slug>/` resolves to that nested `.html` file via
   directory-index resolution and is served as renderable `text/html`. `dist/index.html` uses
   root-absolute asset URLs (`/assets/…`), so the shell at a sub-path loads the same bundle.
   See §7.

It is a no-runtime, no-deploy readiness item either way: the static shells are generated at
build time and the app's client-side `_applyZoneRoute()` resolves the slug exactly as on an
in-app portal hop once the shell loads.

---

## 2. The fallback, by host (EXAMPLES — not a deployed config)

These are **illustrative examples**, not evidence that any server has been configured. No
host in this repo is touched. Keep the existing CSP unchanged; the fallback only affects
path routing, never script/style policy.

- **Nginx:** `location / { try_files $uri $uri/ /index.html; }`
- **Caddy:** `try_files {path} /index.html` (with `file_server`).
- **Static CDN / object storage:** set the SPA / 404 **fallback document** to `index.html`.

The full server blocks live in `VPS_INSTALL.md` §6a (Caddy) and §6b (Nginx); both already
contain the `try_files … /index.html` line.

---

## 3. Pre-publish checklist

Run through this before lifting a new `dist/` to `torii.quest`. None of it requires server
access; the automated parts are a single local command (§4).

- [ ] **Docs carry the requirement.** `VPS_INSTALL.md` and `torii-quest-handoff.md` both describe the
      `index.html` SPA fallback for `/zone/*`. *(checked: `npm run zones:check`)*
- [ ] **Built bundle has an entry document.** `dist/index.html` exists for the fallback to
      serve. *(checked: `npm run zones:check` after `npm run build`)*
- [ ] **Nothing shadows the fallback (except verified shells).** No static file is published
      under `dist/zone/*` EXCEPT the byte-identical per-zone shells the build generates at the
      directory-index path `dist/zone/<slug>/index.html` for each `DEPLOYABLE_ZONE_SLUGS` entry.
      A verified shell (path matches `/zone/<slug>/index.html` AND content is byte-identical to
      `dist/index.html`) is ALLOWED; any other `/zone/*` file still fails the guard.
      *(checked: `npm run zones:check`)*
- [ ] **Host fallback configured.** The chosen host (Caddy/Nginx/CDN) serves `index.html`
      for unmatched paths — confirmed on the host itself (manual; outside this repo).
- [ ] **CSP unchanged.** The fallback is a routing rule only; no `script-src`/`style-src`
      change. (The app CSP lives in `index.html`; the torii-quest dashboard CSP is enforced
      separately and unit-tested.)
- [ ] **Manual smoke after publish.** Hard-refresh `https://<host>/zone/plebeian-market-bazaar`
      and confirm the app loads and shows the inert zone notice (not a host 404).

---

## 4. The local check (`npm run zones:check`)

A pure, **read-only, network-free** Node script verifies the repo-side parts of the
checklist without a server:

```bash
npm run zones:check        # docs guard always; dist route-shape guard if dist/ exists
npm run build && npm run zones:check   # include the built-bundle route-shape check
```

It exits non-zero (FAIL) when:

1. a required doc (`VPS_INSTALL.md` / `torii-quest-handoff.md`) does not describe the `index.html`
   SPA fallback, or
2. a built `dist/` has no `index.html`, or
3. a static file is published under `dist/zone/*` that would shadow the fallback — EXCEPT a
   verified byte-identical per-zone directory-index shell (`dist/zone/<slug>/index.html` equal
   to `dist/index.html`), which is the v0.2.243 trailing-slash directory-index static-host
   workaround and is allowed.

The same checks run inside `npm run check` (regression-check **[15]**), so the release gate
(`npm run test:release`) enforces them too. The pure logic is in
`tools/zoneFallbackReadiness.mjs` and is unit-tested by `tests/zone-fallback-readiness.test.js`.

---

## 5. Non-goals (explicitly out of scope)

- **No server access.** No SSH, no credentials, no VPS provisioning, no live config write.
  The §2 server blocks are EXAMPLES; configuring the real host is a manual maintainer step.
- **No deploy / publish / upload.** This slice ships docs + a local check only.
- **No auto-update.** The torii.quest update-check remains read-only and `actionable:false`
  (`UPDATE_CHECK.md` §4); nothing here lets the app or a visitor trigger a rebuild.
- **No runtime/navigation change.** The gateway safety model is untouched — proximity ARMs,
  KeyF CONFIRMs, the route stays same-origin `/zone/` only, allowlist hard-scoped
  `['/zone/']`. This document changes nothing the app does at runtime.
- **No backend / server runtime.** The v0.2.243 fix is a BUILD-TIME static-shell copy, not a
  server. It adds no API, no route handler, and no live process; it only writes extra
  byte-identical app-shell files into `dist/` (at the directory-index path
  `dist/zone/<slug>/index.html`) so an exact-path host resolves the canonical trailing-slash
  deep-link via directory-index resolution, without a rewrite rule. (Before v0.2.241 this
  section read "no client-side workaround" — the static-shell approach is a build/static-file
  workaround, not app code serving its own 404, so that constraint is preserved in spirit.)

---

## 6. The end-to-end smoke harness (v0.2.197)

The `npm run zones:check` guard (§4) enforces the fallback contract at build time. v0.2.197 adds a
pure, node-safe **host route + asset smoke harness** that pins the SAME contracts — plus the root
index, the `DIST_SPEC` artifacts, the `/continuum.html` dashboard asset, and the
`release-metadata.json` update asset — end-to-end in ONE fail-fast report, so the static-host route
path for torii.quest can be regression-checked alongside the rest of the test suite.

`src/engine/host/hostRouteSmoke.js` (read-only at `ToriiDebug.shells.hostRouteSmoke()`, SDK
`hostRouteSmoke`, covered by `tests/host-route-smoke.test.js`) composes the already-shipped pure
readiness helpers used by this checklist — `checkFallbackDocs` / `checkDistRoutes` /
`zonePathsInDist` from `tools/zoneFallbackReadiness.mjs`, the v0.2.182 `/zone/<slug>` route parser,
and the v0.2.192 release-metadata guards — over frozen LOCAL fixtures. It re-asserts the central
division of labour this document describes: **the host serves `index.html` for an unknown
`/zone/<slug>` (it is NOT a built file), and the app's route parser is what keeps each slug safe
once the page loads** — a valid slug parses to a `ZONE` route while the whole hostile-path fixture
(absolute scheme / protocol-relative / dot-dot / sub-path / uppercase+underscore / empty slug /
percent-encoding / `javascript:`) is rejected as INVALID, and no built file is allowed to shadow
the fallback.

Same non-goals as §5: it touches no server/DNS/SSH/remote command/network, serves/deploys nothing,
changes nothing at runtime — every report pins
`served/deployed/navigated/performed/external/network/wrote/fetched = false`. The full host-side
contract narrative lives in `VPS_INSTALL.md` §15.

---

## 7. Static per-zone shells (v0.2.243) — the trailing-slash directory-index workaround

The live host `torii-quest.pplx.app` serves by EXACT path with NO SPA rewrite and NO backend.
v0.2.242 made the exact no-slash URL `/zone/<slug>` a real file by writing an EXTENSIONLESS
shell at `dist/zone/<slug>`. That removed the JSON 404, but the host infers `Content-Type` from
the file EXTENSION, so the extensionless file was served as `application/octet-stream`: a real
browser DOWNLOADED it (Playwright reported "Download is starting") instead of rendering it. So
v0.2.242 was not sufficient for a real-browser hard refresh.

**Why the directory-index form renders.** The host DOES perform directory-index resolution for
a TRAILING-SLASH URL — the same resolution that already serves the root `/` from
`dist/index.html`. So v0.2.243 writes the shell at `dist/zone/<slug>/index.html`: the canonical
trailing-slash route `/zone/<slug>/` resolves to that nested `.html` file, the host infers
`text/html` from the `.html` extension, and the browser RENDERS it. The canonical generated +
navigated route is therefore the trailing-slash form, and the parser accepts BOTH `/zone/<slug>`
and `/zone/<slug>/` (normalising its output to the canonical trailing slash).

**The build generates a byte-identical directory-index shell.** `npm run build` runs
`node tools/generate-zone-shells.mjs` after `vite build`; it reads the freshly built
`dist/index.html` and writes a byte-identical copy to `dist/zone/<slug>/index.html` for every
`DEPLOYABLE_ZONE_SLUGS` entry (currently `plebeian-market-bazaar`). Because `dist/index.html`
references its bundle with root-absolute URLs (`/assets/…`), the shell at the sub-path loads the
same JS/CSS; the app boots, `_applyZoneRoute()` reads `window.location.pathname`, parses the
slug, and shows the inert zone notice — identical to an in-app portal hop.

**File-vs-directory note.** A regular file `dist/zone/<slug>` and a directory
`dist/zone/<slug>/` cannot coexist under one name on a filesystem, so the v0.2.243
directory-index shell REPLACES the v0.2.242 extensionless file — they are mutually exclusive.
The generator writes the directory-index form; the guard/tests assert
`dist/zone/<slug>/index.html` exists and that NO bare extensionless file is left behind.

**Residual risk.** A COLD no-slash hit `/zone/<slug>` (no trailing slash) still depends on host
default behaviour and cannot be verified locally. The trailing-slash canonical route is the one
the app generates and navigates to; the no-slash form remains harmless (the parser normalises it
once the bundle loads) but its cold-hit `Content-Type` is host-dependent — confirm the canonical
trailing-slash URL renders via a live re-smoke after publish.

**Single source of truth + safety:**

- `DEPLOYABLE_ZONE_SLUGS` (frozen, `src/engine/gateway/zoneRoute.js`) is the one list of slugs
  that get a shell; every entry is a valid, parseable `/zone/<slug>/` route.
- `tools/zoneShells.mjs` (pure) plans the shell paths: `zoneShellPathFor(slug)` →
  `zone/<slug>/index.html` (or `null` for an invalid slug — never an unsafe path),
  `planZoneShells(slugs)` de-dupes and flags invalid/duplicate slugs and never throws.
- `tools/generate-zone-shells.mjs` is the only fs writer; it reads `dist/index.html` and
  writes into `dist/` only (exits 1 if no build is present).
- The readiness guard (`tools/zoneFallbackReadiness.mjs` → `isVerifiedZoneShell`) ALLOWS a
  shell ONLY when its path matches `/zone/<slug>/index.html` AND its content is byte-identical
  to `dist/index.html`; any non-identical or non-shell `/zone/*` file (including the old
  v0.2.242 bare extensionless `/zone/<slug>` form) still FAILS.
- `tests/zone-hard-refresh.test.js` locks the slug list, the pure planner (directory-index path
  `/zone/<slug>/index.html` + canonical route `/zone/<slug>/`), and (when a build is present)
  that every planned shell exists as a real file byte-identical to `dist/index.html` with NO
  bare extensionless file left behind.

To add a new deep-linkable zone, add its slug to `DEPLOYABLE_ZONE_SLUGS` and rebuild — the
shell is generated automatically and the guard/tests cover it.
