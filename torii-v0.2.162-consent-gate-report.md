# Torii Quest — v0.2.162-alpha: Consent-Gate Foundation

## Goal
Add the explicit, auditable **consent-gate** boundary (the SEC-1 precursor) that
future Nostr signing/publishing, profile publish, leaderboard submit, gateway travel,
and update-apply actions MUST pass through — WITHOUT enabling any live write/sign/
publish/update action. Later write paths must route through a clear, testable,
inert consent descriptor/guard before they may ever touch the wire.

## What landed

### 1. `src/engine/consent/consentGate.js` (NEW — pure, node-safe)
No Nostr client, no WebSocket, no relay I/O, no signing, no publishing, no NIP-07, no
key handling, no payments, no DOM, no network, no auto-update, no navigation. Every
helper is pure and never throws. **The module NEVER performs an action** — it only
shapes a consent request and returns an INERT allowed/blocked DECISION. It exposes NO
sign/publish/send/connect/submit/apply/travel method; `allowed:true` is permission for
the HOST to act later behind its own audited transport, never an action taken here.
- `CONSENT_GATE_VERSION` = `1`; `ACTION_KINDS` = `[read, write, sign, publish, update, travel]`.
- `CONSENT_REASON` — stable decision codes: `read-only`, `consent-granted`,
  `consent-required`, `consent-mismatch`, `unknown-action`, `malformed`.
- `CONSENT_ACTIONS` — a frozen known-action registry, each descriptor pinning
  `kind`/`label`/`write`/`signed`/`requiresConsent`/`danger`/`summary`:
  - **Read tier (always allowed, no grant):** `leaderboard:read`, `profile:read`,
    `relay:read`.
  - **Write tier (grant required):** `nostr:publish`, `profile:update`,
    `leaderboard:submit`, `update:apply`, `gateway:travel`.
- `isKnownAction(id)` / `getActionDescriptor(id)` / `isWriteAction(id)` — classify the
  registry (`isWriteAction` is true for anything that needs consent; unknown → false).
- `buildConsentRequest(id | { action, detail?, origin? })` → `{ ok, request?|errors? }`
  — a flat consent-request descriptor; unknown/malformed actions degrade to `ok:false`.
- `summariseConsent(req | id)` → one human-readable line: `READ · …` for safe actions,
  `⚠ PUBLISH · … (requires explicit consent)` for high-danger write actions.
- `evaluateConsent(req | id, grant)` → an INERT decision
  `{ action, allowed, blocked, reason, requiresConsent, write, signed, danger,
  summary, performed:false, readOnly:true, errors }`:
  - read-only action → allowed (`READ_ONLY`), grant ignored;
  - write action + matching grant → allowed (`CONSENT_GRANTED`);
  - write action + no grant → blocked (`CONSENT_REQUIRED`);
  - write action + grant minted for a DIFFERENT action → blocked (`CONSENT_MISMATCH`,
    no privilege transfer);
  - unknown/malformed → blocked (`UNKNOWN_ACTION` / `MALFORMED`).
  A grant is a boolean `true` (blanket flag for the single evaluated action) or a
  scoped `{ granted:true, action?, token? }` — when `grant.action` is present it MUST
  equal the request action.
- `requestConsent(input, grant)` → `{ ok, request, decision, summary, errors }` — folds
  build + evaluate + summarise into one read-only host-prompt report.

### 2. SDK exposure (read-only)
`src/sdk/index.js` re-exports `consentGate` and registers it in `SDK_SURFACE` at the
**experimental** tier. Safe: pure helpers, no I/O, inert; no action surface.

### 3. ToriiDebug shell (read-only foundation map)
`src/engine/debug/shellReport.js` adds `consentGateReport(opts?)` — walks the known-
action registry and, for each action, shows its write/sign/danger facts, the default
(NO-grant) decision, and a one-line summary, proving reads are allowed while write
actions are blocked until an explicit grant arrives. An optional `{ grants }` map lets
a caller PREVIEW what would be allowed under a given set of consents — still without
performing anything (`performed:false` pinned). Wired into `buildShellReport` and
exposed read-only at `ToriiDebug.shells.consentGate({grants?})`. The locked 4-surface
`shellsSummary` proof-board list is UNCHANGED.

### 4. `tests/consent-gate.test.js` (NEW — 19 cases)
Covers the registry/descriptor invariants (read vs write classification); request
building from id/object + malformed degradation; summaries (READ vs consent-required +
unknown); read-only tier (always allowed, grant ignored); write tier (blocked with no
grant, allowed with boolean `true`, allowed with a matching scoped token, blocked on
action mismatch, blocked on `{granted:false}`); unknown/malformed decisions; the
combined `requestConsent` report; inertness invariants (no sign/publish/send/connect/
submit/apply/travel/write methods; every decision pins `performed:false`/`readOnly:true`)
+ SDK exposure.

## Verification
- `npm test -- --run` → **609 passed / 50 files** (was 590/49; +19 cases).
- `npm run build` → clean (known large-chunk advisory only).
- `npm run check` → **ALL GREEN**, 14/14; check `[14]` references v0.2.162-alpha (5 docs);
  proof-surface gate `[12]` ok (4 bound).
- `npm run bundle:report` → advisory baseline unchanged (rapier chunk tracked, not gated).
- `npm run handoff:status` → VERSION v0.2.162-alpha, package in sync; exits 0.

## Safety
godMode=false. No new `setTimeout` (the only allowed cases remain nostr.js WS close +
hud.js kill-feed). No Vector3/Matrix4. No gameplay/shooter/physics change; ESC instant
pause + panel-locked cursor untouched. Debug tools ship unconditionally. Comments use
"nostrich"; "Chiefmonkey" spelling preserved. No signing, publishing, payments, relay
writes, NIP-07 actions, private-key handling, auto-connect, navigation, or live
network — the gate decides, it never acts, and exposes no write/connect surface.

## Version markers bumped → v0.2.162-alpha
`src/config.js`, `package.json`, `index.html` (×2), `tools/regression-check.mjs`
(header, `EXPECTED_VERSION`, stale-guard now flags `v0.2.161-alpha`).

## Docs updated
`todo.md` (SEC-1 row), `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`.

## Not done (left to parent agent)
Not pushed/published. The consent UX (the actual confirm/HUD prompt that mints a grant)
and the real write-path wire-up this gate guards — NIP-07 signer + relay publish (SEC-1),
profile publish, gateway travel navigation, and the maintainer-gated update apply —
remain deferred. Parent agent verifies, security-reviews, deploys, publishes, pushes,
and syncs docs.
