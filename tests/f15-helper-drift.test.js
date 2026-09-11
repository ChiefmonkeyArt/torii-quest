// tests/f15-helper-drift.test.js — audit F15: build/reporting helpers must not
// drift from the implemented capability. The unit-testable changes (kamiNostr OK
// correlation, bundleSizes torii-entry classification) have functional tests in
// their own files; this locks the pure-source corrections.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('F15 — kami-nostr-reply --dry-run is genuinely read-only', () => {
  const src = read('tools/kami-nostr-reply.mjs');
  it('exits on dry-run BEFORE the appendReply local write', () => {
    const dry = src.indexOf('if (args.dryRun)');
    const append = src.indexOf('store.appendReply');
    expect(dry).toBeGreaterThan(-1);
    expect(append).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(append);
    expect(src.slice(dry)).toMatch(/no jsonl write/);
  });
});

describe('F15 — bump-ver.sh header no longer over-claims', () => {
  const src = read('tools/bump-ver.sh');
  it('does not claim it rebuilds dist or runs tests', () => {
    expect(src).not.toMatch(/rebuilds continuum data, runs tests/);
  });
});

describe('F15 — generated guidance reflects the live signing paths', () => {
  it('playtest advisories no longer claim there is no signing/publishing', () => {
    const src = read('tools/playtestChecklist.mjs');
    expect(src).not.toMatch(/there is no signing\/publishing/);
    expect(src).toMatch(/signed login, character publication/);
  });
  it('release notes no longer claim no signing and no publishing', () => {
    const src = read('tools/releaseNotes.mjs');
    expect(src).not.toMatch(/No signing and no publishing/);
    expect(src).toMatch(/Signed login, character publication/);
  });
});

describe('F15 — docker build context excludes operator environment', () => {
  const src = read('.dockerignore');
  it('excludes .env and .env.* from `COPY . .`', () => {
    expect(src).toMatch(/^\.env$/m);
    expect(src).toMatch(/^\.env\.\*$/m);
  });
});