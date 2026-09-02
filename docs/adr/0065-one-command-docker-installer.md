# ADR-0065: One-command Docker installer for Torii Quest (MP included by default)

- **Status**: Accepted (retroactive — written after ship, per standing ADR policy)
- **Date**: 2026-08-26
- **Deciders**: chiefmonkey (maintainer), Perplexity Computer (agent)
- **Related**: Scoped entirely to the `torii-quest` repo — does not modify or depend on `torii-suite`/`bootstrap.sh`. Borrows terminal-UX style (colourful boxes/spinners) from `torii-suite`'s `bootstrap.sh`/`ui.sh`/`run.sh` as read-only reference, not a shared dependency.

## Context

`torii-quest` had no self-contained path from a fresh `git clone` to a live instance — standing up a copy required manual Docker/Caddy/env setup or borrowing steps from the separate `torii-suite` installer, which the maintainer explicitly wants Quest decoupled from ("for now we are just focussing on Torii Quest... for now lets just focus on Quest being a self contained install from my github"). The maintainer asked for a one-command installer, liked the colourful terminal UX of `torii-suite`'s `bootstrap.sh`, and made two binding product decisions up front:

> "MP is an integral part of the quest experience, it should be part of the initial install then later players can use it change it remove it according to their needs."

> "the MP game is an integral part of the Quest experience... it should be installed together with the initial install... players/admins can then change it, copy it, remove it, duplicate it, or whatever, its up to them later on."

These lock in Docker Compose as the mechanism and multiplayer (`arena-ws`) running by default, not as an opt-in flag.

## Decision

Ship a single entry point, `sudo ./install.sh`, living entirely inside `torii-quest`:

- **`install.sh`** (~232 lines) — preflight (root check, port-80 check, Docker install-if-missing), interactive prompts for domain/email/admin npub with an `-y`/`--yes` non-interactive mode, `docker compose up` of the stack, loopback verification, and a colourful boxed summary on success.
- **`install/lib/ui.sh`** — prompt/confirm primitives and colour/box rendering, adapted from `torii-suite`'s `bootstrap.sh` UX style but vendored independently (no shared file or dependency).
- **`install/lib/run.sh`** — spinner and command-running helpers, same provenance.
- **`docker-compose.yml`** — three services: `web` (game), `strfry` (Nostr relay), `arena-ws` (multiplayer), all started by default. Owners can later edit, duplicate, or remove any service — the installer does not special-case MP as optional.
- **`Caddyfile` + `Dockerfile`** — reworked so the CSP header is extracted from the real per-build `dist/_headers` at image-build time (`grep Content-Security-Policy dist/_headers`) instead of a hand-copied static string, closing a drift class that had already gone stale in `VPS_INSTALL.md` (dead `'strict-dynamic'` directive, wrong sha256).
- **`.env.example`** — documents the MP toggle/tuning vars `arena-ws` already reads (`PORT`/`HOST`/`MAX_PEERS`/`LOG_LEVEL`/`MP_MODE`/`LAG_COMP_MS`/`HP_MAX`/`RESPAWN_MS`/`SCORE_ENABLED`/`QUEST_ADMIN_NPUB`).
- **`VPS_INSTALL.md`** — new "§0 Quick start" section documents the one-command path; the existing §§1-16 manual bare-metal/systemd instructions remain as the documented fallback for owners who don't want Docker.

Two real bugs were found and fixed during implementation (not just polish — both would have broken real invocations):

1. **NUL-byte flood in prompts.** `ui_ask`/`ui_confirm` reopened `/dev/stdin` via `read -r reply < "$_UI_PROMPT_IN"` on every call. On this bash build, redirecting onto a pipe triggers a full-buffer read-ahead whose unconsumed remainder is flushed as literal NUL bytes on process exit (proved via byte-level inspection: 920 NUL bytes, deterministic, immediately after the last prompt). Fixed by replacing the redirect design with an `_UI_HAS_TTY` flag, resolved via a real write-probe (not just permission bits): reads from `/dev/tty` when a controlling terminal exists, otherwise reads the inherited stdin fd directly with no redirect.
2. **Non-root crash before the friendly error could print.** `run.sh`'s top-level `mkdir -p /var/log/torii-quest` ran immediately on sourcing, before `install.sh`'s root check — a real non-root invocation crashed with a raw `mkdir: Permission denied` instead of the intended colourful "run as root or with sudo" message. Fixed with a fallback to `${TMPDIR:-/tmp}/torii-quest-$(id -u)` when the real log dir isn't writable.

A third issue (leaked `bash: line N: /dev/tty: No such device or address` stderr bypassing `2>/dev/null` guards, because the parent shell's redirect-setup failure happens before the guarded child command runs) was fixed by wrapping every `/dev/tty` redirect in an explicit subshell.

## Consequences

- **Enables:** a fresh clone of `torii-quest` can go from zero to a running instance (game + relay + multiplayer) with one command and no manual Docker/Caddy/env editing; MP is live from first boot, matching the maintainer's "integral part of the experience" decision.
- **Enables:** the CSP header can no longer silently drift between `dist/_headers` and hand-maintained docs/configs — both `Caddyfile`/`Dockerfile` and `VPS_INSTALL.md` now point at the same live-extraction command instead of a copied string.
- **Forecloses:** nothing in `torii-suite` — this installer has zero runtime dependency on that repo or its `bootstrap.sh`, satisfying the standing scope constraint.
- **Trade-offs:** Docker Compose is now the "blessed" fast path; the manual systemd/bare-metal path in `VPS_INSTALL.md` §§1-16 is kept only as a fallback and could drift out of sync with the installer over time if not maintained alongside it.
- **Enforcement:** `shellcheck` run clean on all three scripts (two expected SC1091 info notices for dynamic source paths). End-to-end happy-path, not-root-abort, and port-80-in-use-abort paths all tested. Full suite (3380 tests / 267 files) and `npm run check` (21/21 regression gates) green after the change.

## Alternatives considered

- **Extend `torii-suite`'s installer to cover Quest.** Rejected — the maintainer explicitly wants Quest decoupled and self-sufficient from a bare GitHub clone for now.
- **Make MP an opt-in flag at install time.** Rejected per the maintainer's explicit design-lock answers; MP ships on by default and is reconfigurable after the fact, not gated at install.
- **Keep the static hand-copied CSP string.** Rejected once the drift was found live (dead `'strict-dynamic'`, stale sha256 in three places in `VPS_INSTALL.md`) — live extraction from `dist/_headers` removes the drift class entirely instead of patching the current value.

## Notes

- Reference-only files consulted (not copied wholesale, not part of the repo): `torii-suite`'s `bootstrap.sh`, `ui.sh`, `run.sh`, `install-quest.sh` — used to match the colourful spinner/box terminal style the maintainer liked, reimplemented independently inside `torii-quest`.
- Shipped as v0.2.696-alpha. See the "Current version" line in `torii-quest-progress.md` / `torii-quest-todo.md` / `torii-quest-handoff.md` for the full changelog text.
