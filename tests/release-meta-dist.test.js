// tests/release-meta-dist.test.js — locks the v0.2.604 wiring that stamps a FRESH
// dist/release-metadata.json on every build (vite.config.js writeBundle hook).
// Before this, the committed public/release-metadata.json was the only copy + it
// was stale (v0.2.232, generatedAt:null, commit:null, wrong repo torii-gate), so
// torii-deploy falsely warned "not found on live site" + the in-app version panel
// read stale data. This test asserts the BUILT dist artifact carries provenance.
//
// Runs after `vite build` in the release gate (npm run test:release builds first).
// If dist/release-metadata.json is absent (standalone vitest without a build) the
// suite SKIPS rather than fails — the build step is the thing under test here.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST_META = join(ROOT, 'dist', 'release-metadata.json');
const CFG = join(ROOT, 'src', 'config.js');

const _cfgVersion = () => {
  const m = readFileSync(CFG, 'utf8').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
};

const _meta = (() => {
  if (!existsSync(DIST_META)) return null;
  try { return JSON.parse(readFileSync(DIST_META, 'utf8')); } catch { return null; }
})();

describe.skipIf(!_meta)('built dist/release-metadata.json (v0.2.604 stamp wiring)', () => {
  it('carries the current source version (not the stale v0.2.232)', () => {
    expect(_meta.version).toBe(_cfgVersion());
  });

  it('points at the real repo (torii-quest, not torii-gate)', () => {
    expect(_meta.source.repo).toBe('torii-quest');
    expect(_meta.source.owner).toBe('ChiefmonkeyArt');
  });

  it('has a non-null git commit (provenance baked at build time)', () => {
    expect(_meta.commit).toBeTruthy();
    expect(typeof _meta.commit).toBe('string');
  });

  it('has a non-null generatedAt timestamp', () => {
    expect(_meta.generatedAt).toBeTruthy();
    expect(typeof _meta.generatedAt).toBe('string');
  });

  it('stays descriptive-only — never authorises an auto-update', () => {
    expect(_meta.update.autoUpdate).toBe(false);
    expect(_meta.update.actionable).toBe(false);
    expect(_meta.update.manual).toBe(true);
  });
});
