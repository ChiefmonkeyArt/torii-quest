# Torii Quest — GitHub MVP Release Dry-Run

> GITHUB RELEASE DRY-RUN · LOCAL · READ-ONLY · NO TAG / NO RELEASE
> generated: 2026-06-26T18:05:04.501Z

- **Verdict:** NEAR
- **Version:** v0.2.231-alpha @ a86d7d7 (source)
- **package.json:** 0.2.231-alpha
- **Live:** https://torii-quest.pplx.app

## Prerequisites

- ✓ Current version stamped (config.js VERSION) — _ok_: v0.2.231-alpha
- ✓ config VERSION matches package.json — _ok_: v0.2.231-alpha == v0.2.231-alpha
- • Working tree clean (all changes committed) _(soft)_ — _pending_: uncommitted changes present
- ? HEAD commit pushed to remote _(soft)_ — _unknown_: push status not checked (no network)
- ✓ Release notes draft present (RELEASE_NOTES_DRAFT.md) — _ok_: RELEASE_NOTES_DRAFT.md present
- ✓ Release package index present (MVP_RELEASE_PACKAGE.md) — _ok_: MVP_RELEASE_PACKAGE.md present
- ? Tests + RC gate green (npm run test:release) — _unknown_: run npm run test:release to confirm
- ✓ Public live URL known — _ok_: https://torii-quest.pplx.app
- ✓ Release metadata non-actionable (no autoUpdate) — _ok_: metadata non-actionable

## Missing / not-yet-satisfied

- Tests + RC gate green (npm run test:release) _(unknown)_
- Working tree clean (all changes committed) _(pending)_
- HEAD commit pushed to remote _(unknown)_

## Known non-blocking advisories

- The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).
- SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).
- This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.

## Suggested FUTURE manual commands

> TEXT ONLY — none of these are executed by this tool. **Do not run without explicit user approval.**

```sh
# annotate the release commit — DO NOT run without user approval
git tag -a v0.2.231-alpha -m "Torii Quest v0.2.231-alpha (MVP proof)"
# publish the tag — DO NOT run without user approval
git push origin v0.2.231-alpha
# create the GitHub release — DO NOT run without user approval
gh release create v0.2.231-alpha --notes-file RELEASE_NOTES_DRAFT.md --title "Torii Quest v0.2.231-alpha"
```

## Approval gate

Manual user approval is REQUIRED before any git tag, git push --tags, gh release, or publish. A READY verdict means the local prerequisites are met — NOT that a release should be cut.

---

_DRY-RUN ONLY — this document creates no git tag, no GitHub release, no push, no publish, and reaches no network. The parent agent owns security review, deploy, publish, push, and Space upload._
