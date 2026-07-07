// tests/torii-quest-dashboard.approval.test.js — split from torii-quest-dashboard.test.js (E3, v0.2.267).
// Slice: mvp-approval + playtest-results + approval-gate + handoff control panel + playtest verdict.
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

describe('mvp approval card (v0.2.221)', () => {
  it('degrades to an honest LAST-KNOWN pending model with no input (never throws)', () => {
    const mv = buildMvpApprovalModel();
    expect(mv.kind).toBe('last-known');
    expect(mv.badge).toBe(MVPAPPROVAL_BADGE);
    expect(mv.status).toBe('pending');
    expect(mv.approved).toBe(false);
    expect(mv.approvedBy).toBe(MVPAPPROVAL_LASTKNOWN.approvedBy);
    expect(Array.isArray(mv.metrics)).toBe(true);
    expect(mv.metrics.length).toBe(5);
    expect(mv.band).toBe('pending');
    expect(mv.pill).toBe('manual');
    expect(mv.statusLabel).toMatch(/MVP APPROVAL PENDING/);
    expect(mv.statusLabel).toMatch(/USER PLAYTEST \+ EXPLICIT OK REQUIRED/);
  });

  it('folds a LIVE pending record into a generated pending card with the clear next step', () => {
    const mv = buildMvpApprovalModel({
      status: 'pending', approved: false, version: 'v0.2.221-alpha',
      approvedBy: null, approvedAt: null,
    });
    expect(mv.kind).toBe('generated');
    expect(mv.band).toBe('pending');
    expect(mv.approved).toBe(false);
    const byLabel = Object.fromEntries(mv.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Approval status']).toBe('PENDING');
    expect(byLabel['Version']).toBe('v0.2.221-alpha');
    expect(byLabel['Approved by']).toMatch(/no approver yet/);
    expect(byLabel['Approved at']).toBe('—');
    expect(byLabel['Next step']).toMatch(/MVP approved/);
    expect(byLabel['Next step']).toMatch(/live-browser MVP playtest/);
  });

  it('renders approved ONLY when status approved AND approved flag AND who/when present (strict)', () => {
    const full = buildMvpApprovalModel({
      status: 'approved', approved: true, version: 'v0.2.221-alpha',
      approvedBy: 'user', approvedAt: '2026-06-26T00:00:00Z',
    });
    expect(full.approved).toBe(true);
    expect(full.band).toBe('approved');
    expect(full.pill).toBe('no-blocker');
    expect(full.statusLabel).toBe('MVP APPROVED');
    // A partial "approved" record (no provenance, or flag not set) must NOT render as approved.
    const partial = buildMvpApprovalModel({ status: 'approved', approved: false, version: 'v0.2.221-alpha' });
    expect(partial.approved).toBe(false);
    expect(partial.band).toBe('pending');
    const flagOnly = buildMvpApprovalModel({ status: 'approved', approved: true, version: 'v0.2.221-alpha' });
    expect(flagOnly.approved).toBe(false);
    expect(flagOnly.band).toBe('pending');
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { status: 'pending' },
      { status: 'approved', approved: true, version: 'v0.2.221-alpha', approvedBy: 'u', approvedAt: 't' },
      { status: 'weird' }]) {
      expect(allowed.has(buildMvpApprovalModel(input).pill)).toBe(true);
    }
  });

  it('toriiQuestDataJSON carries the mvpApproval model', () => {
    const j = toriiQuestDataJSON();
    expect(j.mvpApproval).toBeTruthy();
    expect(typeof j.mvpApproval.statusLabel).toBe('string');
    expect(j.mvpApproval.status).toBe('pending');
    expect(Array.isArray(j.mvpApproval.metrics)).toBe(true);
  });

  it('renderToriiQuestPage shows the MVP-approval section + badge + pending band pill', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('>MVP approval<');
    expect(html).toContain(MVPAPPROVAL_BADGE);
    expect(html).toContain('Approval status');
    expect(html).toContain('MVP APPROVAL PENDING');
  });

  it('SAFETY: a tag-injecting mvpApproval is escaped + no new script + hash intact', () => {
    const hostile = buildMvpApprovalModel({
      status: 'pending',
      version: 'v0<script>alert(1)</script>',
      approvedBy: '</section><script>evil()</script>',
    });
    const html = renderToriiQuestPage(buildToriiQuestModel({ mvpApproval: hostile }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });
});

describe('playtest results card (v0.2.223)', () => {
  it('degrades to an honest LAST-KNOWN not-run model with no input (never throws)', () => {
    const pr = buildPlaytestResultsCardModel();
    expect(pr.kind).toBe('last-known');
    expect(pr.badge).toBe(PLAYTESTRESULTS_BADGE);
    expect(pr.status).toBe('not-run');
    expect(pr.ran).toBe(false);
    expect(pr.complete).toBe(false);
    expect(pr.approvalImplied).toBe(false);
    expect(pr.total).toBe(PLAYTESTRESULTS_LASTKNOWN.total);
    expect(Array.isArray(pr.metrics)).toBe(true);
    expect(pr.metrics.length).toBe(5);
    expect(pr.band).toBe('not-run');
    expect(pr.pill).toBe('manual');
    expect(pr.statusLabel).toMatch(/PLAYTEST NOT RUN/);
  });

  it('folds a LIVE not-run state into a generated card with the clear next step', () => {
    const pr = buildPlaytestResultsCardModel({
      status: 'not-run', ran: false, total: 17,
      pass: 0, fail: 0, na: 0, blank: 17, other: 0, fails: [],
    });
    expect(pr.kind).toBe('generated');
    expect(pr.band).toBe('not-run');
    expect(pr.approvalImplied).toBe(false);
    const byLabel = Object.fromEntries(pr.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Results status']).toBe('NOT-RUN');
    expect(byLabel['Recorded']).toMatch(/no/);
    expect(byLabel['Items']).toMatch(/17 blank \/ 17/);
    expect(byLabel['Implies approval']).toMatch(/no/i);
    expect(byLabel['Next step']).toMatch(/MVP_PLAYTEST_RESULTS\.md/);
  });

  it('attention band on any FAIL surfaces the failing item ids; never implies approval', () => {
    const pr = buildPlaytestResultsCardModel({
      status: 'attention', total: 3, pass: 1, fail: 1, na: 0, blank: 1, other: 0,
      fails: ['shooter-1', 'aim-2'],
    });
    expect(pr.band).toBe('attention');
    expect(pr.pill).toBe('open-edge');
    expect(pr.approvalImplied).toBe(false);
    const byLabel = Object.fromEntries(pr.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Failing items']).toBe('shooter-1 · aim-2');
  });

  it('a fully COMPLETE playtest still renders NOT-AN-APPROVAL and approvalImplied stays false', () => {
    const pr = buildPlaytestResultsCardModel({
      status: 'complete', total: 3, pass: 2, fail: 0, na: 1, blank: 0, other: 0, fails: [],
    });
    expect(pr.band).toBe('complete');
    expect(pr.pill).toBe('no-blocker');
    expect(pr.complete).toBe(true);
    expect(pr.approvalImplied).toBe(false);
    expect(pr.statusLabel).toMatch(/NOT AN APPROVAL/);
    const byLabel = Object.fromEntries(pr.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Implies approval']).toMatch(/no/i);
    expect(byLabel['Next step']).toMatch(/MVP approved/);
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { status: 'not-run' }, { status: 'incomplete' }, { status: 'attention' },
      { status: 'complete' }, { status: 'unknown' }, { status: 'weird' }]) {
      expect(allowed.has(buildPlaytestResultsCardModel(input).pill)).toBe(true);
    }
  });

  it('toriiQuestDataJSON carries the playtestResults model', () => {
    const j = toriiQuestDataJSON();
    expect(j.playtestResults).toBeTruthy();
    expect(typeof j.playtestResults.statusLabel).toBe('string');
    expect(j.playtestResults.status).toBe('not-run');
    expect(j.playtestResults.approvalImplied).toBe(false);
    expect(Array.isArray(j.playtestResults.metrics)).toBe(true);
  });

  it('renderToriiQuestPage shows the Playtest-results section + badge + not-run band pill', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('>Playtest results<');
    expect(html).toContain(PLAYTESTRESULTS_BADGE);
    expect(html).toContain('Results status');
    expect(html).toContain('PLAYTEST NOT RUN');
  });

  it('SAFETY: a tag-injecting playtestResults is escaped + no new script + hash intact', () => {
    const hostile = buildPlaytestResultsCardModel({
      status: 'attention', total: 1, fail: 1,
      fails: ['</section><script>evil()</script>'],
    });
    const html = renderToriiQuestPage(buildToriiQuestModel({ playtestResults: hostile }));
    expect(html).not.toContain('<script>evil()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });
});

describe('handoff / release control panel section (v0.2.233)', () => {
  it('renders the curated handoff panel section with version, live URLs, and principles', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('Handoff / release control panel');
    expect(html).toContain('torii-quest.pplx.app');
    expect(html).toContain('dashboard.html');
    // The curated panel is a complete (green) surface with the blocker still pending.
    expect(html).toContain('HANDOFF READY');
    // At least one of the practical, non-religious operating principles is surfaced.
    expect(html).toContain('Self-sovereignty');
  });

  it('surfaces the Workflow invariants metric (the do-not-cancel-useful-jobs rule) in the panel section', () => {
    const html = renderToriiQuestPage();
    const section = html.slice(html.indexOf('Handoff / release control panel'));
    expect(section).toContain('Workflow invariants');
    // The rule text must be visible to a future agent/human reading the dashboard.
    expect(section.toLowerCase()).toContain('cancel a useful in-progress job');
    // …and it must not be mistaken for approval/deploy authorisation.
    expect(html).toContain('HANDOFF READY'); // still surface-complete, not MVP-approved
  });

  it('the rendered ethics copy contains NO religious language', () => {
    const html = renderToriiQuestPage();
    // The panel's ethics copy must read as a practical engineering compass, not doctrine.
    const denied = ['sacred', 'holy', 'worship', 'prayer', 'divine', 'scripture', 'doctrine', 'gospel', 'salvation'];
    for (const term of denied) {
      expect(new RegExp(`\\b${term}\\b`, 'i').test(html)).toBe(false);
    }
  });

  it('escapes injected handoff-panel content and keeps exactly one inline script + the CSP hash', () => {
    const evilPanel = buildToriiQuestModel({
      handoffPanel: {
        badge: 'B<script>alert(1)</script>',
        kind: 'generated',
        band: 'ready-pending',
        statusLabel: 'HANDOFF<script>evil()</script>',
        pill: 'manual',
        green: true,
        metrics: [{ label: 'X</section><script>x()</script>', value: '<img src=x onerror=alert(1)>' }],
        note: 'n<script>boom()</script>',
      },
    });
    const html = renderToriiQuestPage(evilPanel);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<script>x()</script>');
    expect(html).not.toContain('<script>boom()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });

  it('the panel pill stays within the allowed vocabulary', () => {
    const html = renderToriiQuestPage();
    const allowed = ['pill-no-blocker', 'pill-gated', 'pill-manual', 'pill-deferred', 'pill-open-edge'];
    // The handoff panel's pill class must be one of the known classes (no stray class injected).
    const section = html.slice(html.indexOf('Handoff / release control panel'));
    const pillMatch = section.match(/class="pill (pill-[a-z-]+)"/);
    expect(pillMatch).toBeTruthy();
    expect(allowed).toContain(pillMatch[1]);
  });
});

describe('MVP approval gate section (v0.2.234)', () => {
  it('renders the gate section with the verdict, the focus categories, and the clarifications', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('>MVP approval gate<');
    expect(html).toContain('MVP APPROVAL GATE · LOCAL · READ-ONLY · GREEN CHECKS ≠ HUMAN APPROVAL');
    // The curated gate is confidence-green but awaiting an explicit human OK — never approved.
    expect(html).toContain('awaiting-approval');
    // Each green automated signal is explicitly labelled confidence-only, not approval.
    expect(html).toContain('confidence only, not approval');
    // The manual playtest focus categories the user asked to be visible for sign-off.
    const lower = html.toLowerCase();
    for (const term of ['entry flow', 'shooter feel', 'headshot', 'bot behaviour',
      'footstep', 'reload', 'mirror', 'crate', 'nap monkey', 'dashboard clarity', 'fun']) {
      expect(lower).toContain(term);
    }
    // The clarifications make clear green checks are not approval and a smoke pass is not a playtest.
    expect(html).toContain('CONFIDENCE signals');
    expect(html).toContain('EXPLICIT human OK');
  });

  it('the gate copy contains NO religious language', () => {
    const html = renderToriiQuestPage();
    const denied = ['sacred', 'holy', 'worship', 'prayer', 'divine', 'scripture', 'doctrine', 'gospel', 'salvation'];
    for (const term of denied) {
      expect(new RegExp(`\\b${term}\\b`, 'i').test(html)).toBe(false);
    }
  });

  it('escapes injected gate content and keeps exactly one inline script + the CSP hash', () => {
    const evil = buildToriiQuestModel({
      mvpGate: {
        badge: 'B<script>alert(1)</script>',
        kind: 'generated',
        band: 'awaiting-approval',
        statusLabel: 'GATE<script>evil()</script>',
        pill: 'manual',
        verdict: 'awaiting-approval',
        approved: false,
        confidenceGreen: true,
        metrics: [{ label: 'X</section><script>x()</script>', value: '<img src=x onerror=alert(1)>' }],
        note: 'n<script>boom()</script>',
      },
    });
    const html = renderToriiQuestPage(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<script>x()</script>');
    expect(html).not.toContain('<script>boom()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });

  it('the gate pill stays within the allowed vocabulary', () => {
    const html = renderToriiQuestPage();
    const allowed = ['pill-no-blocker', 'pill-gated', 'pill-manual', 'pill-deferred', 'pill-open-edge'];
    const section = html.slice(html.indexOf('>MVP approval gate<'));
    const pillMatch = section.match(/class="pill (pill-[a-z-]+)"/);
    expect(pillMatch).toBeTruthy();
    expect(allowed).toContain(pillMatch[1]);
  });
});

describe('Playtest verdict section (v0.2.235)', () => {
  it('renders the verdict section with the badge, the focus categories, and the how-to', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('>Playtest verdict<');
    expect(html).toContain('MVP PLAYTEST VERDICT · LOCAL · READ-ONLY · TESTER VERDICT ≠ MVP APPROVAL');
    // Curated default ships blank → pending (no verdict recorded yet).
    expect(html).toContain('NO VERDICT RECORDED YET');
    // The one-line how-to so a tester knows exactly how to report.
    expect(html).toContain('Verdict: MVP OK');
    expect(html).toContain('Verdict: blockers:');
    // The verdict is a confidence signal — never an approval.
    const lower = html.toLowerCase();
    expect(lower).toContain('tester verdict');
    expect(lower).toContain('mvp_approval_state.json');
  });

  it('keeps every reported blocker VISIBLE in the rendered section', () => {
    const model = buildToriiQuestModel({
      playtestVerdict: {
        badge: 'MVP PLAYTEST VERDICT · LOCAL · READ-ONLY · TESTER VERDICT ≠ MVP APPROVAL',
        kind: 'generated', band: 'blocked',
        statusLabel: 'BLOCKERS REPORTED (2) — TRIAGE BEFORE APPROVAL', pill: 'open-edge',
        verdict: 'blocked', blockers: ['headshots flaky', 'crate jitter'], blockerCount: 2,
        metrics: [
          { label: 'Verdict', value: 'BLOCKED — 2 blocker(s)' },
          { label: 'Blockers', value: 'headshots flaky · crate jitter' },
        ],
        note: 'verdict note',
      },
    });
    const html = renderToriiQuestPage(model);
    const section = html.slice(html.indexOf('>Playtest verdict<'));
    expect(section).toContain('headshots flaky');
    expect(section).toContain('crate jitter');
  });

  it('the verdict copy contains NO religious language', () => {
    const html = renderToriiQuestPage();
    const denied = ['sacred', 'holy', 'worship', 'prayer', 'divine', 'scripture', 'doctrine', 'gospel', 'salvation'];
    for (const term of denied) {
      expect(new RegExp(`\\b${term}\\b`, 'i').test(html)).toBe(false);
    }
  });

  it('escapes injected verdict content and keeps exactly one inline script + the CSP hash', () => {
    const evil = buildToriiQuestModel({
      playtestVerdict: {
        badge: 'B<script>alert(1)</script>',
        kind: 'generated', band: 'blocked',
        statusLabel: 'V<script>evil()</script>', pill: 'open-edge',
        verdict: 'blocked', blockers: ['<img src=x onerror=alert(1)>'], blockerCount: 1,
        metrics: [{ label: 'X</section><script>x()</script>', value: '<img src=x onerror=alert(1)>' }],
        note: 'n<script>boom()</script>',
      },
    });
    const html = renderToriiQuestPage(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<script>x()</script>');
    expect(html).not.toContain('<script>boom()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });

  it('the verdict pill stays within the allowed vocabulary', () => {
    const html = renderToriiQuestPage();
    const allowed = ['pill-no-blocker', 'pill-gated', 'pill-manual', 'pill-deferred', 'pill-open-edge'];
    const section = html.slice(html.indexOf('>Playtest verdict<'));
    const pillMatch = section.match(/class="pill (pill-[a-z-]+)"/);
    expect(pillMatch).toBeTruthy();
    expect(allowed).toContain(pillMatch[1]);
  });
});
