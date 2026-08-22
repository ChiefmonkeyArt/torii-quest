# ADR-0014 — Trigger-fire diagnostics (log every shot, not just resolved hits)

**Status:** Accepted (2026-08-22)
**Ships in:** v0.2.624-alpha
**Author:** Torii Agent (proposal); Chiefmonkey (approval)
**Supersedes:** — (extends ADR-0013)

## Context

ADR-0013 shipped `[SHOT] / [KILL] / [RESPAWN]` logging, which records damage
resolutions and lifecycle transitions. First diagnostic run (v0.2.623, 2026-08-22
session) revealed an important blind spot: the maintainer reported
"shot a bot many times to no effect just before dying," but the console for
that session shows **exactly one [SHOT] line per regular kill**. No "many shots
to no effect" event appears in the log.

That is diagnostic gold in itself — it means the missing shots **never resolved
into a bot hit** at all. `resolveLocalHitscan` returned `null`, so `hitBot` was
never called, so `[SHOT]` was never emitted. The player pulled the trigger and
the ray either missed everything, hit terrain, hit a dead bot's parked
collider, or hit a bot but the resolver rejected it.

To distinguish those causes we need a log line **on every trigger pull**, not
just on resolved hits.

## Decision

Add one console line per fired shot, keyed off the same aim-ray we already
cast in `weapons.js::recordPlayerShot`. Format:

```
[FIRE] mode=<sp|mp> hit=<none|bot|terrain|dead-bot|other> \
       botId=<N|-> name=<Name|-> zone=<head|body|limb|-> \
       toi=<meters|-> resolved=<yes|no|mp> reason=<miss|clean-hit|dead|net|other>
```

Field semantics:

- `mode` — `sp` when `_isNetMode()===false`, `mp` when true. Answers "is the
  server supposed to resolve this?"
- `hit` — the aim-ray raycast outcome:
  - `none` — raycast returned nothing (open sky, off-map, out of range)
  - `bot` — raycast hit a live bot's collider
  - `terrain` — raycast hit non-bot geometry (ground, tree, mirror, etc.)
  - `dead-bot` — raycast hit a body-part collider whose owning bot is `alive=false`
  - `other` — hit an object with `bot` present but no shape we can classify
- `botId` / `name` — populated only when `hit=bot` or `hit=dead-bot`
- `zone` — populated only when `hit=bot` (from the classifier)
- `toi` — time-of-impact (metres) when the raycast returned a hit
- `resolved` — `yes` (SP, damage applied), `no` (SP, resolver said no),
  `mp` (server-authoritative, deferred)
- `reason` — the pointed cause for `resolved != yes`:
  - `clean-hit` — resolved=yes; no reason to explain
  - `miss` — no ray hit at all
  - `dead` — hit a bot but `bot.alive===false`
  - `net` — MP mode, deferred to server
  - `other` — hit something that isn't a bot in a mode where damage would apply

One line per pull. Gated behind `window.__toriiFireDiag`, default ON while
chasing the missing-shots bug. `window.__toriiBotDiag` (ADR-0013) is
unaffected — the two flags are independent so users can turn each off
separately.

## Non-goals

- **No gameplay change.** Zero mutation of ray casts, damage numbers,
  authority split, or bot state. Pure observation.
- **No HP/damage/HIT-authority changes.** Same as ADR-0013 non-goals.
- **No trigger-rate change.** We only log what `shoot()` was already about to
  fire; no extra rays are cast.
- **No log deduping.** Every trigger pull logs. A high fire rate will produce
  a lot of lines — that's the point.

## Consequences

**Positive:**

- The missing-shots bug becomes visible in the log. If shots miss because the
  ray goes nowhere, we'll see `hit=none reason=miss`. If shots hit a dead bot
  because the collider is parked incorrectly, we'll see `hit=dead-bot
  reason=dead`. If shots hit terrain because the crosshair drifted, we'll see
  `hit=terrain reason=other`. Each cause has a distinct signature.
- `[FIRE]` + `[SHOT]` together give a complete audit of the shot pipeline.
  Every `resolved=yes` `[FIRE]` should be followed by exactly one `[SHOT]`,
  and vice versa; a mismatch is itself a bug.
- Cheap to strip once the investigation is done — flip
  `window.__toriiFireDiag = false` at boot.

**Negative:**

- Console noise during rapid fire. Acceptable while diagnosing; can be gated
  off later.
- Adds a small object to the `[FIRE]` composition path. No measurable perf
  cost expected (already casting the ray; we only stringify its result).

## Implementation notes

- New module `src/engine/entities/fireDiagnostics.js` exports `logShotFired(...)`.
  Mirror ADR-0013's `botDiagnostics.js` shape (independent flag, `_enabled()`
  guard, single `console.log`).
- One call site: `weapons.js::recordPlayerShot`, immediately after
  `resolveLocalHitscan(aimHit, _isNetMode())`. All the classifying data is
  already at hand: `aimHit`, its `bot` / `bodyPart`, `local` (the resolver
  result), `_isNetMode()`, `AIM_RANGE`.
- The "hit=dead-bot" branch depends on `aimHit.bot` being present even when
  `alive===false`. That is already true — the raycast physics layer only
  parks colliders at y=-100 on death; the collider→bot link isn't broken.
  If that changes, this ADR needs an amendment.
- Zone classification uses `classifyHeadshot(...)` (already imported by
  localShot.js). Reuse it locally for the log.

## Test plan

- Unit tests: `tests/fire-diagnostics.test.js`
  - `_enabled()` respects `window.__toriiFireDiag` (default ON, explicit false OFF).
  - Composition of the `[FIRE]` string matches the ADR shape for each hit type.
  - No throws on null/undefined ray inputs.
- Regression check: gate 21/21, vitest 2907 + new tests.
- Manual: play one arena round, confirm one `[FIRE]` line per click, confirm
  `[FIRE] resolved=yes` is always immediately followed by a matching
  `[SHOT] botId=<same>`.

## Rollback

Revert to v0.2.623-alpha; the diag layer is additive with no state effects.
`window.__toriiFireDiag = false` in devtools disables it at runtime without a
code change.
