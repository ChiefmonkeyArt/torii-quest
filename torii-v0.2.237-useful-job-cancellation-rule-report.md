# Torii Quest — v0.2.237-alpha · Useful-Job Cancellation Rule (Workflow-Invariant Slice)

**Verdict: SHIP** · status/dashboard/docs-only · no runtime/gameplay/physics/Nostr/gateway change.

## What & why

The user issued an important workflow rule after a useful in-progress job was cancelled:

> Never cancel useful jobs halfway through if they are useful or do not conflict with an
> immediate user request, unless the user explicitly asks to cancel, or the work can be
> safely resumed from where it left off. Cancelling useful jobs wastes compute time and
> money. Instead, finish the useful in-progress job, then process the user's next request.
> A stale/hung job whose output has already been committed, shipped, pushed, synced, and
> smoke-tested may be stopped to avoid further waste.

This slice records that rule as a standing **workflow invariant** on the Continuum
handoff/status surfaces so future agents and humans see it on pickup. No behavior changes.

## The rule on the surface (with its four exceptions)

THE RULE: do NOT cancel a useful in-progress job halfway through — finish it first, THEN
process the user's next request (cancelling useful work wastes compute time and money).

FOUR EXCEPTIONS:
1. the user EXPLICITLY asks to cancel;
2. the in-progress work CONFLICTS with an immediate user request;
3. the work can be SAFELY RESUMED from where it left off;
4. a STALE/HUNG job whose output has already been committed, shipped, pushed, synced, and
   smoke-tested may be stopped to avoid further waste.

## Changes

### Source of truth (PURE, node-safe)
- `src/engine/status/handoffControlPanel.js`
  - New frozen `WORKFLOW_INVARIANTS` export (the rule + its four exceptions; non-religious).
  - Folded through the builder signature/body (curated defaults fold back in when handed an
    empty array — the surface is never empty), the validator (a RAW panel object genuinely
    carrying no invariants is an ERROR), `HANDOFF_CONTROL_PANEL_REQUIRED_KEYS`,
    `summarizeHandoffControlPanelForState` (count; never implies approval), and the dashboard
    card (`Workflow invariants` metric).

### Generated / machine-readable surface
- `tools/nextActionState.mjs` — imports `WORKFLOW_INVARIANTS`, carries a `workflowInvariants`
  field (process guidance only — implies no approval/deploy/runtime change), adds it to
  `NEXT_ACTION_STATE_REQUIRED_KEYS`, and prints it in both the text and markdown formatters.
- `NEXT_ACTION_STATE.json` regenerated (`npm run handoff:next -- --write`): version
  v0.2.237-alpha, tests 1640/98, `workflowInvariants` length 5.

### Docs
- `HANDOFF.md` — Current version → v0.2.237-alpha; new v0.2.237 changelog entry.
- `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md` — version markers + a handoffControlPanel note.
- `todo.md` (HARD-51) and `progress.md` — version header, test counts, active slice.

### Tests (+11 → suite 1629 → 1640, files 98)
- `tests/handoff-control-panel.test.js` (+7): frozen array with rule + four exceptions; built
  panel carries them by default; builder folds defaults on `[]`; a RAW `workflowInvariants:[]`
  object is a validator ERROR; summary folds the count and never implies approval; the card
  surfaces a Workflow invariants metric; curated copy is non-religious.
- `tests/next-action-state.test.js` (+3): carries the invariants verbatim; required key
  present; honours a caller-supplied trimmed/non-empty array. Plus formatter assertions.
- `tests/continuum-dashboard.test.js` (+1): the rendered handoff card surfaces the metric and
  the panel still reads HANDOFF READY.

## Version markers bumped to v0.2.237-alpha
`src/config.js`, `package.json`, `index.html` (×2), `public/sw.js` (`tq-v0.2.237-alpha`),
`tools/regression-check.mjs` (EXPECTED_VERSION), `MVP_APPROVAL_STATE.json`,
`src/engine/dashboard/continuumData.js` (CONTINUUM_VERSION + Source version + Active slice;
CURRENT_TEST_STATUS 1640/98), `src/engine/status/mvpReadiness.js` (DEFAULT_TEST_STATUS 1640/98).

## Verification (`npm run test:release`)
- `npm run build` — clean.
- Vitest — **1640 passed (1640) / 98 files (98)**.
- `npm run check` — **ALL GREEN** (15/15; docConsistency confirms 5 docs reference v0.2.237-alpha).
- `npm run bundle:report` — advisory only (rapier chunk over 700 KB, expected/tracked).
- `npm run handoff:status` — config v0.2.237-alpha; package.json in sync.

## Hard constraints — all held
`godMode` stays false. No new `setTimeout`/`Vector3`/`Matrix4`. Comments use "nostrich".
Chiefmonkey spelling exact. Debug tools ship unconditionally. Non-religious ethics guard
intact (the curated invariants contain no flagged language). No deploy/publish/push — the
parent agent handles those. The invariants are process guidance only: they imply no approval,
no deployment, and no runtime behaviour change; `impliesApproval`/`impliesPlaytestComplete`
and every safety flag stay pinned false; MVP status stays not-run/pending.

**SHIP.**
