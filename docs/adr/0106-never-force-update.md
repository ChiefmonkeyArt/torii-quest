# ADR-0106: Never force-update — deploys are manual-only

- **Status:** Accepted
- **Version target:** v0.2.750-alpha
- **Supersedes:** [ADR-0101](0101-auto-deploy-on-tag.md) (auto-deploy on tag push). Its SSH key, forced-command, and sudoers hardening are retained unchanged — only the automatic trigger is removed.
- **Related:** [ADR-0105](0105-deploy-trigger-and-verify-fix.md) (the pipeline whose auto-firing this reverses).

## Context

ADR-0101 shipped a pipeline where every `v*-alpha` tag push auto-deployed to the
VPS: merge to `main` → `tag-release.yml` tags → `deploy-on-tag.yml` SSHes the VPS
and swaps the live build. The result was that merging code shipped to production
with **zero human opt-in** — the end state `main HEAD == latest tag == VPS`
happened on its own.

That behaviour is wrong for this project's distribution model. Torii apps are run
by *people on their own machines*. The word "auto-update" (and the capability flag
named after it) inaccurately implies automation where none should exist.

## Decision

1. **Never force an update on anyone.** A self-hosted instance only ever *shows*
   that an update is available (the "Installed vs Latest" banner and the in-game
   "Update available" button). It changes nothing until the instance owner presses
   the button — their machine, their choice.

2. **The owner's canonical CI is manual too.** `.github/workflows/deploy-on-tag.yml`
   is renamed to `deploy-manual.yml` and re-triggered from `workflow_dispatch` only
   (a human runs it from the Actions UI, optionally naming a tag). The
   commit → tag step (`tag-release.yml`) stays automated — tagging is inert; it
   ships nothing until someone acts.

3. **Rename the capability, not the behaviour.** The runtime capability flag
   `autoUpdate` (admin configured + update-request dir writable) is renamed
   `selfUpdate` to drop the misleading "auto-" prefix. It means "this host can
   self-update when the admin opts in", never "this host updates by itself".
   User-facing copy reads "update available", never "auto-update".

## Consequence

- Merging no longer reaches a VPS by itself. A deploy requires a manual
  `workflow_dispatch` run (or the in-game "Update available" button on a
  self-hosted instance).
- The release-metadata safety field `update.autoUpdate` is deliberately **kept**:
  it is the failsafe that *asserts* a release does not auto-update
  (`validateReleaseMeta` rejects `autoUpdate: true`). Its name is the thing it
  forbids, so it must not be renamed to "update available" (which would invert its
  meaning).
- Ship reports now require an explicit deploy step again, instead of assuming the
  tag auto-reaches the VPS.