# Torii Quest — Master TODO (LEGACY POINTER)

> **This file is a LEGACY POINTER.** The active task queues have been split into
> separate sources of truth. Do not plan new work from this file.

Current version: `v0.2.262-alpha`
Live site: [torii-quest.pplx.app](https://torii-quest.pplx.app)

## Source of truth (active task queues)

- `quest-todo.md` — **Torii Quest** (game app) active task source of truth.
- `continuum-todo.md` — **Torii Continuum** (oversight dashboard app) active task source of truth.
- `strategy.md` — shared strategy and decision rules.
- `progress.md` — Torii Quest progress dashboard.
- `HANDOFF.md` / `CODE_INDEX.md` — contributor + agent onboarding and runtime index.

`NOSTR_ARENA_MASTER_TODO.md` and the `torii-v*-report.md` files are **archival
history only** — do not use them as an active task queue.

## Why this file still exists

The regression gate (`tools/docConsistency.mjs`, check `[14]`) and the Continuum
build (`tools/build-continuum.mjs`) treat `todo.md` as a continuity doc: it must
exist and carry the current version, and `tools/continuumParse.mjs` counts the
historical struck-through completed-task markers below for the dashboard's
completed-task metric. The active task sections that used to live here have moved
to `quest-todo.md` / `continuum-todo.md`; what remains is the historical
completed record (preserved verbatim as struck markers so the dashboard count
does not silently change). The full pre-split content is retained in git history.

## Historical completed (archive)

These items are DONE and kept only as struck markers for the Continuum
dashboard's completed-task count. Details are in `progress.md` and git history.

- ~~ARS-1~~ ~~Debug dump / handoff snapshot (`engine/debug/snapshot.js`). DONE v0.2.130.~~
- ~~ARS-2~~ ~~Physics interaction API (`engine/physics/interactions.js`). DONE v0.2.130.~~
- ~~ARS-3~~ ~~Rapier raycast service (`engine/physics/raycastService.js`), migration complete v0.2.133.~~
- ~~ARS-5~~ ~~SDK/API skeleton (`src/sdk/index.js`). DONE v0.2.131.~~
- ~~ARS-7~~ ~~Handoff template (`HANDOFF.md`). DONE v0.2.130.~~
- ~~TESTPROF-1~~ ~~Test profile system (`tools/testProfiles.mjs`). DONE v0.2.173.~~
