// tests/kami-keygen.test.js — audit F14: key generation must never silently
// overwrite the only default private-key file, must fail closed on a failed
// self-verify, must persist 0600, and must be excluded from git/docker.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKamiKey } from '../tools/kami-keygen.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tq-keygen-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

// A verifier that always claims success — the key crypto + write path are what
// F14 guards; the real seal round-trip lives behind the CLI's default verify.
const okVerifier = async () => true;

describe('generateKamiKey — exclusive creation (never overwrites by default)', () => {
  it('refuses to overwrite a pre-existing key and leaves it unchanged', async () => {
    const outPath = join(dir, 'kami-priv.hex');
    writeFileSync(outPath, 'PRE-EXISTING-KEY-SENTINEL\n', 'utf8');
    const r = await generateKamiKey({ outPath, verify: okVerifier });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/refusing to overwrite/);
    expect(readFileSync(outPath, 'utf8')).toBe('PRE-EXISTING-KEY-SENTINEL\n');
  });

  it('overwrites only with an explicit force (the deliberate rotate path)', async () => {
    const outPath = join(dir, 'kami-priv.hex');
    writeFileSync(outPath, 'OLD-KEY\n', 'utf8');
    const r = await generateKamiKey({ outPath, force: true, verify: okVerifier });
    expect(r.ok).toBe(true);
    expect(readFileSync(outPath, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
  });
});

describe('generateKamiKey — fail-closed self-verify', () => {
  it('writes nothing when verification returns false', async () => {
    const outPath = join(dir, 'kami-priv.hex');
    const r = await generateKamiKey({ outPath, verify: async () => false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/self-verify failed/);
    expect(existsSync(outPath)).toBe(false);
  });

  it('writes nothing when the verifier throws', async () => {
    const outPath = join(dir, 'kami-priv.hex');
    const r = await generateKamiKey({ outPath, verify: async () => { throw new Error('boom'); } });
    expect(r.ok).toBe(false);
    expect(existsSync(outPath)).toBe(false);
  });
});

describe('generateKamiKey — successful write contract', () => {
  it('writes a 64-hex private key with mode 0600 and prints the public key back', async () => {
    const outPath = join(dir, 'kami-priv.hex');
    const r = await generateKamiKey({ outPath, verify: okVerifier });
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.pubHex).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(outPath, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
    expect(statSync(outPath).mode & 0o777).toBe(0o600);
    // The public key must not be the private scalar (distinct values).
    expect(r.pubHex).not.toBe(readFileSync(outPath, 'utf8').trim());
  });
});

describe('F14 — key outputs are excluded from git and docker', () => {
  const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  it('.gitignore excludes the key file, *.priv.hex and .secrets/', () => {
    const g = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    expect(g).toMatch(/^kami-priv\.hex$/m);
    expect(g).toMatch(/^\*\.priv\.hex$/m);
    expect(g).toMatch(/^\.secrets\/$/m);
  });
  it('.dockerignore excludes the same key material from the build context', () => {
    const d = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
    expect(d).toMatch(/^kami-priv\.hex$/m);
    expect(d).toMatch(/^\*\.priv\.hex$/m);
    expect(d).toMatch(/^\.secrets\/$/m);
  });
});