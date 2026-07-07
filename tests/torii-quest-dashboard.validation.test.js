// tests/torii-quest-dashboard.validation.test.js — split from torii-quest-dashboard.test.js (E3, v0.2.267).
// Slice: manual-validation + no-blocker-queue cards.
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

describe('manual validation / MVP-playtest readiness (v0.2.215)', () => {
  it('degrades to an honest LAST-KNOWN model with no input (never throws)', () => {
    const mv = buildManualValidationModel();
    expect(mv.kind).toBe('last-known');
    expect(mv.badge).toBe(MANUALVALIDATION_BADGE);
    expect(mv.sections).toBe(MANUALVALIDATION_LASTKNOWN.sections);
    expect(mv.items).toBe(MANUALVALIDATION_LASTKNOWN.items);
    expect(Array.isArray(mv.metrics)).toBe(true);
    expect(mv.metrics.length).toBe(6);
    // Docs present + a READY last gate → local gates green, manual playtest still pending.
    expect(mv.band).toBe('gates-green');
    expect(mv.pill).toBe('manual');
    expect(mv.statusLabel).toMatch(/MANUAL PLAYTEST \+ APPROVAL PENDING/);
  });

  it('folds LIVE checklist counts into a generated band that SEPARATES automated vs manual', () => {
    const mv = buildManualValidationModel({
      sections: 13, items: 17, blocker: 4, major: 5, minor: 8,
      validationAreas: 7, checklistDocPresent: true, resultsTemplatePresent: true,
      gateStatusLabel: 'READY',
    });
    expect(mv.kind).toBe('generated');
    expect(mv.band).toBe('gates-green');
    const byLabel = Object.fromEntries(mv.metrics.map((m) => [m.label, m.value]));
    // Local automated gates report GREEN, but the manual playtest is explicitly PENDING.
    expect(byLabel['Local automated gates']).toMatch(/READY/);
    expect(byLabel['Manual playtest']).toMatch(/PENDING/);
    expect(byLabel['Manual playtest']).toMatch(/approval required/i);
    expect(byLabel['Playtest checklist']).toBe('13 sections · 17 items');
    expect(byLabel['Severity coverage']).toBe('4 blocker · 5 major · 8 minor');
  });

  it('reports PLAYTEST DOCS INCOMPLETE when the checklist or results-template doc is missing', () => {
    const noChecklist = buildManualValidationModel({ checklistDocPresent: false, resultsTemplatePresent: true, gateStatusLabel: 'READY' });
    expect(noChecklist.band).toBe('docs-incomplete');
    expect(noChecklist.pill).toBe('gated');
    expect(noChecklist.statusLabel).toBe('PLAYTEST DOCS INCOMPLETE');
    const noTemplate = buildManualValidationModel({ checklistDocPresent: true, resultsTemplatePresent: false, gateStatusLabel: 'READY' });
    expect(noTemplate.band).toBe('docs-incomplete');
  });

  it('reports MANUAL VALIDATION OUTSTANDING when docs ready but the local gate is not green', () => {
    const mv = buildManualValidationModel({ checklistDocPresent: true, resultsTemplatePresent: true, gateStatusLabel: 'NEAR' });
    expect(mv.band).toBe('manual-outstanding');
    expect(mv.pill).toBe('manual');
    expect(mv.statusLabel).toBe('MANUAL VALIDATION OUTSTANDING');
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { checklistDocPresent: true, resultsTemplatePresent: true, gateStatusLabel: 'READY' },
      { checklistDocPresent: true, resultsTemplatePresent: true, gateStatusLabel: 'NEAR' },
      { checklistDocPresent: false, resultsTemplatePresent: true, gateStatusLabel: 'READY' }]) {
      expect(allowed.has(buildManualValidationModel(input).pill)).toBe(true);
    }
  });

  it('toriiQuestDataJSON carries the manualValidation model', () => {
    const j = toriiQuestDataJSON();
    expect(j.manualValidation).toBeTruthy();
    expect(typeof j.manualValidation.statusLabel).toBe('string');
    expect(Array.isArray(j.manualValidation.metrics)).toBe(true);
  });

  it('renderToriiQuestPage shows the manual-validation section + badge + band pill', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('Manual validation');
    expect(html).toContain(MANUALVALIDATION_BADGE);
    expect(html).toContain('Local automated gates');
    expect(html).toContain('Manual playtest');
    expect(html).toContain('Playtest checklist');
  });

  it('SAFETY: a tag-injecting manualValidation is escaped + no new script + hash intact', () => {
    const hostile = buildManualValidationModel({
      gateStatusLabel: 'READY<script>alert(1)</script>',
      checklistDocPresent: true, resultsTemplatePresent: true,
      areas: ['<img src=x onerror=alert(1)>', '</section><script>evil()</script>'],
    });
    const html = renderToriiQuestPage(buildToriiQuestModel({ manualValidation: hostile }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<img src=x');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });
});

describe('no-blocker queue (v0.2.216)', () => {
  it('degrades to an honest LAST-KNOWN model with no input (never throws)', () => {
    const nb = buildNoBlockerQueueModel();
    expect(nb.kind).toBe('last-known');
    expect(nb.badge).toBe(NOBLOCKERQUEUE_BADGE);
    expect(nb.activeNow).toBe(NOBLOCKERQUEUE_LASTKNOWN.activeNow);
    expect(nb.nextUp).toBe(NOBLOCKERQUEUE_LASTKNOWN.nextUp);
    expect(Array.isArray(nb.metrics)).toBe(true);
    expect(nb.metrics.length).toBe(6);
    // A queued safe task + manual playtest still pending → no-blocker work available, user-gated noted.
    expect(nb.band).toBe('safe-available');
    expect(nb.pill).toBe('no-blocker');
    expect(nb.statusLabel).toMatch(/NO-BLOCKER WORK AVAILABLE/);
    expect(nb.statusLabel).toMatch(/MANUAL PLAYTEST AWAITS USER/);
  });

  it('folds LIVE parsed todo/progress counts into a generated band that SEPARATES safe vs user-gated', () => {
    const nb = buildNoBlockerQueueModel({
      nextSafeTitle: 'Next safe infra/dashboard slice',
      nextSafeKind: 'infra',
      activeNow: 42, nextUp: 12, archiveClusters: 11, completed24h: 27, todoCompletedMarkers: 12,
      manualPending: true,
    });
    expect(nb.kind).toBe('generated');
    expect(nb.band).toBe('safe-available');
    const byLabel = Object.fromEntries(nb.metrics.map((m) => [m.label, m.value]));
    // The safe next task an agent can pick up with no user input is explicit...
    expect(byLabel['Next safe task']).toBe('Next safe infra/dashboard slice');
    expect(byLabel['Why safe']).toMatch(/no runtime risk/);
    expect(byLabel['Why safe']).toMatch(/no deploy/);
    // ...while the ONLY user-gated item is the manual playtest + approval.
    expect(byLabel['Awaiting user']).toMatch(/playtest \+ explicit approval/i);
    expect(byLabel['Awaiting user']).toMatch(/ONLY user-gated/);
    expect(byLabel['Active now']).toBe('42 in progress');
    expect(byLabel['Next up']).toBe('12 queued · next-12');
    expect(byLabel['Archive / done']).toMatch(/11 landed clusters · 27 done \(24h\) · 12 struck markers/);
  });

  it('drops the user-gated clause when no manual validation is pending', () => {
    const nb = buildNoBlockerQueueModel({ nextSafeTitle: 'safe slice', manualPending: false });
    expect(nb.band).toBe('safe-available-clear');
    expect(nb.pill).toBe('no-blocker');
    expect(nb.statusLabel).toBe('NO-BLOCKER WORK AVAILABLE');
    const byLabel = Object.fromEntries(nb.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Awaiting user']).toMatch(/nothing/i);
  });

  it('invalid / omitted counts fall back to the honest last-known values (never NaN)', () => {
    const nb = buildNoBlockerQueueModel({
      nextSafeTitle: 'safe slice', activeNow: -3, nextUp: 'oops', archiveClusters: null,
    });
    expect(nb.activeNow).toBe(NOBLOCKERQUEUE_LASTKNOWN.activeNow);
    expect(nb.nextUp).toBe(NOBLOCKERQUEUE_LASTKNOWN.nextUp);
    expect(nb.archiveClusters).toBe(NOBLOCKERQUEUE_LASTKNOWN.archiveClusters);
    expect(Number.isInteger(nb.activeNow)).toBe(true);
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { nextSafeTitle: 'x', manualPending: true },
      { nextSafeTitle: 'x', manualPending: false },
      { nextSafeTitle: 'x', activeNow: 0, nextUp: 0 }]) {
      expect(allowed.has(buildNoBlockerQueueModel(input).pill)).toBe(true);
    }
  });

  it('toriiQuestDataJSON carries the noBlockerQueue model', () => {
    const j = toriiQuestDataJSON();
    expect(j.noBlockerQueue).toBeTruthy();
    expect(typeof j.noBlockerQueue.statusLabel).toBe('string');
    expect(Array.isArray(j.noBlockerQueue.metrics)).toBe(true);
  });

  it('renderToriiQuestPage shows the no-blocker-queue section + badge + band pill', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('No-blocker queue');
    expect(html).toContain(NOBLOCKERQUEUE_BADGE);
    expect(html).toContain('Next safe task');
    expect(html).toContain('Awaiting user');
    expect(html).toContain('Active now');
  });

  it('SAFETY: a tag-injecting noBlockerQueue is escaped + no new script + hash intact', () => {
    const hostile = buildNoBlockerQueueModel({
      nextSafeTitle: 'safe<script>alert(1)</script>',
      nextSafeKind: '</section><script>evil()</script>',
      activeNow: 1, manualPending: true,
    });
    const html = renderToriiQuestPage(buildToriiQuestModel({ noBlockerQueue: hostile }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });
});
