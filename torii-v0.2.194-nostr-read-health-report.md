# Torii Quest — v0.2.194-alpha: Nostr Read-Path Health

> **Slice type:** infrastructure / dashboard / tooling + docs only. **No runtime, gameplay,
> portal, physics, shooting, controls, live Nostr write, signing, EVENT publish, relay network,
> or user-key change.** Pure / node-safe / local-only / read-only / network-free. Commit:
> `<filled at commit>` (local only — not pushed/published).

---

## 1. What & why

The Nostr surface in Torii Quest is deliberately **read-only at the MVP stage**: the engine can
build read filters and parse read events (profiles, leaderboard scores, relay events), but the
live-write path — NIP-07 signing + relay `EVENT` publish — is gated behind explicit consent and
**deferred** (security tiers SEC-1/SEC-2/SEC-3). That invariant is enforced across several shipped
pure modules (`relayRead`, `profileRead`, `leaderboardRelayRead`, `consentGate`), but it was never
**surfaced** as a single health signal anyone (operator, dashboard, next agent) could read at a
glance.

v0.2.194 adds a **pure, read-only Nostr read-path health model** that folds those existing
invariants into one report and **surfaces** it in three inert places: the SDK, the `ToriiDebug`
shell, and the Torii Continuum dashboard. It proves — without touching a relay — that the read
paths are present and the write paths stay disabled/consent-gated.

This is **status-only**. It adds **no** live Nostr writes, signing, `EVENT` publishing, new relay
network behaviour, or user-key handling. Every signal is derived from local module shape +
deterministic local sample events.

## 2. Deliverables

### Pure logic — `src/engine/nostr/readHealth.js`
PURE / node-safe (no Nostr client / WebSocket / relay I/O / signing / key handling / NIP-07 /
DOM / network; never throws on null/empty input). Constants:
- `READ_HEALTH_BADGE` = `'NOSTR READ-PATH · READ-ONLY · NO WRITE/SIGN/PUBLISH'`
- `PUBLISH_VERB` = `'EVENT'` (the verb that must stay ABSENT from the read path)
- `FUTURE_GATED_TIERS` = `['SEC-1','SEC-2','SEC-3']`
- deterministic LOCAL `SAMPLE_PROFILE_EVENTS` / `SAMPLE_SCORE_EVENTS`

Six pure signal checks, each `() → { key, label, status, detail }`:
1. **`checkRelayReadModel`** — `relayRead.RELAY_READ_VERBS` are `CLOSE`/`REQ` only; there is no
   EVENT/publish frame builder.
2. **`checkNoPublishVerb`** — the `EVENT` publish verb is absent from the read verb set.
3. **`checkProfileReadPath`** — `profileRead.readProfiles()` over the local sample yields a
   read-only profile result (`signed:false`, `published:false`, `readOnly:true`).
4. **`checkLeaderboardReadPath`** — `leaderboardRelayRead.readLeaderboardEvents()` over the local
   sample yields a read-only board.
5. **`checkWritePathsGated`** — `consentGate` write tier is `requiresConsent:true`; the read tier
   is always allowed.
6. **`checkFutureGatedTiers`** — SEC-1/SEC-2/SEC-3 are still future-gated.

`runReadHealth({ profileEvents, scoreEvents }) → { ok, badge, signals, summary:{total:6,ok,fail},
readOnly:true, signed:false, published:false, errors }` — degrades safely (defaults to the local
samples, never throws). `formatReadHealth(result)` renders one stable text block.

The model **derives** every signal from the already-shipped pure read modules and exposes **no**
relay/socket/sign/publish method of its own.

### SDK surface — `src/sdk/index.js`
`export * as nostrReadHealth` + a `SDK_SURFACE` registry entry at the **EXPERIMENTAL** tier.

### Debug shell — `src/engine/debug/shellReport.js` + `toriiDebug.js`
`readHealthReport()` added and folded into `buildShellReport()`; surfaced read-only at
`ToriiDebug.shells.readHealth()`. The 4-surface `shellsSummary` list is unchanged.

### Dashboard panel — `src/engine/dashboard/continuumData.js`
`READHEALTH_BADGE` + `buildReadHealthModel(input)` (folds `runReadHealth` into a render model with
per-signal `no-blocker`/`gated` pills), carried through `buildContinuumModel` (curated fallback) and
`continuumDataJSON`, and rendered by a new `_readHealthSection` in `renderContinuumPage` (status
pill, badge, per-signal table, a read-only invariants focus line `signed:false / published:false /
readOnly:true` + summary, and the deferred-write note). **It reuses only the existing pill
vocabulary**, so it adds **no new CSS and no new inline script** — the strict-CSP refresh-script
`sha256` is provably unchanged.

## 3. Safety / invariants (unchanged, and now asserted)

- **No live Nostr writes / signing / EVENT publish / relay network / user-key handling.** The model
  is pure and derives from local module shape + local sample events only.
- `signed:false`, `published:false`, `readOnly:true` are pinned on every read result and on the
  health report itself.
- consentGate write tier stays `requiresConsent:true`; SEC-1/2/3 stay future-gated.
- Dashboard reads **static/local metadata derived from docs/tooling**, never live relay calls.
- `godMode` stays `false`; no new `setTimeout` (allowlist `src/nostr.js`/`src/hud.js` unchanged);
  no new `Vector3`/`Matrix4` in hot paths; ESC pause + panel-click fire safety untouched. Gameplay,
  portal runtime, physics, shooting, and controls are not touched. "nostrich" / "Chiefmonkey"
  spellings preserved. Debug tools ship unconditionally.

## 4. Tests

- **`tests/nostr-read-health.test.js`** (16) — all six signals pass over the local sample; `ok`
  true; summary `{total:6, ok:6, fail:0}`; invariants pinned; never throws on `null`/`[]`; a broken
  input degrades to `ok:false` without throwing; `formatReadHealth` is safe.
- **`tests/continuum-dashboard.test.js`** (+7) — `buildReadHealthModel` folds to 6 signals /
  `READ-ONLY OK`; pins invariants + `no-blocker` pill; a broken path → `ATTENTION` + `gated` pill;
  pill-vocabulary check; `continuumDataJSON` carries `readHealth`; `renderContinuumPage` shows the
  section/badge/invariants; SAFETY: no unsafe token, exactly one inline script, CSP hash intact.

New totals: **1168 tests / 73 files** (was 1145 / 72 at v0.2.193).

## 5. Version bump + regenerated artifacts

`v0.2.193-alpha → v0.2.194-alpha` across: `package.json` (semver `0.2.194-alpha`), `src/config.js`
`VERSION`, `index.html` (×2), `tools/regression-check.mjs` (`EXPECTED_VERSION` + the stale-guard now
flags `v0.2.193-alpha`), `continuumData.js` `CONTINUUM_VERSION` + metrics rows. Regenerated
`public/release-metadata.json` (`npm run release:meta -- --write`, deterministic) and
`public/continuum.html` + `public/continuum-data.json` (`npm run build:continuum`).

## 6. Docs updated

`todo.md`, `progress.md`, `HANDOFF.md` (continuity docs — now reference v0.2.194), `CODE_INDEX.md`
(current version + readHealth.js path + v0.2.194 description), `SDK_DEBUG_INDEX.md` (status version +
`nostrReadHealth` namespace/description + `shells.readHealth` row + test row). `NOSTR_GAME_NIPS.md`
does not exist in the repo (skipped). `strategy.md`'s detailed changelog historically stops at
v0.2.144 and is not version-gated, so it was left unchanged to avoid churn.

## 7. Checks

`npm run check` (15 static guards), affected tests, `npm run docs:stale`, `npm run release:status`,
`npm run handoff:summary`, and `npm run test:release` — see commit notes / `/tmp/claude_code_output.md`
for the recorded results.

## 8. Security / performance concerns

None introduced. The slice is pure/inert: no network, no writes, no signing, no key handling, no
new runtime allocation in any hot path, and no new script in the CSP-locked dashboard. The model is
read-only and fails safe (`ok:false`, never throws) on degraded input.
