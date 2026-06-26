# Torii Quest — Release Artifact Manifest

> RELEASE ARTIFACT MANIFEST · LOCAL · READ-ONLY
> generated: 2026-06-26T09:30:58.646Z

- **Status:** COMPLETE
- **Version:** v0.2.222-alpha @ 8fc41e8 (source)
- **Package version:** 0.2.222-alpha
- **Live (manual deploy):** https://torii-quest.pplx.app
- **Coverage:** 6/6 required present · 6/6 optional present · 12 hashed

## Required artifacts

| Artifact | Label | Category | Present | sha256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `RELEASE_NOTES_DRAFT.md` | MVP release notes (DRAFT) | doc | present | `0c7d63e3cb8d` | 2850 |
| `MVP_RELEASE_PACKAGE.md` | MVP release package index | doc | present | `8921067ff304` | 2093 |
| `GITHUB_RELEASE_DRY_RUN.md` | GitHub release dry-run | doc | present | `a4f6a4ebd9b7` | 2578 |
| `public/release-metadata.json` | Build / release metadata (served) | build-metadata | present | `aaa8d1f723da` | 1158 |
| `package.json` | Package manifest (version + scripts) | config | present | `2bb3ae608ab2` | 1941 |
| `index.html` | App entry (version-stamped) | config | present | `6853119c8c39` | 37374 |

## Optional artifacts

| Artifact | Label | Category | Present | sha256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `MVP_RC_SNAPSHOT.md` | MVP RC freeze-candidate snapshot | doc | present | `5056b907374d` | 4097 |
| `MVP_PLAYTEST_CHECKLIST.md` | MVP playtest checklist | doc | present | `9f453d089964` | 11004 |
| `MVP_PLAYTEST_RESULTS_TEMPLATE.md` | MVP playtest results template | doc | present | `ec8ffa3a9b5f` | 8581 |
| `HANDOFF.md` | Handoff narrative (source of truth) | doc | present | `c898de118e05` | 107683 |
| `VPS_INSTALL.md` | VPS install / manual deploy notes | doc | present | `05127e4b7b25` | 22754 |
| `public/continuum-data.json` | Continuum dashboard data (served) | build-metadata | present | `abf0599c3ecf` | 17670 |

## How this supports release integrity / self-update

- Each artifact carries a sha256 + byte size captured at generation time, so a future release/self-update step can verify the shipped copy matches what was committed (no silent drift).
- The REQUIRED list is the minimum set a GitHub release / VPS self-update must resolve; an INCOMPLETE verdict means a future release would be blocked until the missing artifact is restored.
- Checksums cover in-repo text docs + small served build-metadata JSON only — no secrets, no large binaries (the rapier chunk and other dist/ bundles are intentionally not hashed here).
- This manifest is a VISIBILITY artifact: it performs no release, no tag, no publish, no network self-update. The parent agent owns security review, deploy, publish, push, and Space upload.

## Recent reports

- `torii-v0.2.217-next-action-state-report.md`
- `torii-v0.2.218-package-private-report.md`
- `torii-v0.2.219-service-worker-cache-hygiene-report.md`
- `torii-v0.2.220-mvp-approval-state-report.md`
- `torii-v0.2.221-mvp-approval-dashboard-report.md`
- `torii-v0.2.222-playtest-results-intake-report.md`

---

_MANIFEST ONLY — this document creates no GitHub release, no git tag, no publish, no network self-update. Checksums cover in-repo text docs + small served build metadata only (no secrets, no large binaries). The parent agent owns security review, deploy, publish, push, and Space upload._
