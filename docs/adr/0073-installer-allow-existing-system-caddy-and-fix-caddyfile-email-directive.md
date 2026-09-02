# ADR-0073 — Installer: allow existing system Caddy on ports 80/443 + fix invalid Caddyfile `email` directive

- **Status:** Accepted
- **Date:** 2026-08-27
- **Version:** v0.2.707-alpha
- **Component:** Bare-metal installer — `install.sh` (port preflight) + `install/lib/bare-metal.sh` (`write_caddy_site_block`)

## Context

A collaborator (Bekka) installing Torii Quest on her own VPS hit two installer bugs. Her VPS already runs the distro's systemd-managed `caddy.service`, which serves four other unrelated sites. The installer is designed to reuse that exact Caddy instance — it appends a managed site block between `# TORII QUEST MANAGED START/END` markers and `systemctl reload caddy`. Both bugs blocked a clean install:

1. **Port-80 preflight hard-fails on the user's own Caddy.** The preflight loop did `ss -ltn "( sport = :80 )"` and called `ui_die` if anything listened on 80/443 — including the user's own legitimate `caddy.service` that the installer is about to manage. The error message ("Stop whatever's listening on it") actively misled the operator toward taking her other four sites down.

2. **The generated Caddyfile block is invalid Caddy syntax.** `write_caddy_site_block` emitted a bare top-level `email $EMAIL_IN` line *outside* any site block. In Caddy v2, `email` is a **global option** that may only appear inside a global options block `{ ... }` — a bare top-level occurrence is parsed as a directive, which then makes the following site-address line (`$DOMAIN_IN {`) an "unrecognized directive", failing `caddy validate`. This was confirmed against real Caddy v2.11.4: the generated block fails validation in **both** the fresh-install case and the multi-site (Bekka) case. Because the installer only reloads Caddy when `caddy validate` succeeds, a fresh install on any VPS would silently end with the Torii site block written but **never loaded** — the game would not be served.

## Decision

### Port preflight — allow the host's own systemd Caddy (bare-metal only)

The preflight loop now distinguishes the listener process:

- **Docker mode (`--docker`):** unchanged — ports 80/443 must be free, because the web container binds them itself.
- **Bare-metal mode (default):** if the listener on 80/443 is the process `caddy` **and** `systemctl is-active --quiet caddy` is true, the port is treated as fine (the installer is about to manage that same instance) and the check continues. Any other process (nginx, apache, a stray non-systemd caddy) still hard-fails with a clearer message.

The process is identified via `ss -ltnp` matching `users:(("caddy"` (the script already runs as root via `sudo`, so `-p` is available), gated by the active `caddy.service` unit so a manual/non-systemd caddy binary is not whitelisted.

### Caddy block — `tls <email>` inside the site block

The bare top-level `email $EMAIL_IN` line is removed. The Let's Encrypt email the operator entered at the prompt is now emitted as a per-site `tls $EMAIL_IN` directive **inside** the site block. Verified against Caddy v2.11.4: this validates in the fresh-install case, the multi-site case, **and** when the existing Caddyfile already has a global options block with its own `email` (no conflict — per-site `tls` email applies only to the Torii site).

### Caddyfile backup before mutation

`write_caddy_site_block` now takes a timestamped copy (`${CADDYFILE}.bak.$(date +%s)`) before rewriting the file — a safety net for multi-site VPS where other (unrelated) sites share the Caddyfile. The strip-prior-block awk logic is unchanged; it only ever touches text between the managed markers.

## Security / privacy

- The port whitelist only affects the installer's own preflight abort behaviour; it does not change what Caddy binds or serves.
- The `tls $EMAIL_IN` directive only sets the ACME account email for the Torii site's certificate issuance — no additional data is exposed. The email was already collected at the prompt; it is now used correctly instead of emitted as broken syntax.
- The Caddyfile backup is a local file on the VPS (root-readable); it contains only Caddy config that was already on disk.

## Trade-offs

- A bare top-level `email` would have configured the ACME email globally for all sites on the Caddyfile; per-site `tls <email>` scopes it to the Torii site only. This is the safer default for a shared multi-site Caddy (we must not reconfigure the operator's other sites), and Caddy still issues a valid cert for the Torii domain.
- Whitelisting only `caddy` (not arbitrary processes) keeps the check strict; an operator running a foreign web server on 80 still gets a clear failure.

## Test / verification

- `bash -n install.sh` and `bash -n install/lib/bare-metal.sh` — syntax clean.
- The exact generated Caddyfile block was reconstructed with real variables (`DOMAIN_IN`, `EMAIL_IN`, `CURRENT_LINK`, `CSP_RAW`) and validated against Caddy v2.11.4:
  - appended to a 2-site existing Caddyfile (Bekka's scenario) → `Valid configuration`;
  - alone (fresh install) → `Valid configuration`.
- The old bare-`email` block was confirmed to fail validation in both scenarios (`unrecognized directive`), proving the bug and the fix.
- The `users:(("caddy` grep pattern was tested against real `ss -ltnp` output (matches caddy, rejects nginx).
- Full suite + `npm run check` (version-consistency gate expects v0.2.707-alpha).

## Consequences

- A plain `git clone` + `sudo ./install.sh` on a VPS that already runs the system Caddy (Bekka's case, and the common multi-site VPS) now installs cleanly without taking other sites down, and the Torii site block actually loads (Caddy reloads, because the config validates).
- Fresh installs on a Caddy-less VPS are unaffected (ports free → pass; the block validates).
- `main` is fast-forwarded to `v0.2.707-alpha` so a plain clone picks up the fix.
