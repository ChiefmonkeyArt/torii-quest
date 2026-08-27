# ADR-0075 — Arena server: SERVER_VERSION constant bumped by bump-ver.sh

- **Status:** Accepted
- **Date:** 2026-08-27
- **Version:** v0.2.709-alpha
- **Component:** `server/arena-ws.js` (arena multiplayer server) + `tools/bump-ver.sh`

## Context

A collaborator's freshly installed arena server reported `serverVersion v0.2.602-alpha` in its WebSocket HELLO message, even though the release was built from tag `v0.2.706-alpha` and the repo's package.json/src/config.js all said `0.2.706-alpha`. Initial diagnosis was a stale build (dist built from an older checkout). On reading the source, the real root cause was different and affected every install including chiefmonkey's own production instance:

`server/arena-ws.js` line 69 hardcodes the server version as a literal:

```js
const SERVER_VERSION = 'v0.2.602-alpha';
```

`bump-ver.sh` (the release version-bump tool) never included `server/arena-ws.js` in its sed file list. So every version bump (706, 707, 708) updated package.json, src/config.js, index.html, public assets, and state files — but left the arena server's version constant stuck at `v0.2.602-alpha`. The same class of gap as `src/engine/dashboard/toriiQuestDashboardData.js` and `tools/regression-check.mjs` (both already known to need manual bumps), but for the server bundle.

## Decision

1. **Add `server/arena-ws.js` to `bump-ver.sh`'s sed file list** so the `SERVER_VERSION` literal is bumped automatically on every future release, alongside the other version-bearing files.
2. **Bump `SERVER_VERSION` to `v0.2.709-alpha`** to match the current release.
3. Continue manually bumping the two files bump-ver.sh still doesn't reach (`toriiQuestDashboardData.js`, `regression-check.mjs`) — those remain a known gap; a future ADR may fold them in.

## Security / privacy

No security or privacy impact. The version string is already sent to every connecting client in the HELLO message; this change only makes it accurate.

## Trade-offs

- Bumping the constant via bump-ver.sh means the sed regex must match the `SERVER_VERSION = 'v0.2.NNN-alpha'` form. The existing regex (`v0\.2\.[0-9][0-9][0-9](-[a-z]*)?-alpha`) matches this, so no regex change is needed.
- The two remaining manually-bumped files are unchanged — this ADR does not attempt to fix every bump-ver gap, only the arena server one that caused the reported discrepancy.

## Test / verification

- `bash -n tools/bump-ver.sh` — syntax clean.
- `grep "SERVER_VERSION = " server/arena-ws.js` → `v0.2.709-alpha` after bump.
- Full suite + `npm run check` (version-consistency gate expects v0.2.709-alpha).

## Consequences

- A rebuilt arena server from v0.2.709-alpha onward reports the correct version in its HELLO.
- Future releases no longer leave the arena server version stranded at an old value.
- `main` is fast-forwarded to `v0.2.709-alpha`.
