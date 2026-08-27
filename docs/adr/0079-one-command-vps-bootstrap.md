# ADR-0079: One-command `curl | sudo bash` VPS bootstrap

- **Status:** Accepted
- **Date:** 2026-08-27
- **Tags:** deploy, install, ops, vps

## Context

The recommended VPS install was "one-command" in name only — it was actually
three manual steps the operator had to run themselves:

```bash
git clone https://github.com/ChiefmonkeyArt/torii-quest.git
cd torii-quest
sudo ./install.sh
```

For a returning operator updating an existing node (Bekka, tomorrow) it was
worse: the clone already exists at an unknown path, so the operator first had
to `find` it, then `git fetch && git checkout <tag>`, then `sudo bash install.sh`.
The operator is not a developer — they cut and paste commands — so each extra
step + each path the operator has to discover is friction and a place to go wrong.

Operator direction: "no user should have to do what we've done — they deploy one
command on their VPS and then go to their website and log in." + the deferred
follow-up "one-command curl|bash installer simplification (currently clone +
install.sh; user wants a one-liner)."

## Decision

Add `install-remote.sh` to the repo root — a bootstrap that `curl | sudo bash`
can pipe directly into. It does the minimum install.sh cannot do for itself
(install.sh dies at `bare-metal.sh:65` if there is no `$ROOT/.git`, because it
assumes it is already running inside a clone) and then hands off to install.sh:

1. **Ensure git + ca-certificates** are installed (install.sh only installs git
   during its own dep stage, which is too late for the clone).
2. **Discover an existing clone** (search `/home /opt /srv /root` at bounded
   depth for a dir with `install.sh` + `.git` whose `origin` remote points at
   `ChiefmonkeyArt/torii-quest`) so an existing `.env` (domain / email / admin
   npub) is preserved, not clobbered. Selection order: explicit `--repo-dir` >
   discovered clone with `.env` > discovered clone without `.env` > fresh clone.
3. **Clone fresh to `/opt/torii-quest-src`** if no existing clone is found.
   The source clone is deliberately NOT `/opt/torii-quest` — that path is the
   runtime systemd-user home + multiplayer bundle that install.sh owns; using
   it for the source tree would collide.
Git operations run as `SUDO_USER` when available (the normal `curl | sudo bash`
path from a normal user); if invoked from a root shell with no `SUDO_USER`, they
run as root and install.sh will warn (matching its own `bare-metal.sh:58` guard).
The fresh-clone path pre-creates `/opt/torii-quest-src` owned by the build user
(needed because `/opt` is root-owned) before cloning as that user, so the tree is
non-root-owned from the start and `npm ci` can write `node_modules`.
4. **Hand off to `install.sh`** via `exec bash install.sh "$@"`. Because the
   bootstrap runs under `sudo`, `SUDO_USER` is set and survives `exec`, so
   install.sh builds as the operator, exactly as if they had run
   `sudo ./install.sh` themselves. All flags install.sh understands
   (`--domain` / `--email` / `--admin-npub` / `-y` / `--docker` / `--dry-run`)
   are forwarded through.

The one-liner (pin the tag you trust — the script you review is the script that
runs, the same `curl | sudo bash` model as rustup / get.docker):

```bash
curl -fsSL https://raw.githubusercontent.com/ChiefmonkeyArt/torii-quest/v0.2.713-alpha/install-remote.sh \
  | sudo bash -s -- -y
```

## Consequences

- **One command for fresh + update.** A new operator runs the one-liner; a
  returning operator runs the same one-liner + it reuses their existing clone +
  `.env`. No `find`, no manual `git checkout`, no `cd`.
- **install.sh is unchanged.** The bootstrap only does what install.sh cannot do
  for itself (clone + version checkout); the build, release publish, systemd,
  Caddy, and CSP-sha extraction all stay in install.sh. No duplicate logic.
- **Non-root build preserved.** Git ops run as `SUDO_USER`; install.sh inherits
  `SUDO_USER` through `exec` and builds as the operator — the tree stays
  non-root-owned, so `npm ci` can write `node_modules` (the root-owned-clone
  failure mode install.sh already warns about at `bare-metal.sh:58`).
- **Security posture.** `curl | sudo bash` runs as root. The operator is told to
  pin the tag they trust and review the script at that tag. This is the
  established model for self-hosted installers (rustup, get.docker); it is
  acceptable for an own-repo installer but is NOT a supply-chain guarantee — the
  recommendation is to pin a reviewed tag, not `main`.

## Non-goals

- **No auto-update daemon.** The one-liner is still a deliberate, human-run
  command — it does not schedule itself. Updates remain a conscious action
  (matching `UPDATE_CHECK.md` §4's safety boundary).
- **No supply-chain signing.** Pinning to a reviewed tag is the trust model;
  commit signing / SLSA provenance is out of scope for this alpha.
- **No migration of an existing clone to `/opt/torii-quest-src`.** An existing
  clone is discovered + reused in place; only a fresh install lands in the
  canonical path.

## Tests

- `tests/install-remote.test.js` (new) shells out to `bash install-remote.sh
  --help` and asserts the interface contract: it documents `--version` +
  `--repo-dir`, it names the canonical source path `/opt/torii-quest-src` (and
  NOT the runtime `/opt/torii-quest`), it lists the install.sh flags it forwards,
  and it exits 0 with no system changes.

## References

- ADR-0074 (atomic release symlink flip + CSP sha extraction — install.sh owns it).
- ADR-0078 (Access settings tab — the v0.2.712 release this bootstrap deploys).
- `install.sh` (the hand-off target), `VPS_INSTALL.md` §0 (quick start, now the
  one-liner with clone+install kept as the fallback reference).
