// tests/v0.2.790-regression.test.js — sovereign-host purge (docs-pplx-purge).
//
// v0.2.790 removes every reference to the third-party AI-agent hosting platform
// (the `*.pplx.app` subdomains / "Perplexity") from Quest's runtime, tests,
// tooling, static assets, and ADRs — the project now runs fully self-hosted
// (chiefmonkey.art / Torii Suite) with no third-party publish/deploy dependency.
// This source-lock keeps that guarantee durable: any file reintroducing the
// third-party host name (or the old private-visit allowlist) fails the suite.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OWN_FILE = fileURLToPath(import.meta.url);
const ROOT = join(dirname(OWN_FILE), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Case-insensitive capture of any reference to the retired third-party host or
// its AI-agent platform (subdomain, product name, or project/task URL host).
const FORBIDDEN = /(pplx|perplexity)/i;

// The active "solution" surfaces that must stay free of the third-party host.
// Archival point-in-time reports (`torii-v*.md`, `MVP_*.md`) live at the repo
// root and are deliberately frozen (Option B) — they are NOT swept here.
const ACTIVE_SURFACES = ['src', 'public', 'tools', 'tests', 'docs/adr', 'index.html'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function collect(relPaths) {
  const files = [];
  for (const rel of relPaths) {
    const abs = join(ROOT, rel);
    if (statSync(abs).isDirectory()) walk(abs, files);
    else files.push(abs);
  }
  return files;
}

describe('v0.2.790 — sovereign-host purge (no pplx/perplexity reference)', () => {
  it('no active source/static/tooling/adr file references the third-party host', () => {
    const offenders = [];
    for (const f of collect(ACTIVE_SURFACES)) {
      // The source-lock's own prose names the very term it guards — skip itself.
      if (f === OWN_FILE) continue;
      const txt = readFileSync(f, 'utf8');
      const m = txt.match(FORBIDDEN);
      if (m) offenders.push(`${f.slice(ROOT.length + 1)} → “${m[0]}”`);
    }
    expect(offenders).toEqual([]);
  });

  it('src/main.js private-visit allowlist is localhost-only (no subdomain allowlist)', () => {
    const main = read('src/main.js');
    expect(main).toContain("return h === 'localhost';");
    expect(main).not.toContain('.pplx.app');
  });

  it('live-host fixtures resolve to chiefmonkey.art, never the retired subdomain', () => {
    const cfg = read('src/config.js');
    expect(cfg).not.toMatch(FORBIDDEN);
    expect(cfg).toContain('chiefmonkey.art');
  });
});