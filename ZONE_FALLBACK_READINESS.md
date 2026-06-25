# torii.quest `/zone/*` SPA Fallback — Deployment Readiness Checklist

> **Status:** documentation + a pure local CHECK only (v0.2.185-alpha). **No code in this
> repo touches a server, performs a deploy, or changes app runtime behaviour.** This page
> makes the one outstanding hosting prerequisite for the gateway travel feature —
> *serve `index.html` for any `/zone/<slug>` path* — explicit and locally checkable BEFORE a
> maintainer publishes the static `dist/` bundle to `torii.quest` (or any static host).
>
> See also: `HANDOFF.md` §7 (the SPA-rewrite note), `VPS_INSTALL.md` §6a/§6b/§11 (the
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

This is the only thing standing between the shipped client-side route support and a
deep-link-able `/zone/<slug>`. It is a no-runtime, no-deploy readiness item.

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

- [ ] **Docs carry the requirement.** `VPS_INSTALL.md` and `HANDOFF.md` both describe the
      `index.html` SPA fallback for `/zone/*`. *(checked: `npm run zones:check`)*
- [ ] **Built bundle has an entry document.** `dist/index.html` exists for the fallback to
      serve. *(checked: `npm run zones:check` after `npm run build`)*
- [ ] **Nothing shadows the fallback.** No static file is published under `dist/zone/*` (a
      real file there would be served instead of `index.html`, defeating the fallback).
      *(checked: `npm run zones:check`)*
- [ ] **Host fallback configured.** The chosen host (Caddy/Nginx/CDN) serves `index.html`
      for unmatched paths — confirmed on the host itself (manual; outside this repo).
- [ ] **CSP unchanged.** The fallback is a routing rule only; no `script-src`/`style-src`
      change. (The app CSP lives in `index.html`; the continuum dashboard CSP is enforced
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

1. a required doc (`VPS_INSTALL.md` / `HANDOFF.md`) does not describe the `index.html`
   SPA fallback, or
2. a built `dist/` has no `index.html`, or
3. a static file is published under `dist/zone/*` that would shadow the fallback.

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
- **No client-side workaround for the cold deep-link.** Hard-refresh resolution is a hosting
  concern by definition; the app cannot serve its own entry document on a 404.
