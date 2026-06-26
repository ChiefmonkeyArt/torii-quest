# Torii Quest — Release Artifact Manifest

> RELEASE ARTIFACT MANIFEST · LOCAL · READ-ONLY
> generated: 2026-06-26T10:17:54.893Z

- **Status:** COMPLETE
- **Version:** v0.2.224-alpha @ 54e16d5 (source)
- **Package version:** 0.2.224-alpha
- **Live (manual deploy):** https://torii-quest.pplx.app
- **Coverage:** 6/6 required present · 6/6 optional present · 12 hashed

## Required artifacts

| Artifact | Label | Category | Present | sha256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `RELEASE_NOTES_DRAFT.md` | MVP release notes (DRAFT) | doc | present | `3eb34f67f0c7` | 2851 |
| `MVP_RELEASE_PACKAGE.md` | MVP release package index | doc | present | `70c1068a83c9` | 2108 |
| `GITHUB_RELEASE_DRY_RUN.md` | GitHub release dry-run | doc | present | `290f1a17951c` | 2578 |
| `public/release-metadata.json` | Build / release metadata (served) | build-metadata | present | `908752e92a71` | 1158 |
| `package.json` | Package manifest (version + scripts) | config | present | `a2036c570e1a` | 2000 |
| `index.html` | App entry (version-stamped) | config | present | `b424bc53413d` | 37374 |

## Optional artifacts

| Artifact | Label | Category | Present | sha256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `MVP_RC_SNAPSHOT.md` | MVP RC freeze-candidate snapshot | doc | present | `650a90d70cf4` | 4112 |
| `MVP_PLAYTEST_CHECKLIST.md` | MVP playtest checklist | doc | present | `164846d74874` | 11004 |
| `MVP_PLAYTEST_RESULTS_TEMPLATE.md` | MVP playtest results template | doc | present | `55d9b54b017a` | 8581 |
| `HANDOFF.md` | Handoff narrative (source of truth) | doc | present | `c80de8c06c32` | 111955 |
| `VPS_INSTALL.md` | VPS install / manual deploy notes | doc | present | `05127e4b7b25` | 22754 |
| `public/continuum-data.json` | Continuum dashboard data (served) | build-metadata | present | `bc5ef0ac7159` | 19409 |

## How this supports release integrity / self-update

- Each artifact carries a sha256 + byte size captured at generation time, so a future release/self-update step can verify the shipped copy matches what was committed (no silent drift).
- The REQUIRED list is the minimum set a GitHub release / VPS self-update must resolve; an INCOMPLETE verdict means a future release would be blocked until the missing artifact is restored.
- Checksums cover in-repo text docs + small served build-metadata JSON only — no secrets, no large binaries (the rapier chunk and other dist/ bundles are intentionally not hashed here).
- This manifest is a VISIBILITY artifact: it performs no release, no tag, no publish, no network self-update. The parent agent owns security review, deploy, publish, push, and Space upload.

## Recent reports

- `torii-v0.2.219-service-worker-cache-hygiene-report.md`
- `torii-v0.2.220-mvp-approval-state-report.md`
- `torii-v0.2.221-mvp-approval-dashboard-report.md`
- `torii-v0.2.222-playtest-results-intake-report.md`
- `torii-v0.2.223-playtest-results-dashboard-report.md`
- `torii-v0.2.224-playtest-note-capture-report.md`

---

_MANIFEST ONLY — this document creates no GitHub release, no git tag, no publish, no network self-update. Checksums cover in-repo text docs + small served build metadata only (no secrets, no large binaries). The parent agent owns security review, deploy, publish, push, and Space upload._
