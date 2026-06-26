# Torii Quest — MVP Release Package — Release Package Index

> MVP RELEASE PACKAGE INDEX · LOCAL · READ-ONLY
> generated: 2026-06-26T10:17:49.288Z

- **Version:** v0.2.224-alpha @ 54e16d5 (source)
- **Live:** https://torii-quest.pplx.app
- **Tests:** 1482 passing / 90 files

## Package files

### Release & handoff

- `RELEASE_NOTES_DRAFT.md` — MVP release notes (DRAFT) _(present)_
- `HANDOFF.generated.md` — Generated handoff brief (machine-written) _(present)_
- `HANDOFF.md` — Handoff narrative (hand-maintained) _(present)_

### Playtest

- `MVP_PLAYTEST_CHECKLIST.md` — MVP playtest checklist _(present)_
- `MVP_PLAYTEST_RESULTS_TEMPLATE.md` — MVP playtest results template _(present)_

### Status & planning

- `progress.md` — Progress dashboard (source of truth) _(present)_
- `todo.md` — Task list (source of truth) _(present)_

### Ops readiness

- `UPDATE_CHECK.md` — Update-flow readiness notes _(present)_
- `VPS_INSTALL.md` — VPS install / deploy dry-run notes _(present)_
- `ZONE_FALLBACK_READINESS.md` — Zone (/zone/*) fallback readiness _(present)_

## Recent reports

- `torii-v0.2.219-service-worker-cache-hygiene-report.md`
- `torii-v0.2.220-mvp-approval-state-report.md`
- `torii-v0.2.221-mvp-approval-dashboard-report.md`
- `torii-v0.2.222-playtest-results-intake-report.md`
- `torii-v0.2.223-playtest-results-dashboard-report.md`
- `torii-v0.2.224-playtest-note-capture-report.md`

## Known non-blocking advisories

- The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).
- SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).
- This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.

## Recommended next action

Run npm run check + npm run test:release to confirm all gates green, then hand the package to the parent agent for security review and deploy.

---

_INDEX ONLY — this document creates no GitHub release, no git tag, no public announcement, and reaches no network. The parent agent owns security review, deploy, publish, push, and Space upload._
