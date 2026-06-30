# Torii Quest ToDo

Source of truth for Torii Quest tasks.

## Scope

Torii Quest is the game app.
Torii Continuum is a separate dashboard app and must stay on `continuum-todo.md`.
Nostr Arena is archival only and must not be used as the active queue for Quest.

This todo is reprioritised around the lean MVP only:
- Keep the freedom-tech loop clear and demoable.
- Keep shooter work maintenance-only unless a bug is demo-breaking.
- Keep BotAgent / runtime separation work only where it improves Quest vs Continuum boundaries or prevents instability.
- Keep NOSTR_ARENA_MASTER_TODO.md as the Arena-only source-of-truth file until the Quest / Continuum split is fully settled.
- Defer broader polish, most live-promotion work, and larger redesign passes to Milestone 2 and Milestone 3, while keeping security gates visible until the related live features are promoted.


## Milestone 1 — MVP Proof of Concept Torii Quest

Goal: ship the smallest clean proof-of-concept that demonstrates the Torii Quest loop.

### Current job status
- PAUSED: Oversight dashboard progress UX work
- State captured in HANDOFF / NEXT_ACTION_STATE.
- Replacement slices:
  - Finish the Continuum click-through mockup path for the MVP demo (1–3h)
  - Show clearer progress state in the oversight dashboard (1–3h)
  - Add heartbeat / partial-progress feedback for long-running bot work (1–3h)

### Active MVP tasks
- Keep the four MVP proof slices visible and coherent as one loop: Gateway, Product, Leaderboard, Update.
- Keep the title-screen / entry / in-world flow stable so the loop can be demoed end-to-end without silent failure.
- Keep the current safe gateway path intact: preview, intent, consent copy, dry-run plan, same-origin executor seam, and controlled host transport seam.
- Complete the move of the Torii jump gate / gateway experience into the far-right corner of the NAP zone (DONE v0.2.245–v0.2.250) and now **promote the gateway to the live n2n hop**: see `strategy.md` → "15-Hour Proof-of-Concept Route" item 2. Phased — P0 presence/who's-online (live relay read + publish our own world-presence event) → P1 signed travel-request/confirm handshake (NIP-07, SEC-2) → P2 cross-host jump carrying npub (SEC-3) → P3 two-instance interop proof. The placeholder second-zone idea is RETIRED in favour of the real cross-world hop described in `GATEWAY_PROTOCOL.md` §6.
- Keep BotAgent / separation work only where it sharpens the Torii Quest vs Torii Continuum app boundary or prevents demo-breaking instability.
- Keep docs / handoff / code-index upkeep only at the minimum needed to stop agent confusion and preserve clean app separation.
- Stand up a safe assistant-editable .md pipeline for quest-todo.md / continuum-todo.md so todo, handoff, and progress updates can be made on the fly without manual copy-editing. **BUILT v0.2.259** — `tools/mdPatch.mjs` (mdPatch-2): whitelist now covers quest-todo / continuum-todo / todo / progress / HANDOFF; per-file capability map (HANDOFF append-only); new `note` action appends a timestamped live bullet under a per-file default heading. `npm run md:patch`.
- Stand up a thin Continuum click-through mockup for the MVP loop (read-only dashboard path, no admin actions), so the freedom-tech loop can be demonstrated with oversight.

### MVP constraints
- Shooter is maintenance-only.
- No combat-feel polish unless demo-breaking.
- No broad rewrites.
- No speculative architecture work.
- No dashboard redesign work in the Quest MVP queue.
- No live network execution unless already required for the safe MVP proof path.

## Milestone 2 — Post-MVP functional expansion

Goal: promote selected proof surfaces into richer, more functional experiences after the MVP is proven.

### Deferred to Milestone 2
- Real leaderboard publish via NIP-07 / relay write.
- Richer product interaction beyond read-only proof.
- Real GitHub fetch for update-check.
- Further live gateway promotion beyond the current safe proof path.
- Richer in-world proof-surface / mesh promotion work not required for the MVP demo.
- Additional BotAgent runtime migration or deeper engine cleanup that is not needed for clean app separation or MVP stability.
- Further player-boundary / FSM cleanup that is not directly required for the MVP.

### Standing security gates for live promotion
- SEC-1 leaderboard publish gate — BUILT v0.2.257 (`src/engine/leaderboard/publishGate.js`): a pure, node-safe structural gate (signer match + event shape + score validity + abuse ceilings + consent + topic tag) wired opt-in into the publisher adapter so a relay write can never run ungated. Full BIP-340 sig verification is the next crypto layer. The live NIP-07 signer + relay publish PATH in main.js remains consent-gated + deferred — this gate is what must clear before that wiring is promoted.
- SEC-2 handoff verification gate — BUILT v0.2.252 (`src/engine/gateway/handoffVerify.js`): structural accept-verification (host match + request reference + traveller addressing + https spawn) wired into the handshake controller.
- SEC-3 product URL hardening gate — BUILT v0.2.253 (`src/engine/gateway/urlHarden.js`): scheme/host allowlist + private-host rejection + traveller-npub append, wired into `_executeJump` so no URL becomes navigable until it clears.

These are not Milestone 1 delivery tasks unless live promotion is explicitly being advanced, but they are also not ordinary backlog items to forget. Keep them visible as standing gates that must be cleared before the related live features are promoted.

## Audit follow-ups (v0.2.259 optimization pass)

Remaining items from the v0.2.259 code audit (`torii-quest-audit-v0.2.259.md`). Already landed in v0.2.260: E1 (vitest pool=threads, 28.7s→2.7s), GLB1+GLB2 (−66% assets, DRACOLoader), R3 (SW precache trim), S5 (relay fan-out), S2 (port hardening), repo hygiene. Landed in v0.2.261: **R1** (dashboard SDK split — app chunk −19.4% raw / −19.7% gzip). Landed in v0.2.263: **S1** (real BIP-340 schnorr verify in the gateway handoff).

Each item is sized as a single thin slice. Keep them in priority order; pick one per session.

- **S1 — schnorr verify in handoffVerify — LANDED v0.2.263 (security).** Replaced structural-only SEC-2 with a real BIP-340 signature verification. The host's accept is a NIP-01 nostr event; `verifyHandoff()` now recomputes the event id and runs `schnorr.verify(sig, idBytes, hostPubkey)` (new `src/engine/gateway/nostrSig.js`), failing closed on a missing/forged/tampered signature and returning `trust: 'crypto-verified'` only on a full pass. The handshake controller arms the hop ONLY on `crypto-verified`. Adds the project's **first runtime crypto dependency** (`@noble/curves` + transitive `@noble/hashes`); app chunk +30.5 KB raw / +12.5 KB gzip (262→292 KB raw). Tests: 5 new crypto cases in `tests/travel-request.test.js` (valid pass, tampered body, wrong-key, missing sig, unsigned-no-longer-arms) + handshake-controller arming reworked to real schnorr sigs.
- **R2 — lazy-load THREE behind ENTER ARENA — LANDED v0.2.264 (perf).** Split `main.js` into a three-free shell (title screen / gateway cards / previews / login / char select / zone-route notice) + a new `src/arenaRuntime.js` that owns every three-dependent surface (scene/renderer, arena geometry, the game loop, players/bots/weapons/physics viewmodels, the in-world portal mesh + ToriiDebug). The shell `await import('./arenaRuntime.js')`s ONLY inside the ENTER ARENA handler, so `three-vendor` is now a dynamic-import target (no longer in `index.html`'s preload set, no static import in the app chunk). The title-screen n2n handshake + presence polling moved from the game loop to a three-free shell rAF ticker so it keeps running before/after the arena boots. **Bundle:** app/shell chunk 292.4 KB → 103.6 KB raw (96.0 → 35.6 KB gzip, −64.6% raw / −62.9% gzip); new `arenaRuntime` chunk 190.9 KB (62.8 KB gzip); `three-vendor` 625.1 KB raw / 160.6 KB gzip is no longer paid on first paint — it loads on demand after ENTER ARENA (first-paint JS drops ~625 KB raw / ~161 KB gzip). Tests: all 1843 green (boot-order + portal-placement + entry-flow contracts repointed at `arenaRuntime.js`; `main.js` now asserted to never statically import `scene.js`).
- **E2 — replace foundation profile with `vitest --changed origin/main` — LANDED v0.2.265 (DX).** `npm run test:foundation` no longer runs the hand-curated file list — it now runs `vitest run --changed origin/main --passWithNoTests`, i.e. only the suites whose import graph is touched by the diff vs `origin/main` (vitest's related-graph semantics), so there is no manual list to keep in sync as the suite grows. `--passWithNoTests` makes a clean tree (or a checkout where `origin/main` is absent) a graceful no-op (exit 0, "No test files found") rather than a failure. The curated foundation set is preserved as `npm run test:foundation:list` (still backed by `tools/testProfiles.mjs` → it remains the source of the dashboard/handoff profile counts and the validate-against-disk guard); `test:fast` (tiny innermost core) and the full-suite gate (`npm test` / `npm run test:release`) are unchanged. Dashboard "Tests" label updated to reflect the new behaviour.
- **S4 — vendor Draco decoder under public/draco/ (~1h, security/CSP).** Drop the `gstatic.com` connect-src/script-src exception by serving the decoder from the same origin. Tightens CSP and removes the only third-party runtime dependency.
- **S3 — move CSP from meta tag to HTTP header (~1h, security).** Add nonce + `strict-dynamic` so inline/stale script can never execute. Pairs with S4 to lock down the runtime origin policy.
- **E3 — split the three biggest test files (~1h, DX).** `continuum-dashboard.test.js`, `next-action-state.test.js`, `md-patch.test.js` are now multi-hundred-test monoliths; split by section so failures localise and parallel pool scheduling stays efficient.
- **R4 — audit other large barrel re-exports (~1h, perf).** Now that R1 is split, look for the next-heaviest leaks (`shellReport.js` ~52 KB — not currently in SDK barrel; check transitive importers) and any other dashboard/oversight strings reachable from runtime entry points.

## Milestone 3 — Post-MVP polish and redesign

Goal: improve visual quality, readability, and feel once the MVP loop is already working.

### Deferred to Milestone 3
- Shooter feel polish.
- Mesh / material polish.
- Broader UX refinement.
- Broader bot behaviour polish.
- Larger Continuum redesign follow-up work such as DASHBOARD-LAYOUT-1 richer cards / tables / denser visual redesign.
- Any nonessential visual or presentation improvements that do not change the MVP proof.

## Torii Quest ToDo - Working rules

- Prefer thin vertical slices over polish traps.
- Break every task into small chunks that can usually be finished in a few hours, not open-ended multi-day jobs.
- Prefer thin vertical slices with a clear green checkpoint, visible outcome, and one obvious next step.
- Avoid long-running jobs that stall flow, hide risk, or delay feedback; if a task starts to sprawl, split it again before continuing.
- Each chunk should produce meaningful progress on the MVP proof, app separation, safety, or demo stability.
- End each chunk in a handoff-safe state: code green, tests updated where relevant, docs/indexes touched, and the next safe task easy to pick up.
- If a job cannot be described as a few-hour slice with a concrete finish line, it is too big and must be broken down first.
- Every change should improve clarity, safety, testability, or separation when practical.
- Keep Quest and Continuum task lists separate.
- If a task does not directly help the MVP proof, clean app separation, or demo stability, defer it.
- When a current job becomes too large, pause it safely: commit or checkpoint all green work, record the current state in HANDOFF / NEXT_ACTION_STATE, then replace it with a list of 1–3 hour follow-up slices.
- Never abandon partially-completed work; always capture its state before changing the active job.

### Bot / progress handling

- Pause any bot-related work that does not directly improve MVP stability, app boundaries, or player feedback.
- Do not let long-running BotAgent jobs block progress reports or dashboard updates; report partial landings as soon as they are green.
- Prefer short, observable slices (1–3 hours) that show visible changes in bot behaviour, load, or safety.