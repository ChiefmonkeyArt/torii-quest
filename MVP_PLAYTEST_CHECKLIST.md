# Torii Quest — MVP Manual Playtest Acceptance Checklist

> MVP MANUAL PLAYTEST CHECKLIST · LOCAL · READ-ONLY
> generated: 2026-06-26T18:05:02.587Z

- **Version:** v0.2.231-alpha @ a86d7d7 (source)
- **Live:** https://torii-quest.pplx.app
- **Items:** 17 across 13 sections
- **Severities:** blocker / major / minor

## How to run

- Run on a desktop browser against the live build. Fill in Result (PASS / FAIL / N/A) and Notes for each item.
- For any FAIL, record the item id, the actual result, and the browser console — then follow the "If it fails" action.
- Severity guides sign-off: any open blocker stops the MVP-proof sign-off; majors need a triage decision; minors are polish.
- This is a manual checklist — no browser automation is required or implied.

## Launch / title screen

### [ ] LAUNCH-1 — Title screen loads and shows the current version  _(blocker)_

**Steps:**
1. Open the live build URL in a desktop browser.
1. Wait for the title/landing screen to render.

**Expected:** The title screen appears with the game name and a version label matching the build (the current vX.Y.Z-alpha marker); no console errors block the screen.

**If it fails:** Capture the browser console + network tab; check the deployed bundle/version label and re-run the build/deploy. File a blocker.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

### [ ] LAUNCH-2 — Enter / start transitions into the arena  _(blocker)_

**Steps:**
1. From the title screen, click the start/enter control.
1. Allow pointer-lock when prompted.

**Expected:** The arena loads, pointer-lock engages, and the first-person view is interactive.

**If it fails:** Note whether pointer-lock was blocked by the browser; retry in a focused tab. File a blocker if the arena never loads.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Shooter loop

### [ ] SHOOT-1 — Core shoot → hit → respawn loop runs  _(blocker)_

**Steps:**
1. In the arena, locate a bot.
1. Fire at it until it is defeated; observe the kill-feed.
1. Wait for the bot to respawn.

**Expected:** Shots register, the bot is defeated, the kill-feed updates, and a bot respawns so the loop continues.

**If it fails:** Note whether shots connect at all vs. the bot never dying/respawning; capture console. File a blocker.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

### [ ] SHOOT-2 — ESC pauses instantly and the panel-locked cursor never fires  _(blocker)_

**Steps:**
1. While in the arena, press ESC.
1. With the pause/menu panel open, click on the panel and its controls.

**Expected:** ESC pauses immediately (pointer-lock released); clicking the panel interacts with the menu and NEVER fires the weapon.

**If it fails:** If a panel click fired the weapon or ESC did not pause, capture steps + console. File a blocker (input-safety regression).

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Movement / footsteps

### [ ] MOVE-1 — WASD movement, jump, and arena bounds  _(major)_

**Steps:**
1. Move with WASD across the arena; jump.
1. Walk into the perimeter walls.

**Expected:** Movement is smooth, jump arcs and lands, and the walls block you (no clipping out of the arena).

**If it fails:** Note where clipping/sticking occurs (coordinates if visible). File a major; escalate to blocker if you can leave the arena.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

### [ ] MOVE-2 — Footstep feedback while moving  _(minor)_

**Steps:**
1. Move continuously, then stop.

**Expected:** Footstep feedback plays while moving and stops when you stop; it is not stuck on or silent.

**If it fails:** Note whether audio is muted/blocked by the browser autoplay policy first. File a minor if footsteps are broken with audio enabled.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Aim / hit feedback / headshots / body shots

### [ ] AIM-1 — Hit feedback distinguishes a connecting shot  _(major)_

**Steps:**
1. Aim at a bot and fire a shot that clearly connects.
1. Aim at empty space and fire a shot that clearly misses.

**Expected:** A connecting shot shows clear hit feedback; a miss does not. The two are distinguishable.

**If it fails:** Note whether feedback is absent or always-on. File a major (aim feedback is core to the proof).

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

### [ ] AIM-2 — Headshots vs. body shots resolve differently  _(major)_

**Steps:**
1. Aim at a bot's head/crown and fire.
1. Aim at a bot's torso and fire.

**Expected:** A head hit and a body hit resolve as expected (head registers as the higher-value/lethal hit per the current tuning); aiming at the visible head connects without aiming above the model.

**If it fails:** Note if you must aim above/below the visible head to connect (head-sphere geometry drift). File a major.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Reload feel

### [ ] RELOAD-1 — Reload triggers, feels snappy, and refills ammo  _(minor)_

**Steps:**
1. Fire until the magazine is low/empty, or press the reload key.
1. Observe the reload and the ammo counter.

**Expected:** Reload triggers (manual and/or on-empty), completes in a snappy ~1.1s, and the ammo counter refills to the magazine size.

**If it fails:** Note the perceived reload duration vs. the tuned value and whether ammo refills. File a minor (feel/tuning).

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Gun / reflection sanity

### [ ] GUN-1 — Viewmodel renders correctly and tracks aim  _(minor)_

**Steps:**
1. Observe the first-person weapon viewmodel while idle, moving, and firing.

**Expected:** The gun viewmodel renders without obvious gaps/flicker/inverted faces, sits in a sane screen position, and animates with fire/move.

**If it fails:** Capture a screenshot of the artifact (z-fighting, missing faces, wrong position). File a minor.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Mirror sanity

### [ ] MIRROR-1 — Mirror reflection is coherent and not a performance sink  _(minor)_

**Steps:**
1. Locate the mirror surface and look into it; move in front of it.

**Expected:** The reflection is coherent (no inverted/garbled image, no infinite-recursion meltdown) and does not tank the framerate.

**If it fails:** Note the visual artifact and any FPS drop. File a minor (cosmetic/perf), escalate if it freezes the page.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Crates / physics nudge sanity

### [ ] CRATE-1 — Crates are solid and behave under a nudge  _(major)_

**Steps:**
1. Walk into the crates; try to walk through them.
1. Shoot a crate and observe.

**Expected:** Crates are solid (block movement and bullets per the collision model) and do not jitter, launch, or sink through the floor.

**If it fails:** Note clipping vs. physics blow-ups (crate launching/vibrating). File a major if crates are pass-through.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## NAP monkey sanity

### [ ] NAP-1 — Crossing the torii gate into the NAP zone disables the weapon  _(major)_

**Steps:**
1. Walk east through the torii gate into the Non-Aggression zone.
1. Attempt to fire; observe the NAP-zone monkey/bonsai.

**Expected:** East of the gate the weapon is disabled (peace), bots do not cross into the NAP zone, and the NAP-zone props render; walking back west re-enables play.

**If it fails:** Note whether the weapon still fires in the NAP zone or bots cross the gate. File a major (NAP-principle regression).

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Continuum dashboard

### [ ] CONT-1 — Continuum dashboard renders and matches the build version  _(minor)_

**Steps:**
1. Open /continuum.html on the live build.

**Expected:** The dashboard renders version, test status, active slices, and recent work; the version matches the title-screen build and the test counts read as current.

**If it fails:** Note any stale version/test-count vs. the title screen. File a minor (dashboard data-freshness).

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Release metadata / update prompt

### [ ] UPDATE-1 — Release metadata is present and the update prompt is read-only  _(minor)_

**Steps:**
1. Load /release-metadata.json on the live build.
1. Trigger/observe any in-app update prompt surface.

**Expected:** release-metadata.json is served and valid (manual-update posture, no auto-update); any update prompt is informational only and performs no automatic download/apply.

**If it fails:** Note a missing/garbled metadata file or an auto-applying updater. File a major if anything auto-updates; otherwise minor.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Nostr read surfaces

### [ ] NOSTR-1 — Read-only Nostr surfaces load without signing or publishing  _(minor)_

**Steps:**
1. Open the Nostr read/profile/leaderboard surface(s).
1. Observe loading, and confirm there is no signing/publish action.

**Expected:** Read surfaces populate (or degrade gracefully if a relay is slow) with NO signing prompt and NO publish/write path exposed — read-only proof only.

**If it fails:** Note whether a relay simply timed out (acceptable, advisory) vs. a signing/publish path appearing (NOT acceptable). File a major if any write/sign path is exposed.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Gateway portal / travel confirm shell

### [ ] GATE-1 — Gateway portal shows a travel-confirm shell and routes safely  _(minor)_

**Steps:**
1. Approach/activate the gateway portal.
1. Observe the travel-confirm shell; confirm a zone travel.
1. Try a malformed /zone/<slug> URL directly.

**Expected:** The portal presents a travel-confirm shell (not an instant silent jump); confirming routes to the zone; a malformed slug is rejected/falls back to index rather than breaking the app.

**If it fails:** Note whether travel happens with no confirm, or a bad slug breaks routing. File a major if a hostile slug escapes the fallback; otherwise minor.

| Result (PASS / FAIL / N/A) | Notes |
| --- | --- |
|  |  |

## Known deferred / non-blocking advisories

- The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated) — expect a one-time load cost.
- Nostr read surfaces depend on public relays; a slow/unreachable relay is an advisory, not a failure, as long as the UI degrades gracefully.
- Audio (footsteps/feedback) may be blocked until the first user interaction by the browser autoplay policy — interact once before judging audio items.
- This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review; there is no signing/publishing to test.

---

_MANUAL CHECKLIST ONLY — this document runs no browser automation, reaches no network, and triggers no deploy/publish. It is a hand-run acceptance aid for the live build. The parent agent owns security review, deploy, publish, push, and Space upload._
