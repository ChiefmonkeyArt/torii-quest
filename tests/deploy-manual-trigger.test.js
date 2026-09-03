// tests/deploy-manual-trigger.test.js — regression lock for ADR-0106 (never
// force-update). Deploys are manual-only: the workflow must trigger on
// workflow_dispatch, never automatically on a tag push or tag-release completion.
// This guards against a future re-enabling of auto-deploy.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const YML = readFileSync(new URL('../.github/workflows/deploy-manual.yml', import.meta.url), 'utf8');

describe('deploy-manual.yml (ADR-0106 never-force-update)', () => {
  it('triggers manually via workflow_dispatch', () => {
    expect(YML).toMatch(/workflow_dispatch/);
  });

  it('does NOT auto-fire on a tag push', () => {
    expect(YML).not.toMatch(/^\s*push:\s*$/m);
  });

  it('does NOT auto-fire on tag-release completion', () => {
    expect(YML).not.toMatch(/workflow_run/);
  });

  it('removes the former deploy-on-tag.yml (no auto-deploy workflow remains)', () => {
    expect(existsSync(new URL('../.github/workflows/deploy-on-tag.yml', import.meta.url))).toBe(false);
  });
});