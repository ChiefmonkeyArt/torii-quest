// tests/install-remote.test.js — interface contract for install-remote.sh.
// install-remote.sh is a bash bootstrap (piped to `sudo bash`); we can't unit-
// test its git/clone handoff without a VPS, but we CAN pin the contract the
// operator sees + the install.sh hand-off by shelling out to `--help`.
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '..', 'install-remote.sh');
const run = (args) => execSync(`bash ${script} ${args}`, { encoding: 'utf8', maxBuffer: 1 << 20 });

describe('install-remote.sh — one-command VPS bootstrap (ADR-0079)', () => {
  it('--help exits 0 with no system changes', () => {
    expect(() => run('--help')).not.toThrow();
  });

  it('documents the bootstrap-only flags it consumes (not forwarded to install.sh)', () => {
    const out = run('--help');
    expect(out).toContain('--version');
    expect(out).toContain('--repo-dir');
  });

  it('names the canonical source-clone path /opt/torii-quest-src, NOT the runtime /opt/torii-quest', () => {
    const out = run('--help');
    expect(out).toContain('/opt/torii-quest-src');
    // /opt/torii-quest (runtime) must only appear as the thing to AVOID, never as
    // the source-clone destination.
    expect(out).toContain('NOT /opt/torii-quest');
  });

  it('lists the install.sh flags it forwards through', () => {
    const out = run('--help');
    expect(out).toContain('--domain');
    expect(out).toContain('--email');
    expect(out).toContain('--admin-npub');
    expect(out).toContain('--dry-run');
  });

  it('refuses to run as a non-root user with a clear message + non-zero exit', () => {
    // --version is consumed before the root check; --help would short-circuit.
    // Passing a forwarded arg keeps it past arg-parse to the root gate.
    let err;
    try { run('--version v0.2.712-alpha'); } catch (e) { err = e; }
    // The sandbox runs these tests as a non-root user, so the root gate trips.
    expect(err).toBeDefined();
    expect(String(err.stdout || err.stderr || err.message)).toContain('must run as root');
  });
});
