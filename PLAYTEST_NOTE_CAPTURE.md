# Torii Quest — MVP Playtest Note Capture

> MVP PLAYTEST NOTE CAPTURE · LOCAL · READ-ONLY · EXPLAINER ONLY · NOT AN APPROVAL

A short guide for turning rough manual-playtest notes into the canonical
`MVP_PLAYTEST_RESULTS.md` — **without guessing, fabricating results, or implying approval**. Nothing
here runs the game, reaches the network, or deploys anything.

## The one-minute loop

1. Play the live build against `MVP_PLAYTEST_CHECKLIST.md`, jotting rough notes per item id
   (e.g. `AIM-2 head/body ok`, `MOVE-1 clipped through east wall`).
2. Open the canonical recording file `MVP_PLAYTEST_RESULTS.md` (it ships **blank** and is
   **no-clobber** — your edits are never overwritten by the artifact regen).
3. For each item, fill the **Result** cell with `PASS`, `FAIL`, or `N/A`. For a `FAIL`, also fill the
   observed **severity**, **repro notes**, and a **recommended next action**.
4. Run `npm run playtest:capture` to see, at a glance, what is still blank and which FAILs are
   missing follow-up fields.
5. Feed every `FAIL` back into `todo.md` / `progress.md` / `HANDOFF.md` by item id.

## Mapping rough notes → recorded results

| Your note sounds like…            | Record as | Then also…                                                    |
| --------------------------------- | --------- | ------------------------------------------------------------- |
| "works", "good", "fine", "ok"     | `PASS`    | nothing else required                                         |
| "broken", "bug", "crash", "wrong" | `FAIL`    | record **severity** (blocker / major / minor) + **next action** |
| "not applicable", "skipped", "n/a"| `N/A`     | nothing else required                                         |
| not tested yet                    | *(blank)* | leave the cell empty — it stays "not recorded"                |

Severities: **blocker** (must fix before MVP) · **major** (significant, may still ship with a note) ·
**minor** (polish / nice-to-have).

## How the status is derived

`npm run playtest:capture` (and the Continuum dashboard card) read the file and report one coarse
status:

- **unknown** — no recognised checklist items found.
- **not-run** — every item is blank (the shipped default).
- **incomplete** — some items recorded, at least one still blank/unrecognised.
- **attention** — every-or-some item recorded and **at least one FAIL** — address these first.
- **complete** — every item recorded `PASS` / `N/A` with no failures (the playtest itself is clean).

## This is never an approval

A fully-recorded, all-`PASS` playtest is **necessary but not sufficient** for MVP approval. The
explicit user "MVP approved" decision (recorded in `MVP_APPROVAL_STATE.json`) is a **separate,
deliberate gate**. Every tool in this flow pins `approvalImplied: false`; recording results never
flips approval. The parent agent owns security review, deploy, publish, push, and Space upload.

## Commands

- `npm run playtest:capture` — read-only explainer: what is still blank + the note→result mapping.
- `npm run playtest:capture -- --json` — same, machine-readable.
- `npm run playtest:status` — the compact recorded-state summary (also `-- --json`).
- `npm run playtest:status -- --write` — create the blank canonical record if it does not yet exist
  (no-clobber).
