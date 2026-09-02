# ADR-0066: Bare-metal one-command installer (default/recommended path; Docker demoted to optional)

- **Status**: Accepted (retroactive — written after ship, per standing ADR policy)
- **Date**: 2026-08-26
- **Deciders**: chiefmonkey (maintainer), Perplexity Computer (agent)
- **Related**: Builds on ADR-0065 (the Docker installer, now demoted). Scoped entirely to the `torii-quest` repo — no runtime dependency on `torii-suite`. Reuses the terminal UX from `install/lib/ui.sh` + `install/lib/run.sh` (already vendored in ADR-0065) as read-only libraries, not a new dependency.

## Context

ADR-0065 shipped a one-command Docker installer (`sudo ./install.sh`) — it was
the only automated install path and VPS_INSTALL.md framed it as the quick start.
The maintainer later objected to Docker being the blessed default ("I didn't ask
for a docker"), clarified that bare-metal is the path real self-hosters actually
use (the live VPS runs bare-metal via `torii-suite`'s `install-quest.sh`, not
Docker), and made the product decision explicit:

> "the recommended path is the bare-metal approach and this should be what a new
> user/admin see's when they come to the github and run the installer from the
> command line in their vps terminal... they should see the really colourful
> installation in their terminal and there should be nothing for them to do other
> than input their npub."

> "if it can be bundled in to the one installer with the bare-metal version being
> the default and recommended with the docker version an option for more advanced
> users and coders then that would be acceptable"

So the requirement was a single entry point (`install.sh`) that runs bare-metal
by default, reuses the colourful terminal UX, keeps Docker available behind a
flag for advanced operators, and asks only for domain / Let's Encrypt email /
admin npub (the three inputs HTTPS + identity actually need — "nothing to do but
input your npub" means the only *Nostr* input is npub; domain+email are forced
by Let's Encrypt, not optional).

## Decision

Refactor `install.sh` from a Docker-only script into a dispatcher with a shared
front end (arg-parsing, preflight, the three prompts, DNS check, `.env` write)
and two path-specific flows sourced from `install/lib/`:

- **`install/lib/bare-metal.sh`** (new, the default/recommended path) — installs
  Node 20 (NodeSource) + Caddy (official stable apt repo) + git/build tools;
  builds the game as `${SUDO_USER}` (never a root-owned clone); publishes into a
  versioned `/var/www/torii-quest/releases/<ts>-<sha>/` folder and atomically
  flips the `/var/www/torii-quest/current` symlink; prunes old releases keeping
  the 3 newest plus the live one (never deletes what `current` points at);
  creates a dedicated `torii-quest` system user; copies `dist/server/arena-ws.cjs`
  into `/opt/torii-quest/mp/` with a minimal `package.json` and `npm install
  --omit=dev` (resolving `ws` only); writes `/etc/systemd/system/torii-arena-ws.service`
  (User=torii-quest, `ProtectSystem=strict`, `QUEST_ADMIN_NPUB` env); writes a
  **managed** Caddy site block delimited by `# TORII QUEST MANAGED START/END`
  markers (strips any prior block with `awk`, never clobbers the rest of the
  operator's `Caddyfile`); extracts the real CSP from the build's own
  `dist/_headers` (never a hand-copied string) and adds `wss://<domain>` to
  `connect-src` for the `/mp` socket; `caddy validate`s before `systemctl reload`;
  verifies the live HTTPS site, the multiplayer service, and the admin-npub
  startup log line. Mirrors VPS_INSTALL.md §§1–16 exactly rather than inventing
  a new layout.
- **`install/lib/docker.sh`** (ADR-0065's Docker flow, now gated behind `--docker`)
  — unchanged behaviour: installs Docker if missing, `docker compose build
  --pull`, `up -d --remove-orphans`, loopback verify. This is the advanced/
  optional alternative.
- **`install.sh`** — the sole user-facing entry point. Flags: `--docker`,
  `--domain`, `--email`, `--admin-npub`, `-y`/`--yes`, `--dry-run`, `-h`/`--help`.
  `--dry-run` resolves config + runs the DNS check and prints the plan without
  writing `.env` or touching the system (useful for previewing on a fresh box).
- **README.md** — new "Self-hosting" section puts the bare-metal one-liner
  (`sudo ./install.sh`) front and center with the three-prompt contract;
  `--docker` shown as advanced/optional below it.
- **`VPS_INSTALL.md` §0** — retitled "Quick start — one-command bare-metal install
  (recommended)"; Docker moved to a sub-section explicitly framed as **not** the
  recommended path. The "Status" line updated to v0.2.697-alpha (no longer claims
  "no code in this repo touches a server" — that was made false by ADR-0065 and
  this ADR).
- **`tests/installer-bare-metal.test.js`** (new, 25 source-contract tests) —
  asserts: default mode is bare-metal; Docker requires `--docker`; the
  interactive path has exactly 3 prompts (domain/email/npub); bare-metal builds as
  a non-root user, publishes versioned releases with an atomic symlink flip,
  prunes but never the live release, uses a managed Caddy block + validates
  before reload, extracts CSP from `dist/_headers`, does not install strfry on
  bare metal, does not modify `server/arena-ws.js`; no doc positively calls Docker
  recommended (negations like "not the recommended path" are allowed).

## Consequences

- **Enables:** a new self-hoster cloning the repo and running `sudo ./install.sh`
  on a fresh Ubuntu/Debian VPS gets a colourful, mostly-automatic bare-metal
  install — game over HTTPS + multiplayer service + managed Caddy — with only
  three prompts, and zero dependency on `torii-suite`. Docker remains available
  for operators who specifically want it, behind an explicit flag.
- **Enables:** the Caddyfile is never clobbered — the managed-block approach means
  the installer is safe to re-run on a box that already hosts other sites, and
  uninstall is just "remove the managed block + disable the service."
- **Forecloses:** Docker is no longer the implicit/default path — the maintainer's
  intent that bare-metal be what a newcomer sees is now encoded in code, docs, and
  tests.
- **Trade-offs:** the bare-metal path does **not** run a local Nostr relay
  (`strfry`). The browser client connects to public Nostr relays (damus.io,
  nos.lol, …) which the shipped CSP `connect-src` already permits — this matches
  the real bare-metal production deployment and avoids a strfry build/source step
  on a fresh box. Operators who want a local relay should use `--docker`.
- **Trade-offs:** the installer is not yet end-to-end tested against a real
  freshly-provisioned VPS (it was syntax-checked, `--help`/`--dry-run` smoke-
  tested, and its source contract is asserted by tests). A real-VPS validation
  run is left to the maintainer; this is a repo/installer change, not a runtime
  fix, so the live VPS is untouched.
- **Enforcement:** `bash -n` clean on all three scripts; `--help` and
  `--dry-run` (bare-metal + docker modes) verified; 25 installer contract tests
  green; full suite + `npm run check` re-run after the version bump (see changelog).

## Alternatives considered

- **Two separate top-level installers (`install.sh` + `install-docker.sh`).**
  Rejected — the maintainer explicitly preferred one bundled entry point with
  bare-metal as the default and Docker as a flag.
- **Make bare-metal the only path and remove Docker entirely.** Rejected — the
  maintainer accepted keeping Docker as an advanced/optional alternative; removing
  it would undo ADR-0065's work for the operators who do want it.
- **Bundle a local strfry relay into the bare-metal path.** Rejected as scope —
  the real bare-metal production install doesn't run one (it uses public relays),
  and adding a strfry build/source step would increase the fresh-VPS surface and
  friction the "only input your npub" goal. `--docker` remains the relay-included
  path.
- **Touch `server/arena-ws.js` to wire the bare-metal service.** Rejected —
  the bare-metal path references the already-built `dist/server/arena-ws.cjs`
  bundle only (same as the production `install-quest.sh`), so no source change to
  the server was needed.

## Notes

- Reference files consulted (read-only, not copied): `torii-suite`'s
  `install-quest.sh` (the real bare-metal production install — confirmed the
  `/opt/torii-quest/mp/arena-ws.cjs` layout, `torii-quest` system user, and that
  bare-metal does not run strfry), `VPS_INSTALL.md` §§1–16, and the live VPS's
  `systemctl cat torii-arena-ws.service`.
- Shipped as v0.2.697-alpha. See the "Current version" line in
  `torii-quest-progress.md` / `torii-quest-todo.md` / `torii-quest-handoff.md` for
  the full changelog text.
