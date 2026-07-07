# Torii Quest — Release Artifact Manifest

> RELEASE ARTIFACT MANIFEST · LOCAL · READ-ONLY
> generated: 2026-06-26T18:29:16.749Z

- **Status:** COMPLETE
- **Version:** v0.2.232-alpha @ aba849c (source)
- **Package version:** 0.2.232-alpha
- **Live (manual deploy):** https://torii-quest.pplx.app
- **Coverage:** 6/6 required present · 6/6 optional present · 12 hashed

## Required artifacts

| Artifact | Label | Category | Present | sha256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `RELEASE_NOTES_DRAFT.md` | MVP release notes (DRAFT) | doc | present | `a887f058bcee` | 2845 |
| `MVP_RELEASE_PACKAGE.md` | MVP release package index | doc | present | `f71fa23f327b` | 2101 |
| `GITHUB_RELEASE_DRY_RUN.md` | GitHub release dry-run | doc | present | `155fb63da188` | 2578 |
| `public/release-metadata.json` | Build / release metadata (served) | build-metadata | present | `e3851a345b01` | 1158 |
| `package.json` | Package manifest (version + scripts) | config | present | `0372ac848877` | 2117 |
| `index.html` | App entry (version-stamped) | config | present | `732d465935be` | 41168 |

## Optional artifacts

| Artifact | Label | Category | Present | sha256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `MVP_RC_SNAPSHOT.md` | MVP RC freeze-candidate snapshot | doc | present | `582aafa7fdc6` | 4105 |
| `MVP_PLAYTEST_CHECKLIST.md` | MVP playtest checklist | doc | present | `e09e52f146ab` | 11004 |
| `MVP_PLAYTEST_RESULTS_TEMPLATE.md` | MVP playtest results template | doc | present | `1d935b55d46c` | 8581 |
| `HANDOFF.md` | Handoff narrative (source of truth) | doc | present | `e4ca65f3b121` | 130389 |
| `VPS_INSTALL.md` | VPS install / manual deploy notes | doc | present | `05127e4b7b25` | 22754 |
| `public/torii-quest-data.json` | Continuum dashboard data (served) | build-metadata | present | `4756982c5d88` | 19409 |

## How this supports release integrity / self-update

- Each artifact carries a sha256 + byte size captured at generation time, so a future release/self-update step can verify the shipped copy matches what was committed (no silent drift).
- The REQUIRED list is the minimum set a GitHub release / VPS self-update must resolve; an INCOMPLETE verdict means a future release would be blocked until the missing artifact is restored.
- Checksums cover in-repo text docs + small served build-metadata JSON only — no secrets, no large binaries (the rapier chunk and other dist/ bundles are intentionally not hashed here).
- This manifest is a VISIBILITY artifact: it performs no release, no tag, no publish, no network self-update. The parent agent owns security review, deploy, publish, push, and Space upload.

## Recent reports

- `torii-v0.2.226-entry-flow-button-fix-report.md`
- `torii-v0.2.227-entry-flow-smoke-harness-report.md`
- `torii-v0.2.228-enter-arena-noop-fix-report.md`
- `torii-v0.2.229-entry-status-visibility-fix-report.md`
- `torii-v0.2.230-entry-flow-runtime-fix-report.md`
- `torii-v0.2.231-live-smoke-status-report.md`

---

_MANIFEST ONLY — this document creates no GitHub release, no git tag, no publish, no network self-update. Checksums cover in-repo text docs + small served build metadata only (no secrets, no large binaries). The parent agent owns security review, deploy, publish, push, and Space upload._
