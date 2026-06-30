# Torii Continuum — Master TODO

> Torii Quest is the **game app**. Torii Continuum is a **separate dashboard app**. Nostr Arena is **archival history only**.

> This file is the **active task list and source of truth for Torii Continuum**. Update it whenever Continuum tasks are added, changed, completed, removed, or reprioritised.

> Continuum docs: `strategy.md` · `progress.md` · `HANDOFF.md` · `NEXT_ACTION_STATE.json`  
> Quest tasks belong in `quest-todo.md`, not here.

> Older reports (`torii-v-*.md`, Nostr Arena docs, legacy snapshots) are **archival only**. Do not use them as task queues.

### Active tasks

- Keep Continuum as the separate oversight app and do not merge its task queue back into Quest.
- Prepare Continuum to use the same safe assistant-editable .md pipeline as quest-todo.md so Continuum todo updates can be made without manual copy-editing. **BUILT v0.2.259** — `continuum-todo.md` is now in the `mdPatch` whitelist (full append/replace/note/list); `npm run md:patch -- note continuum-todo.md "..."` appends a timestamped note under "Active tasks".
- Keep Continuum work read-only / mockup-first unless a live admin action is explicitly required and approved.