// tests/autocap-diag.test.js — ADR-0134: diagnostic access to the autocap ring.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DIAG_PUBKEY } from '../src/engine/kami/diagKey.js';
import { sealJson } from '../src/engine/kami/kamiSeal.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const RT = read('src/arenaRuntime.js');
const KM = read('src/engine/kami/kamiMode.js');
const WF = read('.github/workflows/autocap-pull.yml');
const DISP = read('ops/torii-admin-run.sh');
const INST = read('ops/install-admin-ssh.sh');

describe('autocap diagnostics recipient', () => {
  it('is a valid x-only pubkey distinct from Kami', () => {
    expect(DIAG_PUBKEY).toMatch(/^[0-9a-f]{64}$/);
    expect(KM).not.toContain(DIAG_PUBKEY);
  });

  it('seals the 1 Hz autocap frames to owner + Kami + diagnostics', async () => {
    expect(RT).toMatch(/const recipients = \[ownerPub, KAMI_PUBKEY, DIAG_PUBKEY\]/);
    const env = await sealJson({ ok: 1 }, ['ea3ff08e8509ee77bf2188e4834ff5a5eb789cd5cfb4927325de10f5488d37a3', DIAG_PUBKEY]);
    expect(env.keys.map((k) => k.to.slice(-64))).toContain(DIAG_PUBKEY);
  });

  it('never seals the manual ema notes to the diagnostics key', () => {
    expect(KM).toMatch(/const recipients = \[ownerPub, KAMI_PUBKEY\];/);
    expect(KM).not.toMatch(/DIAG_PUBKEY/);
  });
});

describe('autocap-pull workflow + dispatcher', () => {
  it('uses the fixed export op, verifies the key, and keeps the artifact short-lived', () => {
    expect(WF).toContain('sudo /usr/local/sbin/torii-admin-run autocap-export');
    expect(WF).toContain('secrets.TORII_DIAG_PRIV');
    expect(WF).toContain('TORII_DIAG_PRIV does not match DIAG_PUBKEY');
    expect(WF).toMatch(/retention-days: 3/);
    expect(WF).toMatch(/workflow_dispatch/);
  });

  it('the dispatcher exports only the fixed ring path, with no arguments', () => {
    expect(DISP).toMatch(/AUTOCAP_PARENT=\/var\/lib\/torii-quest\/kami\n/);
    expect(DISP).toMatch(/autocap-export takes no arguments/);
    expect(DISP).toMatch(/find autocap -maxdepth 1 -type f -name '\*\.json' -print0/);
    // /var/lib is NOT a general read root.
    const roots = DISP.slice(DISP.indexOf("READ_ROOTS='"), DISP.indexOf("'\n", DISP.indexOf("READ_ROOTS='") + 12));
    expect(roots).not.toContain('/var/lib');
  });

  it('the installer pins the shipped dispatcher bytes', () => {
    const sum = createHash('sha256').update(readFileSync(new URL('../ops/torii-admin-run.sh', import.meta.url))).digest('hex');
    expect(INST).toContain(`DISPATCHER_SHA256="${sum}"`);
  });
});
