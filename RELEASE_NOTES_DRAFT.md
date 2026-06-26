# Torii Quest — MVP Proof-of-Concept — Release Notes (DRAFT)

> MVP PROOF RELEASE NOTES · DRAFT · LOCAL · READ-ONLY
> generated: 2026-06-26T04:26:09.104Z

- **Version:** v0.2.215-alpha @ 1cb964c (source)
- **Live:** https://torii-quest.pplx.app
- **Release candidate:** YES (READY, 100%)
- **MVP readiness:** 100% · READY

## What has been built

### Shooter proof loop

- A playable first-person arena proof: pointer-lock controls, ESC instant-pause, and a kill-feed HUD.
- Rapier3D physics-backed movement and projectile resolution in a bounded test arena.
- Panel-locked cursor clicks never fire the weapon — pause/menu interaction is fire-safe.

### Nostr read / profile / leaderboard proof surfaces

- Read-only Nostr surfaces: live read health, profile lookup, and a leaderboard proof view.
- No signing and no publishing in this proof — write paths stay gated behind the SEC review.
- A nostrich-friendly relay read path with bounded WS handling.

### Gateway travel shell

- A gateway/portal travel shell that routes between zones with a /zone/* fallback.
- Host-route and gateway-travel smoke harnesses confirm the shell resolves without a live server.

### Update / VPS readiness

- An update-flow smoke harness and a VPS dry-run that validate deploy readiness locally.
- No live updater, DNS, SSH, or server action runs in this proof — all checks are read-only.

### Continuum dashboard

- A generated Continuum dashboard surfacing version, test status, active slices, and recent work.
- Built from progress.md and the status rollups; regenerated as part of the build.

### SDK / debug handoff surfaces

- A ToriiDebug shell + SDK status surfaces, shipped unconditionally for inspection.
- Local handoff exports (handoff summary, agent handoff, MVP release-candidate gate) let a next agent continue without reading the whole repo.

### Tests / guardrails

- A full Vitest unit suite over the pure helpers and contracts.
- A static + runtime regression gate (npm run check) and a release gate (npm run test:release).
- Version-sync, zone-fallback, docs-consistency, and bundle-baseline guardrails.

## Known non-blocking advisories

- The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).
- SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).
- This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.

## Recent reports

- torii-v0.2.215-manual-validation-dashboard-report.md
- torii-v0.2.214-continuum-rc-status-report.md
- torii-v0.2.213-shellless-release-tooling-report.md
- torii-v0.2.212-release-manifest-shellless-report.md

---

_DRAFT ONLY — this document creates no GitHub release, no git tag, no public announcement, and reaches no network. The parent agent owns security review, deploy, publish, push, and Space upload._
