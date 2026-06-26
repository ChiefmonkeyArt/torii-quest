# Torii Quest — MVP Release Package — Release Package Index

> MVP RELEASE PACKAGE INDEX · LOCAL · READ-ONLY
> generated: 2026-06-26T16:03:10.204Z

- **Version:** v0.2.228-alpha @ 2a20ee0 (source)
- **Live:** https://torii-quest.pplx.app
- **Tests:** 1505 passing / 92 files

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

- `torii-v0.2.222-playtest-results-intake-report.md`
- `torii-v0.2.223-playtest-results-dashboard-report.md`
- `torii-v0.2.224-playtest-note-capture-report.md`
- `torii-v0.2.225-playtest-capture-path-hardening-report.md`
- `torii-v0.2.226-entry-flow-button-fix-report.md`
- `torii-v0.2.227-entry-flow-smoke-harness-report.md`

## Known non-blocking advisories

- The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).
- SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).
- This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.

## Recommended next action

Run npm run check + npm run test:release to confirm all gates green, then hand the package to the parent agent for security review and deploy.

---

_INDEX ONLY — this document creates no GitHub release, no git tag, no public announcement, and reaches no network. The parent agent owns security review, deploy, publish, push, and Space upload._
