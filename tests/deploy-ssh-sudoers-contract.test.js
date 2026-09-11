// tests/deploy-ssh-sudoers-contract.test.js — locks the deploy SSH sudoers
// contract (audit F05/F06 + sudo-rs compatibility). The install-deploy-ssh.sh
// script must generate a sudoers entry that sudo-rs (the default sudo on
// Ubuntu 25.04+, and the live VPS) will accept: sudo-rs rejects wildcards in
// command ARGUMENTS, so `tee` must be pinned to the single fixed request file
// (manual.json) — never a `$REQ_DIR/*` glob — and the hook must write that
// fixed filename rather than a per-deploy timestamp suffix. Source-level
// assertions only; no VPS/sudo/network is exercised here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const installDeploySh = readFileSync(new URL('../ops/install-deploy-ssh.sh', import.meta.url), 'utf8');

describe('F05/F06 — deploy sudoers is sudo-rs compatible', () => {
  it('sudoers pins tee to the fixed manual.json path, not a wildcard', () => {
    // sudo-rs rejects `*` in command arguments; the grant must name one file.
    expect(installDeploySh).toMatch(
      /\/usr\/bin\/tee \$REQ_DIR\/manual\.json/,
    );
    expect(installDeploySh).not.toMatch(/tee \$REQ_DIR\/\*/);
  });

  it('sudoers still scopes mkdir to the request dir (no stale /opt path)', () => {
    expect(installDeploySh).toMatch(/\/usr\/bin\/mkdir -p \$REQ_DIR/);
    expect(installDeploySh).not.toMatch(/\/opt\/torii-quest\/mp\/update-requests/);
  });

  it('sudoers grants only the two service verbs, nothing else', () => {
    expect(installDeploySh).toMatch(/\/usr\/bin\/systemctl start torii-quest-update\.service/);
    expect(installDeploySh).toMatch(/\/usr\/bin\/journalctl -u torii-quest-update\.service/);
    // No broad shell or unconstrained verb.
    expect(installDeploySh).not.toMatch(/NOPASSWD\s*:\s*ALL\b/);
  });

  it('hook writes the fixed manual.json request file (no timestamp suffix)', () => {
    expect(installDeploySh).toMatch(/sudo tee "\$REQ_DIR\/manual\.json"/);
    expect(installDeploySh).not.toMatch(/\$\{ts\}/);
    expect(installDeploySh).not.toMatch(/date \+%s/);
  });

  it('forced-command key is preserved (no shell, no PTY, no forwarding)', () => {
    expect(installDeploySh).toMatch(/command="%s"/);
    expect(installDeploySh).toMatch(/no-port-forwarding/);
    expect(installDeploySh).toMatch(/no-pty/);
  });

  it('sudoers is validated before install (visudo -c)', () => {
    expect(installDeploySh).toMatch(/visudo -c -f "\$TMP"/);
  });
});