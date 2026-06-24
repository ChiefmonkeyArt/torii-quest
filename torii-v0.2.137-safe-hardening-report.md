# Torii Quest — v0.2.137-alpha Safe-Hardening Report

## 1. Summary

v0.2.137 addresses the security/handoff-review warnings raised against the
v0.2.136 shell infrastructure **without changing any gameplay risk**. Four
low-risk items landed, all pure/node-safe or HTML/CSS-only, all SEC gates intact:

1. **HARD-1 — package/runtime version drift fixed.** `package.json` was stuck at
   `0.2.1` while runtime `VERSION` was `v0.2.136-alpha`. Bumped `package.json` to
   valid semver `0.2.137-alpha` (no leading `v`) and added a regression-check [5]
   guard tying `package.json version` to `EXPECTED_VERSION` (v-stripped) so the
   two can never silently drift again.
2. **HARD-2 — mock chat marked non-live.** The chat `#chat-input`/`#chat-send`
   are an unwired static preview (no JS handler reads them, nothing transmits).
   Disabled both, greyed them out, retitled the placeholder ("chat preview — not
   live") and header ("LIVE CHAT (preview)"), and added a comment. Still
   non-transmitting; no networking added.
3. **HARD-3 — CSP gstatic entry reviewed + documented.** `connect-src
   https://www.gstatic.com` is REQUIRED, not vestigial: DRACOLoader fetches its
   decoder from `gstatic.com/draco/versioned/decoders/1.5.6/` at runtime
   (`src/arena.js`, `src/weapons.js`). Documented as required in the index.html
   CSP comment. NOT removed, NOT broadened.
4. **HARD-4 — safe shell debug reports.** `engine/debug/shellReport.js` adds
   read-only reports over the three v0.2.136 VIEW shells, surfaced on
   `ToriiDebug.shells.{gateway,product,leaderboard,report}` with safe demo
   fixtures. Reads only the shells' pure return values — **no signer, no
   relay/publish, no navigation**.

- **Version bump:** `v0.2.136-alpha` → `v0.2.137-alpha`.
- **Tests:** 297 → **305** (+8), 27 → **28** files. Build green, `npm run check`
  ALL GREEN.
- **No deploy / publish / push / upload** — the main agent owns deployment.

## 2. Changes by file

### New source modules
- `src/engine/debug/shellReport.js` — read-only debug reports over the v0.2.136
  shells (`gatewayReport`/`productReport`/`leaderboardReport`/`buildShellReport`
  + `DEMO_GATEWAY`/`DEMO_PRODUCT`/`DEMO_SCORES` fixtures).

### New tests
- `tests/shell-report.test.js` (8 cases).

### Modified
- `package.json` — `version` `0.2.1` → `0.2.137-alpha` (HARD-1).
- `tools/regression-check.mjs` — header, `EXPECTED_VERSION` → `v0.2.137-alpha`,
  stale-version guard now flags `v0.2.136-alpha`, and check [5] now also asserts
  `package.json version === EXPECTED_VERSION` (v-stripped) (HARD-1).
- `src/config.js` — `VERSION` → `v0.2.137-alpha`.
- `index.html` — version labels (×2) → `v0.2.137-alpha`; CSP comment documents the
  required gstatic/DRACO entry (HARD-3); chat input/button disabled + greyed +
  re-labelled, header marked "(preview)", `#chat-*:disabled` CSS added (HARD-2).
- `src/engine/debug/toriiDebug.js` — `shells` block wired onto `window.ToriiDebug`
  (HARD-4).
- Docs: `todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`. This report.

> `strategy.md`, `COMPONENTS.md`, `GATEWAY_PROTOCOL.md` intentionally untouched —
> no strategic, component-contract, or protocol change in this batch.

## 3. The pieces

### shellReport.js (HARD-4)
- `DEMO_GATEWAY` — an ARMED demo gateway (has a `target`, so the travel plan
  validates) built via `createToriiGateway`.
- `DEMO_PRODUCT` — a valid product (https url + npub-shaped seller) (frozen).
- `DEMO_SCORES` — three demo runs (headshots ≤ kills, accuracy ∈ [0,1]) (frozen).
- `gatewayReport(component=DEMO_GATEWAY, context={}, opts={})` → `{status,
  isGateway, armed, destinationLabel, relay, prompt, urlPreview, errors}`.
- `productReport(product=DEMO_PRODUCT)` → `{ok, errors, title, lineCount, lines,
  footer, actionable, actionCount, readOnly}`.
- `leaderboardReport(statsList=DEMO_SCORES, {mode='build'}={})` → `{mode, count,
  skipped, rows, signed:false, published:false}`.
- `buildShellReport(inputs={})` → `{gateway, product, leaderboard}` (each section
  overridable). Read-only by construction — the underlying shells forbid
  signing/publish/navigation.

### regression-check [5] guard (HARD-1)
- `pkgVer = package.json.version`; `expectedPkgVer = EXPECTED_VERSION.replace(/^v/, '')`.
- Fails if they differ — prevents package/runtime version drift.
- Stale-version guard now flags the previous version (`v0.2.136-alpha`).

## 4. Verification

- `npm run build` → exit 0 (`✓ built`; dist rebuilt at v0.2.137 markers).
- `npm run check` → **ALL GREEN** (all 11 static guards, incl. the new
  package.json-version assertion, godMode=false, setTimeout allowlist, no
  hot-path allocs, FSM/event-bus seams).
- `npm test` → **305 passed / 305**, **28 files**.

### Security gates preserved
- **SEC-1 / SEC-2 / SEC-3** unchanged — this batch added no signer, no relay,
  no publish, no navigation, no clickable product URL. `ToriiDebug.shells.*`
  only reads the existing pure shells.
- godMode remains `false`; no new `setTimeout`; no new Vector3/Matrix4 hot-path
  allocations; "nostrich"/"Chiefmonkey" conventions untouched.

### Security-warning resolutions
- **Package/runtime version drift** → RESOLVED (HARD-1): semver-aligned + guarded.
- **Mock chat could look live** → RESOLVED (HARD-2): disabled + labelled preview,
  still non-transmitting.
- **CSP gstatic entry** → REVIEWED + KEPT + DOCUMENTED (HARD-3): required by the
  DRACO decoder fetch; not removed, not broadened.

## 5. Deferred (documented, not built)
- The actual Three.js portal / product-panel / leaderboard-board meshes (the
  render step with scene/DOM side effects) — unchanged from v0.2.136.
- Real Nostr signer + relay read/publish (SEC-1), `world/handoff.js` acting on a
  verified intent (SEC-2), product URL hardening to `URL`-object parsing (SEC-3).

## 6. For the main agent (deploy / sync)
- Changes are committed on branch **`v0.2.137`** (NOT pushed). Review, then push +
  open PR as appropriate.
- Live site `torii-quest.pplx.app` trails source; clean source is now
  **v0.2.137-alpha**. Deployment + the manual smoke test (LEAN-1 / TQ-MANUAL-113)
  are maintainer steps — **not performed here**.
- No DNS / VPS / relay / external state was touched. No publish/upload.
