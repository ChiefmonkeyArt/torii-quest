// tests/app-boundary.test.js — locks the Torii Quest (game) vs Torii Quest
// (project-oversight dashboard) app boundary (v0.2.294). The R-series cleanup (R1
// dashboard SDK split, R2 lazy-THREE, R4 barrel-leak audit) established that:
//
//   1. Continuum dashboard / project-oversight surfaces are BUILD-ONLY. They must be
//      re-exported through the dedicated dashboard barrel (src/sdk/dashboard.js), NOT
//      the runtime SDK barrel (src/sdk/index.js), so their (tree-shake-hostile) string
//      /HTML weight never rides into the runtime app chunk.
//   2. No Quest game-runtime entry may import a Continuum-only module.
//   3. The BotAgent decision seam (engine/entities/bot-agent.js) stays pure — only
//      numeric tuning constants — so the bot AI layer is cleanly separable.
//
// These are STRUCTURAL guards (source-text + module-shape), so a future edit that
// re-leaks a dashboard surface into the runtime barrel — or pulls THREE/Continuum into
// the bot seam — fails here instead of silently regrowing the runtime bundle.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as SDK from '../src/sdk/index.js';
import * as DashboardSDK from '../src/sdk/dashboard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Continuum / project-oversight surfaces that must live in the DASHBOARD barrel only.
const DASHBOARD_ONLY = ['toriiQuestDashboard', 'hostRouteSmoke', 'updateFlowSmoke', 'handoffControlPanel'];

describe('Quest ↔ Continuum SDK barrel split', () => {
  it('the runtime SDK barrel re-exports NO Continuum dashboard-only surface', () => {
    for (const name of DASHBOARD_ONLY) {
      expect(SDK[name], `SDK.${name} must not be on the runtime barrel`).toBeUndefined();
      expect(SDK.SDK_SURFACE[name], `SDK_SURFACE.${name} must not be on the runtime barrel`).toBeUndefined();
    }
  });

  it('the dashboard barrel re-exports every Continuum dashboard-only surface', () => {
    for (const name of DASHBOARD_ONLY) {
      expect(DashboardSDK[name], `DashboardSDK.${name} present`).toBeTruthy();
      expect(DashboardSDK.DASHBOARD_SURFACE[name]?.tier, `DASHBOARD_SURFACE.${name} tier`)
        .toBe(DashboardSDK.STABILITY.EXPERIMENTAL);
    }
  });

  it('the runtime barrel source imports no Continuum dashboard/host module', () => {
    const src = read('src/sdk/index.js');
    expect(src).not.toMatch(/from ['"][^'"]*engine\/dashboard\//);
    expect(src).not.toMatch(/from ['"][^'"]*engine\/host\//);
    expect(src).not.toMatch(/handoffControlPanel\.js/);
    expect(src).not.toMatch(/updateFlowSmoke\.js/);
  });
});

describe('Quest game-runtime does not reach into Continuum', () => {
  // Representative Quest runtime entries: the shell, the lazy arena runtime, and the
  // bot runtime. None may import a Continuum project-oversight module.
  const RUNTIME_FILES = ['src/main.js', 'src/arenaRuntime.js', 'src/bots.js'];
  const FORBIDDEN = [
    /from ['"][^'"]*engine\/dashboard\//,
    /from ['"][^'"]*engine\/host\//,
    /from ['"][^'"]*engine\/status\/handoffControlPanel/,
    /from ['"][^'"]*sdk\/dashboard/,
  ];

  for (const f of RUNTIME_FILES) {
    it(`${f} imports no Continuum-only module`, () => {
      const src = read(f);
      for (const pat of FORBIDDEN) {
        expect(src, `${f} must not match ${pat}`).not.toMatch(pat);
      }
    });
  }
});

describe('BotAgent decision seam stays pure', () => {
  it('engine/entities/bot-agent.js imports only the config tuning constants', () => {
    const src = read('src/engine/entities/bot-agent.js');
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/from ['"]\.\.\/\.\.\/config\.js['"]/);
    // No THREE / Rapier / DOM / dashboard reach — the bot AI layer is cleanly separable.
    expect(src).not.toMatch(/from ['"]three['"]/);
    expect(src).not.toMatch(/@dimforge\/rapier/);
    expect(src).not.toMatch(/\b(document|window)\b/);
    expect(src).not.toMatch(/engine\/(dashboard|status|host)\//);
  });
});
