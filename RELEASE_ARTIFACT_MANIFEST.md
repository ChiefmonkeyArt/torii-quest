# Torii Quest — Release Artifact Manifest

> RELEASE ARTIFACT MANIFEST · LOCAL · READ-ONLY
> generated: 2026-06-26T04:26:15.962Z

- **Status:** COMPLETE
- **Version:** v0.2.215-alpha @ 1cb964c (source)
- **Package version:** 0.2.215-alpha
- **Live (manual deploy):** https://torii-quest.pplx.app
- **Coverage:** 6/6 required present · 6/6 optional present · 12 hashed

## Required artifacts

| Artifact | Label | Category | Present | sha256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `RELEASE_NOTES_DRAFT.md` | MVP release notes (DRAFT) | doc | present | `dae2e20a6542` | 2856 |
| `MVP_RELEASE_PACKAGE.md` | MVP release package index | doc | present | `cafe62d165ec` | 2107 |
| `GITHUB_RELEASE_DRY_RUN.md` | GitHub release dry-run | doc | present | `df7081892b30` | 2578 |
| `public/release-metadata.json` | Build / release metadata (served) | build-metadata | present | `eea94be3d1be` | 1158 |
| `package.json` | Package manifest (version + scripts) | config | present | `34d649722b8c` | 1742 |
| `index.html` | App entry (version-stamped) | config | present | `2427023e9d7d` | 37374 |

## Optional artifacts

| Artifact | Label | Category | Present | sha256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `MVP_RC_SNAPSHOT.md` | MVP RC freeze-candidate snapshot | doc | present | `b82a9a26a5aa` | 4111 |
| `MVP_PLAYTEST_CHECKLIST.md` | MVP playtest checklist | doc | present | `e8c4638f5bfa` | 11004 |
| `MVP_PLAYTEST_RESULTS_TEMPLATE.md` | MVP playtest results template | doc | present | `c48d880f049a` | 8581 |
| `HANDOFF.md` | Handoff narrative (source of truth) | doc | present | `5753969b73a1` | 92145 |
| `VPS_INSTALL.md` | VPS install / manual deploy notes | doc | present | `05127e4b7b25` | 22754 |
| `public/continuum-data.json` | Continuum dashboard data (served) | build-metadata | present | `0a8dc85d4333` | 14035 |

## How this supports release integrity / self-update

- Each artifact carries a sha256 + byte size captured at generation time, so a future release/self-update step can verify the shipped copy matches what was committed (no silent drift).
- The REQUIRED list is the minimum set a GitHub release / VPS self-update must resolve; an INCOMPLETE verdict means a future release would be blocked until the missing artifact is restored.
- Checksums cover in-repo text docs + small served build-metadata JSON only — no secrets, no large binaries (the rapier chunk and other dist/ bundles are intentionally not hashed here).
- This manifest is a VISIBILITY artifact: it performs no release, no tag, no publish, no network self-update. The parent agent owns security review, deploy, publish, push, and Space upload.

## Recent reports

- `torii-v0.2.210-mvp-rc-snapshot-report.md`
- `torii-v0.2.211-release-artifact-manifest-report.md`
- `torii-v0.2.212-release-manifest-shellless-report.md`
- `torii-v0.2.213-shellless-release-tooling-report.md`
- `torii-v0.2.214-continuum-rc-status-report.md`
- `torii-v0.2.215-manual-validation-dashboard-report.md`

---

_MANIFEST ONLY — this document creates no GitHub release, no git tag, no publish, no network self-update. Checksums cover in-repo text docs + small served build metadata only (no secrets, no large binaries). The parent agent owns security review, deploy, publish, push, and Space upload._
