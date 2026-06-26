# Torii Quest — agent handoff readiness (generated)

> AGENT HANDOFF READINESS · LOCAL · READ-ONLY
> Generated artifact — do NOT hand-edit. The curated `HANDOFF.md` stays the source of truth.
> generated: 2026-06-26T02:41:51.109Z

- **Version:** v0.2.210-alpha (pkg 0.2.210-alpha)
- **Source commit:** be5eea5 (source commit at generation — precedes this file's own commit)
- **Live (manual deploy):** https://torii-quest.pplx.app
- **MVP readiness:** 100% · READY (9/9 signals)
- **Gate verdict:** READY (READY)
- **Regression:** 15 / 15 checks
- **Test profiles:** fast 5 · foundation 25 file(s)

## Smoke harnesses (pure · read-only · no network)

| Harness | SDK | Debug shell | Status | Purpose |
| --- | --- | --- | --- | --- |
| readHealth | `SDK.readHealth` | `shells.readHealth(o?)` | ok | Nostr read-path health proof over a deterministic local sample (no relay I/O). |
| gatewayTravelSmoke | `SDK.gatewayTravelSmoke` | `shells.travelSmoke(o?)` | ok | Gateway travel-contract smoke (dry-run boundary; never navigates). |
| updateFlowSmoke | `SDK.updateFlowSmoke` | `shells.updateFlowSmoke(o?)` | ok | Update-flow contract smoke over frozen fixtures (manual-only; never fetches/installs). |
| hostRouteSmoke | `SDK.hostRouteSmoke` | `shells.hostRouteSmoke(o?)` | ok | Static-host route + asset readiness smoke (no server/DNS/SSH/network). |
| mvpReadiness | `SDK.mvpReadiness` | `shells.mvpReadiness(o?)` | n/a | MVP release-readiness rollup folding the harnesses into one pct + status. |

## Next safe task

Continue the read-only oversight loop — next safe infra/dashboard/tooling slice

_Why:_ Keep shipping no-runtime-risk tooling/docs that make the MVP proof easier to read and the gate harder to get wrong. SEC-gated live-relay / world-hop / shooting work stays parked behind SEC-1/2/3 and a manual deploy — not a safe pick yet.

## Key constraints

- version bump every deploy
- godMode false
- no new setTimeout (except allowed historical exceptions)
- no new Vector3/Matrix4 in hot paths
- comments use 'nostrich'
- Chiefmonkey spelling
- debug tools ship unconditionally
- ESC pause + panel-click fire safety intact

## Verify before ship (local, no network)

- `npm run check` — static + runtime regression guardrails (must be ALL GREEN)
- `npm test` — full Vitest unit suite (pure helpers + contracts)
- `npm run release:status` — one-glance ship verdict (or release:status:json)
- `npm run test:release` — full gate: build + vitest + check + bundle + handoff

## Latest reports

- torii-v0.2.210-mvp-rc-snapshot-report.md
- torii-v0.2.209-generated-commit-stamp-clarity-report.md
- torii-v0.2.208-progress-parser-cleanup-report.md
- torii-v0.2.207-github-release-dry-run-report.md
