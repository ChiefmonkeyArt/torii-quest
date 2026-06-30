// tests/continuum-dashboard.sdk.test.js — split from continuum-dashboard.test.js (E3, v0.2.267).
// Slice: SDK exposure.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CONTINUUM_VERSION, CONTINUUM_BADGE, CONTINUUM,
  CONTINUUM_REFRESH_SCRIPT, CONTINUUM_SCRIPT_SHA256, CONTINUUM_CSP,
  CURRENT_TEST_STATUS, testCountLabel,
  HEALTH_LASTKNOWN, buildHealthModel,
  SEED_MILESTONES, buildMilestoneModel,
  READINESS_BADGE, buildReadinessModel,
  SHIP_BADGE, SHIP_LASTKNOWN, SHIP_NEXT_SAFE_TASK, buildShipModel,
  RCSTATUS_BADGE, RCSTATUS_LASTKNOWN, buildRcStatusModel,
  MANUALVALIDATION_BADGE, MANUALVALIDATION_LASTKNOWN, buildManualValidationModel,
  NOBLOCKERQUEUE_BADGE, NOBLOCKERQUEUE_LASTKNOWN, buildNoBlockerQueueModel,
  MVPAPPROVAL_BADGE, MVPAPPROVAL_LASTKNOWN, buildMvpApprovalModel,
  PLAYTESTRESULTS_BADGE, PLAYTESTRESULTS_LASTKNOWN, buildPlaytestResultsCardModel,
  READHEALTH_BADGE, buildReadHealthModel,
  CLICKTHROUGH_BADGE, CLICKTHROUGH_VIEWS, buildClickThroughModel,
  escapeHtml, clampPct, barCells, ringDash,
  computeTotals, buildContinuumModel, continuumDataJSON, renderContinuumPage,
} from '../src/engine/dashboard/continuumData.js';
import * as SDK from '../src/sdk/index.js';
import * as DashboardSDK from '../src/sdk/dashboard.js';
import { VERSION } from '../src/config.js';
import { DEFAULT_TEST_STATUS } from '../src/engine/status/mvpReadiness.js';

describe('SDK exposure', () => {

  it('re-exports the continuum module at the experimental tier (dashboard barrel)', () => {
    // R1, v0.2.262: continuum is exposed via the dashboard barrel, not the runtime SDK barrel,
    // so it does not get pulled into the app chunk on every page load.
    expect(DashboardSDK.continuum.CONTINUUM_VERSION).toBe('v0.2.283-alpha');
    expect(typeof DashboardSDK.continuum.renderContinuumPage).toBe('function');
    expect(DashboardSDK.DASHBOARD_SURFACE.continuum.tier).toBe(DashboardSDK.STABILITY.EXPERIMENTAL);
    // Confirm the runtime SDK barrel no longer re-exports continuum.
    expect(SDK.continuum).toBeUndefined();
    expect(SDK.SDK_SURFACE.continuum).toBeUndefined();
  });

  it('re-exports the handoff control-panel module at the experimental tier', () => {
    expect(typeof SDK.handoffControlPanel.buildHandoffControlPanel).toBe('function');
    expect(typeof SDK.handoffControlPanel.isHandoffPanelGreen).toBe('function');
    expect(SDK.SDK_SURFACE.handoffControlPanel.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});
