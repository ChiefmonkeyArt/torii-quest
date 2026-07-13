// tests/torii-quest-dashboard.sdk.test.js — split from torii-quest-dashboard.test.js (E3, v0.2.267).
// Slice: SDK exposure.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  TORII_QUEST_VERSION, TORII_QUEST_BADGE, CONTINUUM,
  TORII_QUEST_REFRESH_SCRIPT, TORII_QUEST_SCRIPT_SHA256, TORII_QUEST_CSP,
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
  computeTotals, buildToriiQuestModel, toriiQuestDataJSON, renderToriiQuestPage,
} from '../src/engine/dashboard/toriiQuestDashboardData.js';
import * as SDK from '../src/sdk/index.js';
import * as DashboardSDK from '../src/sdk/dashboard.js';
import { VERSION } from '../src/config.js';
import { DEFAULT_TEST_STATUS } from '../src/engine/status/mvpReadiness.js';

describe('SDK exposure', () => {

  it('re-exports the torii-quest module at the experimental tier (dashboard barrel)', () => {
    // R1, v0.2.262: continuum is exposed via the dashboard barrel, not the runtime SDK barrel,
    // so it does not get pulled into the app chunk on every page load.
    expect(DashboardSDK.toriiQuestDashboard.TORII_QUEST_VERSION).toBe('v0.2.378-alpha');
    expect(typeof DashboardSDK.toriiQuestDashboard.renderToriiQuestPage).toBe('function');
    expect(DashboardSDK.DASHBOARD_SURFACE.toriiQuestDashboard.tier).toBe(DashboardSDK.STABILITY.EXPERIMENTAL);
    // Confirm the runtime SDK barrel no longer re-exports continuum.
    expect(SDK.toriiQuestDashboard).toBeUndefined();
    expect(SDK.SDK_SURFACE.toriiQuestDashboard).toBeUndefined();
  });

  it('re-exports the handoff control-panel module at the experimental tier (dashboard barrel)', () => {
    // R1 completed, v0.2.294: handoffControlPanel is a Continuum/build-only oversight surface
    // (no game-runtime importer), so it moved to the dashboard barrel and out of the runtime
    // SDK barrel — it no longer rides into the app chunk via the tree-shake-hostile re-export.
    expect(typeof DashboardSDK.handoffControlPanel.buildHandoffControlPanel).toBe('function');
    expect(typeof DashboardSDK.handoffControlPanel.isHandoffPanelGreen).toBe('function');
    expect(DashboardSDK.DASHBOARD_SURFACE.handoffControlPanel.tier).toBe(DashboardSDK.STABILITY.EXPERIMENTAL);
    // Confirm the runtime SDK barrel no longer re-exports it.
    expect(SDK.handoffControlPanel).toBeUndefined();
    expect(SDK.SDK_SURFACE.handoffControlPanel).toBeUndefined();
  });
});
