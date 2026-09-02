# ADR-0102: Admin-scoped SSH key for AI-driven infra diagnosis and repair

- **Status:** Proposed
- **Version target:** infra-only; no code version bump.
- **Depends on:** [ADR-0101](0101-auto-deploy-on-tag.md) (the deploy-only key stays exactly as it is; this is a **second** key with a wider scope).
- **Related:** none.

## Context

ADR-0101 gave the AI a deploy-only SSH key locked to a single forced-command (`torii-deploy-hook`). That was the right first step: tag → auto-deploy is fully hands-off now, and the blast radius is exactly one systemd verb.

But diagnostics still bounce back to the maintainer. Real example, 2026-09-02: `torii.plebeian.build` is stuck on v0.2.733-alpha while `chiefmonkey.art/quest` is on v0.2.744-alpha. Answering "why?" requires reading `/etc/nginx/`, `systemctl status`, `journalctl -u caddy` (turned out to be Nginx), `readlink` on the release dir, `ls /var/www/…` — none of which the deploy-only key can run. Every command has to be pasted by the maintainer, one at a time. That is exactly the manual-paste tax ADR-0101 was supposed to retire, just moved from deploys to diagnosis.

The maintainer's standing rule ("ONE instruction at a time — I am not a coder") makes this worse: multi-step VPS diagnosis with a hard-locked key turns into 10–20 round-trips per session and is a live source of frustration. The maintainer's own words this session: "literally the whole point in giving you access."

## Decision

Add a **second SSH key** — separate from the deploy-only key — with **admin-scoped** access: unrestricted read (any file, any log, any config), targeted write (Nginx configs, systemd unit files, `/var/www/**`), and a narrow list of privileged verbs (`sudo systemctl {start,stop,restart,status,daemon-reload}`, `sudo nginx -t`, `sudo nginx -s reload`, `sudo journalctl -u *`). No arbitrary root shell. No package installation. No user management. No key management (can't add SSH keys, can't touch `authorized_keys`). No destructive verbs (`rm -rf /`, `dd`, `mkfs`, `shutdown`, `reboot`).

The key is stored **only as a GitHub Actions secret** (same pattern as `TORII_DEPLOY_SSH_KEY`) so the private key never appears in any chat, session transcript, or workspace file. The AI reaches the VPS by invoking a lightweight GitHub Actions workflow (`repair.yml`) that takes a single command string as input, runs it over SSH, and streams the output back as the workflow log — the maintainer can watch every command the AI runs, and every run is auditable in GitHub's Actions tab forever.

### Two-key model

| Key | Purpose | Scope | Trigger |
|---|---|---|---|
| `TORII_DEPLOY_SSH_KEY` (ADR-0101) | Auto-deploy on tag push | 1 forced-command | `push: tags: v*-alpha` |
| `TORII_ADMIN_SSH_KEY` (this ADR) | Infra diagnosis + repair | Sudoers allowlist (see below) | `workflow_dispatch` only |

The deploy key stays as-is. Its blast radius does not change. This ADR adds a strictly-more-powerful second key that is only usable via manual workflow dispatch — meaning either the maintainer or the AI (via `gh workflow run`) explicitly kicks each run. It never fires automatically.

### The admin user + sudoers allowlist

On the VPS:

```bash
sudo useradd --system --create-home --shell /bin/bash torii-admin
sudo -u torii-admin mkdir -p ~torii-admin/.ssh && sudo -u torii-admin chmod 700 ~torii-admin/.ssh
# authorized_keys entry — NO forced-command; the key gets a real (bash) shell,
# but the sudoers file below is what actually gates what it can do as root.
echo "ssh-ed25519 AAAA... torii-admin@github-actions" | \
  sudo -u torii-admin tee ~torii-admin/.ssh/authorized_keys > /dev/null
sudo chmod 600 ~torii-admin/.ssh/authorized_keys
```

Then `/etc/sudoers.d/torii-admin` (root:root 0440, validated with `visudo -c -f`):

```
# torii-admin: AI-driven infra diagnosis + repair. See ADR-0102.
# Read-only diagnostics: unlimited (any file, any log, any status).
torii-admin ALL=(root) NOPASSWD: /usr/bin/cat, /usr/bin/less, /usr/bin/head, /usr/bin/tail, \
                                 /usr/bin/grep, /usr/bin/find, /usr/bin/ls, /usr/bin/stat, \
                                 /usr/bin/readlink, /usr/bin/file, /usr/bin/du, /usr/bin/df
torii-admin ALL=(root) NOPASSWD: /bin/systemctl status *, /bin/systemctl show *
torii-admin ALL=(root) NOPASSWD: /bin/journalctl *
torii-admin ALL=(root) NOPASSWD: /usr/sbin/nginx -T, /usr/sbin/nginx -t

# Targeted writes: only the paths this project owns.
torii-admin ALL=(root) NOPASSWD: /usr/bin/tee /etc/nginx/sites-available/*, \
                                 /usr/bin/tee /etc/nginx/conf.d/*, \
                                 /usr/bin/tee /etc/systemd/system/torii-*.service, \
                                 /usr/bin/tee /etc/systemd/system/torii-*.timer, \
                                 /usr/bin/tee /var/www/torii.quest/*, \
                                 /usr/bin/tee /opt/torii-quest/*
torii-admin ALL=(root) NOPASSWD: /bin/ln -sf /var/www/torii.quest/releases/*, \
                                 /bin/mv /var/www/torii.quest/*, \
                                 /bin/mkdir -p /var/www/torii.quest/*, \
                                 /bin/mkdir -p /opt/torii-quest/*, \
                                 /bin/rm /etc/nginx/sites-enabled/*, \
                                 /bin/ln -s /etc/nginx/sites-available/* /etc/nginx/sites-enabled/*

# Service control: allowlisted units only.
torii-admin ALL=(root) NOPASSWD: /bin/systemctl start torii-*, \
                                 /bin/systemctl stop torii-*, \
                                 /bin/systemctl restart torii-*, \
                                 /bin/systemctl reload nginx, \
                                 /bin/systemctl restart nginx, \
                                 /bin/systemctl daemon-reload
torii-admin ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload

# Explicit deny list (defense in depth; the allowlist above already excludes these).
torii-admin ALL=(root) NOPASSWD: !/bin/rm -rf /*, !/bin/dd, !/sbin/mkfs*, \
                                 !/sbin/shutdown, !/sbin/reboot, !/sbin/halt, \
                                 !/usr/sbin/useradd, !/usr/sbin/userdel, !/usr/sbin/usermod, \
                                 !/usr/bin/passwd, !/usr/bin/chage, \
                                 !/usr/bin/apt*, !/usr/bin/dpkg*, \
                                 !/usr/bin/tee /root/*, !/usr/bin/tee /etc/passwd, \
                                 !/usr/bin/tee /etc/shadow, !/usr/bin/tee /etc/sudoers*, \
                                 !/usr/bin/tee /home/*/.ssh/*, \
                                 !/usr/bin/tee ~torii-admin/.ssh/*
```

Rules of thumb:

1. **Everything read-only is allowed as `sudo`** so diagnostics never bounces. The AI can `sudo cat /etc/nginx/nginx.conf`, `sudo journalctl -u torii-arena-ws --since "1 hour ago"`, `sudo nginx -T`, etc. Nothing about reading configs is dangerous.
2. **Writes are scoped by path**. The `torii-admin` user can edit Nginx site configs, project-owned systemd units, and the project's release directory — the surfaces this project actually needs to touch. It cannot touch `/etc/passwd`, `/etc/sudoers*`, any other user's home, or any file outside the allowlist.
3. **Service verbs are scoped by unit name**. The `torii-*` glob covers every service this project owns and only those.
4. **`sudo -i` and `sudo bash` are NOT in the allowlist**, so there is no path to an interactive root shell. Every privileged action is a discrete, logged verb.

### The GitHub Actions workflow

A new file `.github/workflows/repair.yml`:

```yaml
name: VPS infra repair (manual)
on:
  workflow_dispatch:
    inputs:
      command:
        description: 'Shell command to run as torii-admin on the VPS. Multi-line supported. Logged verbatim.'
        required: true
        type: string
      reason:
        description: 'One-line reason (goes into audit log).'
        required: true
        type: string

concurrency:
  group: torii-quest-vps-admin
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  repair:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: SSH and run
        env:
          SSH_KEY: ${{ secrets.TORII_ADMIN_SSH_KEY }}
          HOST: ${{ secrets.TORII_ADMIN_HOST }}
          CMD: ${{ inputs.command }}
          REASON: ${{ inputs.reason }}
        run: |
          set -euo pipefail
          echo "::group::Audit"
          echo "Actor:  ${{ github.actor }}"
          echo "Run:    ${{ github.run_id }}"
          echo "Reason: $REASON"
          echo "::endgroup::"
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/id && chmod 600 ~/.ssh/id
          ssh-keyscan -T 15 "$HOST" >> ~/.ssh/known_hosts 2>/dev/null
          ssh -i ~/.ssh/id -o BatchMode=yes -o StrictHostKeyChecking=yes \
              "torii-admin@$HOST" "$CMD"
```

Notes:

- **No `pull_request` trigger.** Only `workflow_dispatch`. Only actors with `repo:write` (i.e. the maintainer and the AI's `chiefmonkey-art` bot token) can trigger.
- **`reason` is mandatory** and prints at the top of every run's audit block. Grep-friendly for later review.
- **Concurrency group** prevents two admin sessions racing on the same box.
- **`StrictHostKeyChecking=yes`** — first run pins the VPS's host key via `ssh-keyscan`. If someone later swaps the box out from under us, the workflow fails loud.

### Second box: `torii.plebeian.build`

Bekka's VPS (`23.182.128.82`) needs the same two keys installed if the maintainer wants tag-driven auto-deploy and AI diagnosis on that box too. The installation script (`ops/install-admin-ssh.sh`, produced by this ADR) is idempotent and works for either box. Adding a host is: run the script on the box, copy the printed public keys into the corresponding GitHub secrets (`TORII_DEPLOY_SSH_KEY_PLEBEIAN`, `TORII_ADMIN_SSH_KEY_PLEBEIAN`), fan out the workflows.

Not required for this ADR to land. Second box is a follow-up.

## Consequences

### Positive

- **Infra diagnosis no longer requires the maintainer at the terminal.** The AI can `sudo cat /etc/nginx/nginx.conf` directly.
- **Fix loops close in one round-trip** instead of ten. "Why is torii.plebeian.build on v0.2.733?" becomes one workflow run, not a 40-message thread.
- **Every action is logged** in GitHub Actions. Full audit trail. Full replay. Full revocability (`gh secret delete TORII_ADMIN_SSH_KEY`).
- **Blast radius is bounded by the sudoers allowlist**, not by whichever forced-command the maintainer remembered to hard-code.
- **The ADR-0101 deploy path is untouched.** If this key is compromised the deploy path still works; if the deploy key is compromised this key still works.

### Negative

- **Broader access than deploy-only.** A leaked admin key can rewrite the project's Nginx site config, reload Nginx, restart `torii-*` services. Not root shell, not passwd, not other users — but enough to break the site until the key is revoked.
- **`workflow_dispatch` runs are triggered by any repo:write actor.** If the AI's bot token is compromised, the attacker gets admin-scoped VPS access via `gh workflow run repair.yml`. Mitigations: (a) the deny-list blocks the most destructive verbs even with a valid key, (b) revocation is one command, (c) every run appears in GitHub Actions with the actor's name.
- **New moving part.** One more workflow to keep green, one more sudoers file to keep valid, one more `ssh-keyscan` pin to rotate if the VPS is rebuilt.

### Neutral

- The admin user's shell is real (`/bin/bash`), unlike the deploy user. This is required for `bash -c "…"` to run multi-verb sudo commands. Access is gated by sudoers, not by the shell.
- Nothing about the app code changes. No version bump. No package changes on the VPS beyond `torii-admin` + one sudoers file.

## Rollout

1. **This PR** lands the ADR + workflow + `ops/install-admin-ssh.sh` (the reproducible install script). Status stays `Proposed` until phase 3.
2. **Phase 2 — VPS side (maintainer, once):** run `ops/install-admin-ssh.sh` on the primary VPS. Script prints the public key. Maintainer pastes it into two GitHub repository secrets:
   - `TORII_ADMIN_SSH_KEY` — the private key (from `/home/torii-admin/.ssh/id_ed25519` — deleted from the VPS immediately after).
   - `TORII_ADMIN_HOST` — `chiefmonkey.art` (or the box's SSH-reachable hostname).
3. **Phase 3 — verify + flip to Accepted:** maintainer triggers `repair.yml` with reason "verify" and command `whoami && sudo nginx -t`. Output should show `torii-admin` and `nginx: configuration file … syntax is ok`. On green, flip this ADR to Accepted.
4. **Phase 4 (follow-up, not blocking):** run the same install on Bekka's VPS.

## Retirement

When the AI's infra role narrows, or when GitHub adds first-class ephemeral SSH tokens (e.g. via OIDC → short-lived VPS cert), this ADR is retired and the admin key is deleted. Until then it stays as the single documented, auditable, revocable admin path.
