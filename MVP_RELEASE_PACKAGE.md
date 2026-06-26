# Torii Quest — MVP Release Package — Release Package Index

> MVP RELEASE PACKAGE INDEX · LOCAL · READ-ONLY
> generated: 2026-06-26T01:13:05.956Z

- **Version:** v0.2.206-alpha @ d45f1d2
- **Live:** https://torii-quest.pplx.app
- **Tests:** 1316 passing / 83 files

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

- `torii-v0.2.200-dashboard-metric-freshness-report.md`
- `torii-v0.2.201-mvp-rc-gate-report.md`
- `torii-v0.2.202-release-notes-draft-report.md`
- `torii-v0.2.203-mvp-playtest-checklist-report.md`
- `torii-v0.2.204-playtest-results-template-report.md`
- `torii-v0.2.205-playtest-doc-warning-cleanup-report.md`

## Known non-blocking advisories

- The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).
- SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).
- This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.

## Recommended next action

Run npm run check + npm run test:release to confirm all gates green, then hand the package to the parent agent for security review and deploy.

---

_INDEX ONLY — this document creates no GitHub release, no git tag, no public announcement, and reaches no network. The parent agent owns security review, deploy, publish, push, and Space upload._
