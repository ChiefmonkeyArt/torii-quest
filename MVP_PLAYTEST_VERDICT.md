# Torii Quest — MVP Playtest Verdict

> MVP PLAYTEST VERDICT · LOCAL · READ-ONLY · TESTER VERDICT ≠ MVP APPROVAL

The **one-line** way to report the live-browser playtest. After playing
[the live build](https://torii-quest.pplx.app), fill in the **Verdict** line below
with exactly ONE of:

- `Verdict: MVP OK` — you found no blockers.
- `Verdict: blockers: <comma- or semicolon-separated list>` — e.g.
  `Verdict: blockers: headshots feel inconsistent; NAP monkey still chases past the gate`.

Reporting a verdict here is a **confidence signal only** — it does **NOT** approve
the MVP. Approval is the separate, explicit step recorded in `MVP_APPROVAL_STATE.json`
(status `approved` + `approved_by` + `approved_at`). Leave the Verdict line blank
until you have actually played the build; a blank file reads as `pending`.

Tooling: `node tools/playtest-verdict.mjs` (or `npm run playtest:verdict`) explains
the current state read-only — it never writes, deploys, publishes, or approves.

## Verdict

| Field | Value |
| --- | --- |
| Reported by | chiefmonkey (npub1a3um269…) |
| Date | 2026-07-27 |
| Verdict | MVP OK |

## Optional notes per focus area

Use these only if you want to leave detail behind a blocker; the Verdict line above
is what the dashboard and next-action state read.

- Entry flow: OK — login, title v0.2.404-alpha, Enter transitions into arena.
- Shooter feel: GLITCH — ESC pause modal fires unprompted (without ESC key), repeatedly pausing the game. Follow-up slice.
- Hit registration / headshots: bot hit-reg inconsistent (body 2-shot / headshot 1-shot works intermittently). Deferred slice.
- Bot behaviour: GLITCH — bots don't hone/chase the player (no awareness); some bots invisible while still dealing damage. Follow-up slice.
- Movement / footsteps: OK.
- Reload feel: OK.
- Mirror / reflection: OK.
- Leaderboard: GLITCH — scores/sats don't persist to home screen after session (MP-3 publish or home-screen refresh gap). Follow-up slice.
- MP (2-npub): FIXED — both clients see each other move (PR #30 removed the owner write-authority gate on MOVE/SHOT). One signer prompt at login. Kill/respawn/avatars grounded.
- Crates:
- NAP monkey:
- Dashboard clarity:
- Subjective fun / feel:
