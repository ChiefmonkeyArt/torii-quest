# Torii Quest — MVP Manual Playtest Results

> MVP PLAYTEST RESULTS INTAKE · LOCAL · READ-ONLY
> generated: 2026-06-26T10:17:52.770Z

- **Items:** 17 across 13 sections
- **Result values:** PASS / FAIL / N/A
- **Severities:** blocker / major / minor

## How to use

- Run the MVP_PLAYTEST_CHECKLIST against the live build, then record each item's outcome here.
- Fill the Result cell with PASS, FAIL, or N/A (leave blank if not yet run). For a FAIL, record the observed severity, repro notes, any media, and a recommended next action.
- Feed every FAIL back into todo.md / progress.md / HANDOFF.md by item id (e.g. AIM-2) so it is tracked unambiguously.
- This is a manual intake form — no browser automation is required or implied; nothing here runs or deploys anything.

## Build / session

| Field | Value |
| --- | --- |
| Build / version | v0.2.224-alpha |
| Commit | 54e16d5 |
| Live URL | https://torii-quest.pplx.app |
| Tester |  |
| Date |  |
| Environment (browser / OS) |  |
| Overall notes |  |

## Launch / title screen

### [ ] LAUNCH-1 — Title screen loads and shows the current version  _(blocker)_

_Expected:_ The title screen appears with the game name and a version label matching the build (the current vX.Y.Z-alpha marker); no console errors block the screen.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

### [ ] LAUNCH-2 — Enter / start transitions into the arena  _(blocker)_

_Expected:_ The arena loads, pointer-lock engages, and the first-person view is interactive.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Shooter loop

### [ ] SHOOT-1 — Core shoot → hit → respawn loop runs  _(blocker)_

_Expected:_ Shots register, the bot is defeated, the kill-feed updates, and a bot respawns so the loop continues.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

### [ ] SHOOT-2 — ESC pauses instantly and the panel-locked cursor never fires  _(blocker)_

_Expected:_ ESC pauses immediately (pointer-lock released); clicking the panel interacts with the menu and NEVER fires the weapon.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Movement / footsteps

### [ ] MOVE-1 — WASD movement, jump, and arena bounds  _(major)_

_Expected:_ Movement is smooth, jump arcs and lands, and the walls block you (no clipping out of the arena).

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

### [ ] MOVE-2 — Footstep feedback while moving  _(minor)_

_Expected:_ Footstep feedback plays while moving and stops when you stop; it is not stuck on or silent.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Aim / hit feedback / headshots / body shots

### [ ] AIM-1 — Hit feedback distinguishes a connecting shot  _(major)_

_Expected:_ A connecting shot shows clear hit feedback; a miss does not. The two are distinguishable.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

### [ ] AIM-2 — Headshots vs. body shots resolve differently  _(major)_

_Expected:_ A head hit and a body hit resolve as expected (head registers as the higher-value/lethal hit per the current tuning); aiming at the visible head connects without aiming above the model.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Reload feel

### [ ] RELOAD-1 — Reload triggers, feels snappy, and refills ammo  _(minor)_

_Expected:_ Reload triggers (manual and/or on-empty), completes in a snappy ~1.1s, and the ammo counter refills to the magazine size.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Gun / reflection sanity

### [ ] GUN-1 — Viewmodel renders correctly and tracks aim  _(minor)_

_Expected:_ The gun viewmodel renders without obvious gaps/flicker/inverted faces, sits in a sane screen position, and animates with fire/move.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Mirror sanity

### [ ] MIRROR-1 — Mirror reflection is coherent and not a performance sink  _(minor)_

_Expected:_ The reflection is coherent (no inverted/garbled image, no infinite-recursion meltdown) and does not tank the framerate.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Crates / physics nudge sanity

### [ ] CRATE-1 — Crates are solid and behave under a nudge  _(major)_

_Expected:_ Crates are solid (block movement and bullets per the collision model) and do not jitter, launch, or sink through the floor.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## NAP monkey sanity

### [ ] NAP-1 — Crossing the torii gate into the NAP zone disables the weapon  _(major)_

_Expected:_ East of the gate the weapon is disabled (peace), bots do not cross into the NAP zone, and the NAP-zone props render; walking back west re-enables play.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Continuum dashboard

### [ ] CONT-1 — Continuum dashboard renders and matches the build version  _(minor)_

_Expected:_ The dashboard renders version, test status, active slices, and recent work; the version matches the title-screen build and the test counts read as current.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Release metadata / update prompt

### [ ] UPDATE-1 — Release metadata is present and the update prompt is read-only  _(minor)_

_Expected:_ release-metadata.json is served and valid (manual-update posture, no auto-update); any update prompt is informational only and performs no automatic download/apply.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Nostr read surfaces

### [ ] NOSTR-1 — Read-only Nostr surfaces load without signing or publishing  _(minor)_

_Expected:_ Read surfaces populate (or degrade gracefully if a relay is slow) with NO signing prompt and NO publish/write path exposed — read-only proof only.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

## Gateway portal / travel confirm shell

### [ ] GATE-1 — Gateway portal shows a travel-confirm shell and routes safely  _(minor)_

_Expected:_ The portal presents a travel-confirm shell (not an instant silent jump); confirming routes to the zone; a malformed slug is rejected/falls back to index rather than breaking the app.

| Field | Value |
| --- | --- |
| Result (PASS / FAIL / N/A) |  |
| Observed severity (if FAIL) |  |
| Repro notes |  |
| Screenshots / video |  |
| Recommended next action |  |

---

_RESULTS INTAKE TEMPLATE ONLY — fill this in by hand after running the checklist. It runs no browser automation, reaches no network, and triggers no deploy/publish. Feed every FAIL back into todo.md / progress.md / HANDOFF.md by item id. The parent agent owns security review, deploy, publish, push, and Space upload._
