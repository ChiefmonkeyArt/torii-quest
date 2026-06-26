# Torii Quest — MVP RC Snapshot — RC Freeze-Candidate Snapshot

> MVP RC SNAPSHOT · FREEZE CANDIDATE · LOCAL · READ-ONLY
> generated: 2026-06-26T10:17:54.179Z

- **Status:** FREEZE-CANDIDATE
- **Version:** v0.2.224-alpha @ 54e16d5 (source)
- **Live (manual deploy):** https://torii-quest.pplx.app
- **Version consistency:** ok

## RC gate

- **Status:** READY (100%)
- **Candidate:** yes

## MVP readiness

- **Readiness:** 100% · READY (9/9 signals)
- **Tests:** 1482 passing / 90 files (full)
- **Regression:** 15 / 15 checks

## GitHub release dry-run

- **Status:** near
- **Ready:** no
- _missing:_ Tests + RC gate green (npm run test:release)
- _missing:_ Working tree clean (all changes committed)
- _missing:_ HEAD commit pushed to remote

## RC package docs

- `RELEASE_NOTES_DRAFT.md` — MVP release notes (DRAFT) _(present)_
- `MVP_RELEASE_PACKAGE.md` — MVP release package index _(present)_
- `GITHUB_RELEASE_DRY_RUN.md` — GitHub release dry-run _(present)_
- `MVP_PLAYTEST_CHECKLIST.md` — MVP playtest checklist _(present)_
- `MVP_PLAYTEST_RESULTS_TEMPLATE.md` — MVP playtest results template _(present)_
- `HANDOFF.md` — Handoff narrative (source of truth) _(present)_
- `VPS_INSTALL.md` — VPS install / manual deploy notes _(present)_

## Still needs manual user validation

- [ ] Launch the live build and confirm the title screen shows the current version with no blocking console errors.
- [ ] Run the core shooter loop (shoot → hit → respawn); confirm ESC pauses instantly and a panel-locked cursor click never fires the weapon.
- [ ] Cross the torii gate into the NAP zone and confirm the weapon disables (peace) and bots do not follow across the gate.
- [ ] Open the read-only Nostr surfaces (read health / profile / leaderboard) and confirm they load with NO signing or publishing path exposed.
- [ ] Activate the gateway portal and confirm a travel-confirm shell appears (not a silent jump); confirm a malformed /zone/<slug> falls back safely.
- [ ] Open /continuum.html and /release-metadata.json on the live build; confirm version + test counts match the title screen and the update prompt is read-only.
- [ ] Walk through MVP_PLAYTEST_CHECKLIST.md and record results in MVP_PLAYTEST_RESULTS_TEMPLATE.md — any open blocker stops MVP-proof sign-off.

## To turn this into a real GitHub release/tag

_All git/release/deploy steps below are gated on explicit user approval and NONE run here._

- Confirm the release commit is committed and pushed to origin (the parent agent owns the push).
- Run `npm run test:release` and confirm the full gate is green.
- Complete the manual playtest validation above with no open blocker.
- With explicit user approval, cut the annotated tag (`git tag -a vX.Y.Z-alpha …`) — TEXT ONLY here, not run.
- With explicit user approval, push the tag and create the GitHub release from RELEASE_NOTES_DRAFT.md — TEXT ONLY here, not run.
- Deploy the built dist/ to the live host via the manual VPS flow (VPS_INSTALL.md) — no auto-update, no DNS/SSH from this repo tooling.

> **APPROVAL GATE:** Manual user approval is REQUIRED before any git tag, git push --tags, gh release, or publish. A READY verdict means the local prerequisites are met — NOT that a release should be cut.

## Known non-blocking advisories

- The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).
- SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).
- This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.

## Recent reports

- `torii-v0.2.219-service-worker-cache-hygiene-report.md`
- `torii-v0.2.220-mvp-approval-state-report.md`
- `torii-v0.2.221-mvp-approval-dashboard-report.md`
- `torii-v0.2.222-playtest-results-intake-report.md`
- `torii-v0.2.223-playtest-results-dashboard-report.md`
- `torii-v0.2.224-playtest-note-capture-report.md`

---

_SNAPSHOT ONLY — this document creates no GitHub release, no git tag, no public announcement, and reaches no network. The parent agent owns security review, deploy, publish, push, and Space upload._
