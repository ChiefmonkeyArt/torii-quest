# Torii Quest — v0.2.165-alpha report

## Gateway travel CONFIRMATION / INTENT behind the consent gate (LEAN-2 / GATEWAY-TRAVEL)

**Date:** 2026-06-24
**Branch:** `v0.2.165` (off the v0.2.164 commit `ebd6ff9`)
**Type:** safe, no-blocker infrastructure / foundation slice — pure inert intent builder
routed through the v0.2.162 consent gate, consuming the v0.2.164 gateway-read preview model.
No runtime / gameplay / visual change; no navigation, no network, no signing/publishing.

---

## What shipped

A pure, node-safe module that proves how a future NAP-zone-to-NAP-zone travel action would be
**prepared, summarised, and consent-checked** — and guarantees it is **blocked unless an explicit
matching consent grant is present** — WITHOUT performing browser navigation, world unload/reload,
network write, signing, publishing, NIP-07, private-key handling, payments, automatic updates, or
any irreversible action.

### New module — `src/engine/gateway/travelConfirm.js` (PURE / node-safe)

No THREE/Rapier/DOM/network/WebSocket/relay I/O/signing/key-handling/NIP-07/payments/navigation/
auto-connect; never throws; never performs the travel.

- `TRAVEL_ACTION = 'gateway:travel'` — the single consent action this intent routes through.
- `sanitizeDestination(input) → { ok, destination?|errors? }` — accepts **either** a v0.2.164
  `gatewayRead` preview model **or** a plain destination descriptor (idempotent — re-sanitising
  already-clean data is safe). Anchored to a **required `zoneId`** (no-zoneId → `ok:false`).
  Produces the canonical inert destination `{ zoneId, title, zoneType, npub, pubkey, shortPubkey,
  website, relays }`:
  - text control/markup-stripped (C0/DEL + `<`/`>`), trimmed, length-capped;
  - `website` https-only via profileRead `safeProfileUrl` (javascript:/data:/relative/http → null);
  - `relays` ws/wss-only + credential-free + deduped + capped via relayRead `validateRelayUrl`;
  - `npub` only when it passes travelIntent `looksLikeNpub`;
  - `pubkey` only when 64-char lowercase hex (`shortPubkey` derived from it);
  - `zoneType` ∈ `nap`/`arena`/`shop`/`gallery`, else null.
- `summariseTravelConfirm(input)` — one stable, human-readable preview-only line (consent summary
  + destination headline so the stakes — leaving this world — are never hidden).
- `prepareTravelIntent(input, grant) →` an **INERT** report:
  ```
  {
    ok,            // built.ok && consent.allowed — host MAY proceed
    action: 'gateway:travel',
    destination,   // sanitised inert destination, or null if invalid
    consent,       // the inert consentGate decision (allowed/blocked + reason)
    summary,
    navigated:  false,   // ALWAYS
    performed:  false,   // ALWAYS
    signed:     false,   // ALWAYS
    published:  false,   // ALWAYS
    readOnly:   true,
    errors: [string],
  }
  ```
  Routes the destination through `buildConsentRequest` + `evaluateConsent('gateway:travel', grant)`.
  **Blocked by default** (`consent-required`); allowed **only** with an explicit matching grant
  (boolean `true` or scoped `{ granted:true, action?, token? }`). A grant minted for a different
  action never authorises it (`consent-mismatch`). A malformed/unidentifiable destination yields
  `ok:false` with `destination:null` **even with a grant**. With a matching grant the report marks
  consent allowed but **still never navigates / signs / publishes / sends / connects** —
  `navigated:false` / `performed:false` are pinned; `allowed:true` is proof of what the host could
  later execute behind its own audited transport, never an action taken here.
- `DEMO_TRAVEL_INPUT` — frozen deterministic sample destination for the debug shell only.

The module exposes **no** `navigate`/`goto`/`travelTo`/`sign`/`publish`/`send`/`connect`/`open`/
`apply`/`write`/`fetch`/`unload`/`reload` method (asserted by test).

### Consent-gate routing note

`gateway:travel` is registered in `consentGate.js` as a **write-tier** action (kind `travel`,
`requiresConsent: true` despite `write:false`), so it IS grant-gated: no-grant blocks, matching
grant allows, action-mismatch grant blocks.

### Read-only exposure (debug + SDK)

- **SDK** — `src/sdk/index.js`: added `travelConfirm` namespace re-export + `SDK_SURFACE`
  entry at the EXPERIMENTAL tier.
- **Debug** — `src/engine/debug/shellReport.js`: new `gatewayTravelReport(input?, grant?)` →
  `{ title:'GATEWAY TRAVEL INTENT', badge:'PREVIEW · INERT · NO NAVIGATION', action, ok, allowed,
  blocked, reason, destination, summary, navigated:false, performed:false, signed:false,
  published:false, readOnly:true, errors }`; added to `buildShellReport` over `DEMO_TRAVEL_INPUT`.
  The **4-surface `shellsSummary` proof-board list is unchanged.**
- **Debug** — `src/engine/debug/toriiDebug.js`: `ToriiDebug.shells.gatewayTravel(input?, grant?)`.

---

## Tests — `tests/gateway-travel-confirm.test.js` (18 tests, all pass)

Covers: `sanitizeDestination` (clean descriptor; gatewayRead model idempotent; reject no-zoneId;
strip control/HTML; https-only website; ws-only relays; known zoneType; valid npub + hex pubkey;
never throws on hostile input); `prepareTravelIntent` consent routing (blocked with no grant;
allowed with boolean grant + never performs; allowed with scoped matching grant; blocked on action
mismatch; blocked on `{granted:false}`; `ok:false`/null destination on malformed even WITH a grant;
bare descriptor == `{destination}` wrapper); inert-flag invariants on every report; stable
summaries; **no navigate/sign/publish/send/connect/apply method** on the module surface; SDK/debug
exposure.

---

## Verification (all green)

| Step | Result |
|---|---|
| `npm run build` | ✓ built in ~2.9s (94 modules; app 148 KB / 49 KB gzip) |
| `npm test -- --run` | ✓ **669 passed / 53 files** (+18 tests, +1 file vs v0.2.164's 651/52) |
| `npm run check` | ✓ **ALL GREEN** (14/14); [5] version markers == v0.2.165-alpha; [6] dist version ok; [11] 53 test files; [12] proof-surface gate ok (4 bound, 2 groups); [14] continuity docs reference v0.2.165-alpha (5 docs) |
| `npm run bundle:report` | advisory only — rapier chunk over 700 KB (tracked, not gated) |
| `npm run handoff:status` | ✓ config/package versions in sync at v0.2.165-alpha; 7/7 core docs present |

---

## Files changed

**New:**
- `src/engine/gateway/travelConfirm.js`
- `tests/gateway-travel-confirm.test.js`
- `torii-v0.2.165-gateway-travel-confirm-report.md`

**Edited:**
- `src/config.js` — `VERSION` → `v0.2.165-alpha`
- `package.json` — `version` → `0.2.165-alpha`
- `index.html` — both version markers → v0.2.165-alpha
- `tools/regression-check.mjs` — header, `EXPECTED_VERSION`, stale-guard (now flags v0.2.164-alpha)
- `src/sdk/index.js` — `travelConfirm` namespace + `SDK_SURFACE` entry (experimental)
- `src/engine/debug/shellReport.js` — `gatewayTravelReport` + `buildShellReport` key
- `src/engine/debug/toriiDebug.js` — `shells.gatewayTravel(input?, grant?)`
- `todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`, `GATEWAY_PROTOCOL.md`

---

## Safety constraints upheld

godMode remains `false` (never true). No new `setTimeout` (allowlist unchanged: nostr.js WS close,
hud.js kill-feed). No new `Vector3`/`Matrix4` in hot paths. "nostrich" / "Chiefmonkey" spellings
untouched. Debug tools ship unconditionally. ESC instant-pause + panel-locked cursor behaviour
untouched. **No** browser navigation, world unload/reload, live network writes, signing, NIP-07
requests, private-key handling, payments, automatic updates, or irreversible actions added. Gameplay
/ shooter feel unchanged. Split by concern (pure module / tests / SDK / debug / docs).

**Deferred (next slices):** the real host navigation / world-unload-reload that acts on an allowed
intent (`world/handoff.js`) and the consent UX prompt that mints the grant.

---

## Commit

Committed locally on branch `v0.2.165` (NOT pushed/deployed/published — the parent agent will
verify / security-review / deploy / push / publish).
