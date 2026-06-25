# Torii Quest v0.2.184-alpha — Portal/Zone State Clarity

**Slice:** LEAN-2 / GATEWAY-ZONE-LABEL — a safe, no-blocker infrastructure/polish slice after
v0.2.183 (the in-world portal MARKER mesh).

**Goal:** make the portal target/state clearer to the player — show where the portal goes when
near it, and a concise inert zone notice after a successful hop — **without changing navigation
safety**.

---

## What shipped

A pure, node-safe label pair plus surgical composition-root wiring. No change to the gateway
safety model, the trigger, the route parser, or any boundary.

### New module — `src/engine/gateway/zoneLabel.js` (PURE / node-safe)

- `portalPromptLabel({slug, route, title, key})` → a **target-aware proximity prompt**:
  `"Press F to travel to Plebeian Market Bazaar"`, falling back to the generic
  `"Press F to travel"` when no target is known.
- `enteredZoneLabel(input, {prefix})` → the **concise post-hop notice**:
  `"Entered: Plebeian Market Bazaar"`, returning `''` for an unknown/empty target.
- Constants: `ZONE_LABEL_VERSION=1`, `ZONE_LABEL_BADGE='ZONE LABEL · DISPLAY-ONLY · INERT'`,
  `DEFAULT_PORTAL_KEY='F'`, `DEFAULT_ENTERED_PREFIX='Entered'`,
  `DEMO_ZONE_LABEL_OPTS={slug:'plebeian-market-bazaar',key:'F'}`.

**Safe-text design.** Both helpers DERIVE their human text from the safe slug via the v0.2.182
`humanizeZoneSlug` (alnum by construction). The internal `_titleFrom` strips the
`ZONE_ROUTE_PREFIX`; any non-slug / free-form / hostile string is run through `_safeTitle`, an
allowlist sanitiser (`[A-Za-z0-9 -]` only, whitespace collapsed, capped at 80 chars). No markup
or dangerous token can survive — even though the HUD sink is `textContent` (defense in depth).

### Wiring — `src/main.js` (composition root ONLY)

- The `createPortalTrigger` `promptText` is now `portalPromptLabel({slug:'plebeian-market-bazaar'})`
  (uses the existing trigger `promptText` param — no trigger change).
- The KeyF handler shows `showZoneNotice(enteredZoneLabel(rep.zoneId))` **only** when the v0.2.180
  `confirm()` report returns `navigated:true` with a string `zoneId`.

**Why the KeyF path:** a confirmed hop changes the URL via `history.pushState`, which does **not**
fire `popstate`, so the existing `_applyZoneRoute()` (bound to startup + popstate only) never
refreshed the zone notice after an in-world hop. Showing the entered-notice directly on the
`navigated:true` report closes that clarity gap.

### Discoverability

- SDK: `export * as zoneLabel` + `SDK_SURFACE.zoneLabel` at the `EXPERIMENTAL` tier.
- Debug shell: `ToriiDebug.shells.zoneLabel(opts?)` via `zoneLabelReport(opts?)` in
  `shellReport.js` — returns label previews + a `safe` flag proving hostile input is stripped, and
  the inert flags (`navigated/performed/external/signed/published/network/actionable` all false).

---

## Safety / constraints (all preserved)

- **No** network, relay, signing, external navigation, payments, auto-update, or confirmation
  bypass added. Proximity still ONLY arms; KeyF confirms; route stays same-origin `/zone/` only;
  allowlist hard-scoped `['/zone/']`.
- HUD sink is `textContent` only (`showZoneNotice`/`showPortalPrompt`) — never `innerHTML`.
- No unsafe HTML; no literal dangerous doc tokens (`javascript:` / `window.location` /
  `location.href` / `eval(` / `window.open`) introduced into any continuum-rendered prose. The
  regenerated `public/continuum.html` greps clean (0 matches).
- `godMode=false`; no new `setTimeout` (allowlist `nostr.js`/`hud.js` unchanged); no new
  `Vector3`/`Matrix4` hot-path allocations (zoneLabel is string-only, pure).
- Debug tools ship unconditionally; ESC/panel/cursor/weapon behavior not touched. The existing
  `portal-trigger.test.js` (which exercises the default `PORTAL_PROMPT_TEXT` with no override) is
  unaffected by the composition-root `promptText` override.
- Comments use the project's house term.

## Version bump (v0.2.183-alpha → v0.2.184-alpha)

`src/config.js` VERSION, `package.json` version (`0.2.184-alpha`), `index.html` (×2 markers),
`tools/regression-check.mjs` (header, `EXPECTED_VERSION`, stale-guard now flags v0.2.183),
`continuumData.js` (`CONTINUUM_VERSION`, totals `973 passing`, source/tests rows, active slice,
activeNow/completed24h), and the continuity/advisory docs below.

## Tests

- **New:** `tests/zone-label.test.js` — **15 tests** (module shape; `portalPromptLabel`
  slug/route/generic/custom-key + no-throw + no-dangerous-output; `enteredZoneLabel`
  slug/route/custom-prefix/empty/hostile-sanitised/adversarial; `zoneLabelReport` labels + `safe`
  flag + inert flags; SDK exposure + `EXPERIMENTAL` tier). Added to the FOUNDATION profile
  (`tools/testProfiles.mjs`).
- Suite total: **973 passing / 66 files** (was 958 / 65). Foundation profile: 23 files.

## Docs updated

`todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`,
`GATEWAY_PROTOCOL.md` (§10). Continuum regenerated (`docs in sync`, no DRIFT; XSS guard clean).

## Remaining (documented, unchanged from prior slices)

- Static-host SPA rewrite for `/zone/*` hard-refresh (deployment/infra step).
- Signed/relay-mediated SEC-2 tier stays gated and not live.

## Commit

Local only. No push / deploy / publish / upload — the parent agent verifies, security-reviews,
and ships.
