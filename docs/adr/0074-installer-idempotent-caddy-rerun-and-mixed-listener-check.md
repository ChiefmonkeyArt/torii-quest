# ADR-0074 — Installer: idempotent Caddy managed-block rerun + strict mixed-listener port check

- **Status:** Accepted
- **Date:** 2026-08-27
- **Version:** v0.2.708-alpha
- **Component:** Bare-metal installer — `install.sh` (port preflight) + `install/lib/bare-metal.sh` (`write_caddy_site_block`)

## Context

Reviewing ADR-0073's fixes (allow the operator's own system Caddy on 80/443; fix the invalid top-level `email` directive) surfaced two further gaps, caught before either shipped to a live install:

1. **Marker-strip regex didn't match the marker it strips.** `write_caddy_site_block` strips a prior managed block with `awk '/^# TORII QUEST MANAGED START$/ {skip=1; ...}'` — an exact match against the bare marker text. But the block it actually emits is the long-form line `# TORII QUEST MANAGED START — managed by torii-quest install.sh. Do not edit by hand;`. The exact-match regex never matches that line, so re-running the installer (e.g. to pick up a new version) would append a **second** Torii site block instead of replacing the first, duplicating the domain block in the Caddyfile.

2. **Port preflight only checked for the presence of a Caddy listener, not the absence of anything else.** The ADR-0073 fix greps `ss -ltnp` output for a line containing `caddy` and allows the port if found — it does not check whether *other*, non-Caddy processes are also bound to the same port. A mixed listener set (Caddy plus a stray nginx/apache from a bad handoff, for example) would be waved through because one of the lines matched, silently missing the foreign listener the check exists to catch.

## Decision

### Caddy managed-block rerun — balance-check before strip, hard-abort on mismatch

`write_caddy_site_block` now counts `# TORII QUEST MANAGED START` and `# TORII QUEST MANAGED END` lines (prefix match, so it catches the actual long-form START line) before doing anything else. If the counts don't match — a mangled prior block from a previous bad edit or interrupted run — the installer hard-aborts via `ui_die` **before writing anything**, asking for a manual fix. We do not attempt to auto-recover a mangled block: there is no way to tell whether content after a dangling START marker belongs to the broken block or is an unrelated site that ended up there after a bad edit, so guessing risks silently corrupting the Caddyfile. When the counts balance, the existing strip-and-append logic runs unchanged, now correctly removing the full long-form block on rerun.

### Port preflight — reject any non-Caddy listener, not just "Caddy is present"

The bare-metal branch now captures all listener lines for the port and explicitly checks that **none** of them are non-Caddy before allowing it (`non_caddy_listeners` must be empty AND a Caddy line must be present AND `caddy.service` must be active). A mixed listener set now correctly hard-fails with the same "process other than the system Caddy" message.

## Security / privacy

- No new data is read or exposed. Both changes tighten existing validation logic; behavior for the common single-listener, well-formed-Caddyfile case is unchanged.
- The hard-abort-on-mangled-block path prevents a class of silent Caddyfile corruption on a shared multi-site VPS, which is a safety improvement for exactly the scenario ADR-0073 was written for.

## Trade-offs

- Aborting instead of attempting a best-effort recovery of a mangled managed block means an operator with a hand-edited/corrupted block must fix it manually before rerunning. This is intentional: a wrong guess (over- or under-stripping) is worse than a clear stop with a specific error.
- The stricter mixed-listener check makes the preflight marginally more likely to reject a real "it's fine" edge case (e.g. Caddy briefly sharing a port during its own restart) but that window is already handled by requiring `systemctl is-active --quiet caddy`, so this trade-off is minimal.

## Test / verification

- `bash -n install.sh` and `bash -n install/lib/bare-metal.sh` — syntax clean.
- Marker rerun logic tested against three fixtures with real `awk`/`grep`:
  - happy-path rerun (existing sites + one well-formed prior Torii block) → strip removes exactly the prior block, re-append leaves exactly one Torii block, unrelated sites (`vault.plebeian.build`, `sahmstr.com`) preserved, result validates against real Caddy v2.11.4.
  - mangled block (`START` present, `END` missing) → hard-abort before any write; original file byte-for-byte untouched, including the unrelated site that sits after the dangling `START`.
  - clean Caddyfile with no markers → passed through unchanged.
- Mixed-listener port check tested against three synthetic `ss -ltnp` outputs: pure Caddy → allow; Caddy + nginx on the same port → reject; pure nginx → reject.
- Full suite + `npm run check` (version-consistency gate expects v0.2.708-alpha).

## Consequences

- Re-running the installer to upgrade an existing bare-metal install (same domain, new version) now correctly replaces the managed block instead of duplicating it.
- A previously mangled managed block is caught with an explicit, actionable error instead of either corrupting the Caddyfile further or being silently misinterpreted.
- The port preflight now fully honors its own stated invariant ("allow only when the *only* thing on this port is our own reusable Caddy").
- `main` is fast-forwarded to `v0.2.708-alpha` so a plain clone picks up both this and the ADR-0073 fixes.
