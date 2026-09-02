# ADR-0101: Auto-deploy to the VPS on tag push (deploy-only SSH key + GitHub Actions)

- **Status:** Accepted
- **Version target:** v0.2.745-alpha (or the next merged ship)
- **Landed:** 2026-09-02. Workflow in PR #107, ADR in PR #106. VPS side (deploy key + forced-command + `/usr/local/bin/torii-deploy-hook` + sudoers) installed same day. First live deploy will be the next real ship.
- **Supersedes / relates to:** none directly. Retires the manual `systemctl start torii-quest-update.service` step from every ship report.

## Context

Every ship today ends with a "VPS deploy pending" line in the Update-All checklist. The deploy itself is one command on the VPS (`sudo systemctl start torii-quest-update.service`) but it can't run from the AI's sandbox — no SSH keys, deliberately. The maintainer pastes the SSH command from a laptop or a phone terminal app on each ship. That's fine ergonomically but two problems keep biting us:

1. **Ships stack.** v0.2.742, v0.2.743, and v0.2.744 all shipped as tags before any of them reached the VPS. The live version drifted three releases behind main. Three-way lockstep (`main HEAD == latest tag == VPS`) is the standing rule; manual deploy silently violates it whenever life gets busy.
2. **Every "how do I make the AI deploy" conversation ends at the same fork:** paste keys into the chat (bad — ephemeral sandbox + secret exposure), give up remote-desktop control (worse), or keep the manual paste (what we have).

Nothing about the current setup is broken. But we've now shipped enough that a hands-off tag → deploy path is worth its weight.

## Decision

Add a **deploy-only SSH key** locked to the update-service invocation, stored as a GitHub Actions secret, and a small workflow that triggers on tag push. When CI auto-tags a merged PR (existing behaviour) the workflow SSHes into the VPS as the deploy user, kicks the update service, and streams a short journal excerpt as the workflow log. Nothing else changes — same runner, same install script, same version stamp.

### The key

- Generate on the VPS: `ssh-keygen -t ed25519 -f ~/.ssh/torii-deploy -C "torii-quest-deploy@github-actions" -N ""`.
- The public key goes in `/home/deploy/.ssh/authorized_keys` on the VPS as a **forced-command** entry, so the key can literally only run one thing:
  ```
  command="/usr/local/bin/torii-deploy-hook",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA...
  ```
- `/usr/local/bin/torii-deploy-hook` is a 6-line shell script owned by `root`, executable by the `deploy` user via a single sudoers rule:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  sudo mkdir -p /opt/torii-quest/mp/update-requests
  ts=$(date +%s)
  echo '{}' | sudo tee "/opt/torii-quest/mp/update-requests/manual-${ts}.json" > /dev/null
  sudo systemctl start torii-quest-update.service
  sudo journalctl -u torii-quest-update.service --since "10 seconds ago" -n 200 --no-pager
  ```
  Sudoers narrows the `deploy` user to exactly those three verbs (`mkdir` on that path, `tee` on that path, `systemctl start torii-quest-update.service`, `journalctl -u torii-quest-update.service`). No shell, no other services, no other paths.

### The workflow

A new file `.github/workflows/deploy-on-tag.yml`:

```yaml
name: Deploy to VPS on tag
on:
  push:
    tags: ['v*-alpha']
concurrency:
  group: torii-quest-vps-deploy
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Trigger VPS update service over SSH
        env:
          SSH_KEY: ${{ secrets.TORII_DEPLOY_SSH_KEY }}
          SSH_HOST: ${{ secrets.TORII_DEPLOY_HOST }}
        run: |
          set -euo pipefail
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/torii-deploy
          chmod 600 ~/.ssh/torii-deploy
          ssh-keyscan -t ed25519 -H "$SSH_HOST" >> ~/.ssh/known_hosts 2>/dev/null
          ssh -i ~/.ssh/torii-deploy -o BatchMode=yes deploy@$SSH_HOST
      - name: Verify live version matches tag
        run: |
          sleep 20
          live=$(curl -sf https://chiefmonkey.art/quest/ | grep -oE 'v0\.2\.[0-9]+-alpha' | head -1)
          echo "live=$live tag=${GITHUB_REF_NAME}"
          test "$live" = "${GITHUB_REF_NAME}"
```

- **Secrets:** `TORII_DEPLOY_SSH_KEY` (the private key contents), `TORII_DEPLOY_HOST` (`chiefmonkey.art`). Set in the repo's Actions → Secrets UI.
- **Concurrency lock:** only one deploy at a time. If two tags land back-to-back, the second waits for the first.
- **Verify step:** the workflow fails loud if the live page didn't update. Turns silent drift into a red badge in the Actions tab.
- **`v*-alpha` filter:** only alpha ship tags trigger. Doc-only tags or personal experiments don't.

### Rollout (as landed)

1. Generated ed25519 key on the VPS.
2. Registered public key with forced-command entry in `~ubuntu/.ssh/authorized_keys` pointing at `/usr/local/bin/torii-deploy-hook`.
3. Wrote `/usr/local/bin/torii-deploy-hook` (root-owned, 755) and `/etc/sudoers.d/torii-deploy` narrowing ubuntu to four verbs: `mkdir -p` (on the requests dir), `tee`, `systemctl start torii-quest-update.service`, `journalctl -u torii-quest-update.service`.
4. Copied private key into `TORII_DEPLOY_SSH_KEY` repo secret; `TORII_DEPLOY_HOST` = `chiefmonkey.art`.
5. Private key deleted from the VPS — GitHub Actions secrets is the only copy. Rotate by regenerating and re-uploading.
6. Verified end-to-end with a throwaway tag: SSH connected, forced-command ran, hook invoked the update service. Update service rejected the four-part throwaway tag via its own allowlist regex — correct behaviour, unrelated to the workflow. Throwaway tag deleted.

First live deploy runs on the next real `vX.Y.Z-alpha` tag.

### What we don't change

- The `torii-quest-update.service` unit itself. It stays exactly as it is.
- The manual deploy path. `sudo systemctl start torii-quest-update.service` still works — the automated path is additive.
- Version stamp locations, tag naming, PR flow. All identical.

## Consequences

**Positive:**

- `main HEAD == latest tag == VPS` becomes automatic. The three-way lockstep rule stops being a manual chore.
- The AI sandbox never touches SSH keys. The keys live where they should — on the VPS and in GitHub secrets, both of which the maintainer controls.
- The workflow's verify step is a **standing regression test** for the deploy pipeline itself. If the update service breaks, the deploy PR turns red instead of failing silently.
- Ship reports lose the "VPS deploy pending" line. The Update-All checklist gets one row shorter.

**Negative / open edges:**

- New moving part. The workflow, the hook script, and the sudoers rule are three small surfaces to keep working. Locking them down with the forced-command constraint keeps the blast radius small.
- If the VPS is unreachable (network outage, host down), the workflow fails. That's the right behaviour — better than silent success — but it will occasionally paint the Actions tab red for reasons unrelated to code. Acceptable.
- The deploy key, if leaked, can trigger the update service. That's the only thing it can do — it can't read files, run arbitrary commands, or reach any other service. Blast radius = "attacker can force the VPS to pull main and rebuild," which is a nuisance, not a compromise. Rotate the key by regenerating and updating the secret; no other cleanup needed.
- Doesn't retro-deploy old tags. v0.2.742–v0.2.744 already shipped by hand. From v0.2.745 onward, the workflow handles it.

## Test coverage

This ADR itself is procedural, not a code change, but the workflow file will get:

- A CI smoke that lints the YAML on every PR (`actionlint` step in the existing `test` job).
- The "Verify live version" step IS the runtime test — every future deploy is a live end-to-end assertion.

## Not in this ADR

- Multi-environment deploys (staging / prod split). We have one environment.
- Rollback automation. A rollback today is `git revert` → PR → merge → auto-deploy, which the new workflow handles.
- Blue/green swaps. The update service already does an atomic symlink swap on `/var/www/torii.quest/current`. Good enough.
- Broadening the key to run other services. If we need more automated verbs later, add another narrowly-scoped hook script, not a broader key.

## References

- `torii-quest-update.service` on the VPS (existing unit file)
- `/opt/torii-quest/mp/update-requests/` (existing trigger directory)
- The manual deploy command from every prior ship report
- GitHub Actions concurrency docs: https://docs.github.com/en/actions/using-jobs/using-concurrency
- SSH forced-command reference: https://man.openbsd.org/sshd#AUTHORIZED_KEYS_FILE_FORMAT
