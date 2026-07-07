// tests/next-action-state.assembly.test.js — split from next-action-state.test.js (E3, v0.2.267).
// Slice: buildNextActionState — folding handoff + cards + counts into the compact state.
import { describe, it, expect } from 'vitest';
import {
  NEXT_ACTION_STATE_SCHEMA, NEXT_ACTION_STATE_SCHEMA_VERSION,
  NEXT_ACTION_STATE_BADGE, NEXT_ACTION_STATE_REQUIRED_KEYS,
  buildNextActionState,
} from '../tools/nextActionState.mjs';
import { VERSION } from '../src/config.js';
import { buildHandoffControlPanel, WORKFLOW_INVARIANTS } from '../src/engine/status/handoffControlPanel.js';
import { buildMvpApprovalGate } from '../src/engine/status/mvpApprovalGate.js';
import { V, PKG, handoff, manualPending, manualClear } from './_next-action-state-helpers.js';

describe('buildNextActionState — assembly', () => {
  it('folds an agent-handoff + manual card + test count into a stable export', () => {
    const s = buildNextActionState({
      agentHandoff: handoff(), manualValidation: manualPending,
      testStatus: { passing: 1417, files: 87 },
      docs: ['torii-quest-handoff.md', 'torii-quest-progress.md'],
    });
    expect(s.schema).toBe(NEXT_ACTION_STATE_SCHEMA);
    expect(s.schemaVersion).toBe(NEXT_ACTION_STATE_SCHEMA_VERSION);
    expect(s.badge).toBe(NEXT_ACTION_STATE_BADGE);
    expect(s.generatedAt).toBe(null);
    expect(s.version).toBe(V);
    expect(s.packageVersion).toBe(PKG);
    expect(s.gitCommit).toBe('abc1234');
    expect(s.liveUrl).toBe('https://torii-quest.pplx.app');
    expect(s.release.ready).toBe(true);
    expect(s.release.gateStatus).toBe('READY');
    expect(s.release.gateCommand).toBe('npm run test:release');
    expect(s.release.regression).toEqual({ count: 15, expected: 15 });
    expect(s.readiness).toEqual({ pct: 100, status: 'READY' });
    expect(s.tests).toEqual({ passing: 1417, files: 87 });
    expect(s.nextSafeTask).toEqual({ title: 'Next infra slice', why: 'keep cadence', kind: 'infra' });
    expect(s.constraints).toContain('godMode false');
    expect(s.docs).toEqual(['torii-quest-handoff.md', 'torii-quest-progress.md']);
    expect(s.reports).toEqual(['torii-v0.2.216-no-blocker-queue-dashboard-report.md']);
  });

  it('always includes every required key, even with no inputs', () => {
    const s = buildNextActionState();
    for (const k of NEXT_ACTION_STATE_REQUIRED_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(s, k)).toBe(true);
    }
  });

  it('derives the manual-blocker flag from the manual-validation pill', () => {
    const pending = buildNextActionState({ agentHandoff: handoff(), manualValidation: manualPending });
    expect(pending.manualBlocker.pending).toBe(true);
    expect(pending.manualBlocker.pill).toBe('manual');
    expect(pending.manualBlocker.statusLabel).toContain('MANUAL PLAYTEST');

    const clear = buildNextActionState({ agentHandoff: handoff(), manualValidation: manualClear });
    expect(clear.manualBlocker.pending).toBe(false);
    expect(clear.manualBlocker.pill).toBe('no-blocker');
  });

  it('manual-blocker pending is null (unknown) when no manual card is supplied', () => {
    const s = buildNextActionState({ agentHandoff: handoff() });
    expect(s.manualBlocker.pending).toBe(null);
    expect(s.manualBlocker.pill).toBe(null);
  });

  it('folds a pending MVP approval record into the state (approved:false)', () => {
    const s = buildNextActionState({
      agentHandoff: handoff(),
      mvpApproval: {
        kind: 'torii.mvp-approval-state', schemaVersion: 1, status: 'pending',
        version: V, approved_by: null, approved_at: null,
      },
    });
    expect(s.mvpApproval).toEqual({ status: 'pending', approved: false, approvedBy: null, approvedAt: null, version: V });
  });

  it('reports approved MVP approval only when the record is valid (who/when present)', () => {
    const valid = buildNextActionState({
      agentHandoff: handoff(),
      mvpApproval: {
        kind: 'torii.mvp-approval-state', schemaVersion: 1, status: 'approved',
        version: V, commit: null, approved_by: 'chiefmonkey', approved_at: '2026-06-26T12:00:00Z',
      },
    });
    expect(valid.mvpApproval.approved).toBe(true);
    expect(valid.mvpApproval.approvedBy).toBe('chiefmonkey');

    const partial = buildNextActionState({
      agentHandoff: handoff(),
      mvpApproval: { kind: 'torii.mvp-approval-state', schemaVersion: 1, status: 'approved', version: V },
    });
    expect(partial.mvpApproval.approved).toBe(false);
  });

  it('MVP approval degrades to unknown when no record is supplied', () => {
    const s = buildNextActionState({ agentHandoff: handoff() });
    expect(s.mvpApproval).toEqual({ status: 'unknown', approved: false, approvedBy: null, approvedAt: null, version: null });
  });

  it('folds the MVP playtest results into the state and pins approvalImplied false', () => {
    const notRun = buildNextActionState({ agentHandoff: handoff(), playtestResults: null });
    expect(notRun.playtestResults.status).toBe('unknown');
    expect(notRun.playtestResults.approvalImplied).toBe(false);

    const summary = { schema: 'torii.playtest-results-summary', total: 2, counts: { total: 2, pass: 0, fail: 0, na: 0, blank: 2, other: 0 }, fails: [], verdict: 'EMPTY' };
    const blank = buildNextActionState({ agentHandoff: handoff(), playtestResults: summary });
    expect(blank.playtestResults.status).toBe('not-run');
    expect(blank.playtestResults.pending).toBe(true);
    expect(blank.playtestResults.approvalImplied).toBe(false);
  });

  it('a fully complete playtest still never implies approval', () => {
    const summary = { schema: 'torii.playtest-results-summary', total: 2, counts: { total: 2, pass: 1, fail: 0, na: 1, blank: 0, other: 0 }, fails: [], verdict: 'COMPLETE' };
    const s = buildNextActionState({ agentHandoff: handoff(), playtestResults: summary });
    expect(s.playtestResults.status).toBe('complete');
    expect(s.playtestResults.complete).toBe(true);
    expect(s.playtestResults.approvalImplied).toBe(false);
  });

  it('folds the one-line playtest verdict, keeps blockers visible, and never implies approval', () => {
    const pending = buildNextActionState({ agentHandoff: handoff(), playtestVerdict: null });
    expect(pending.playtestVerdict.verdict).toBe('pending');
    expect(pending.playtestVerdict.approvalImplied).toBe(false);

    const ok = buildNextActionState({ agentHandoff: handoff(), playtestVerdict: { schema: 'torii.playtest-verdict', verdict: 'ok', blockers: [], reportedBy: 'Chiefmonkey', reportedAt: '2026-06-27' } });
    expect(ok.playtestVerdict.verdict).toBe('ok');
    expect(ok.playtestVerdict.reported).toBe(true);
    expect(ok.playtestVerdict.approvalImplied).toBe(false);

    const blocked = buildNextActionState({ agentHandoff: handoff(), playtestVerdict: { schema: 'torii.playtest-verdict', verdict: 'blocked', blockers: ['headshots flaky', 'crate jitter'] } });
    expect(blocked.playtestVerdict.verdict).toBe('blocked');
    expect(blocked.playtestVerdict.blockerCount).toBe(2);
    expect(blocked.playtestVerdict.blockers).toEqual(['headshots flaky', 'crate jitter']);
    expect(blocked.playtestVerdict.approvalImplied).toBe(false);
  });

  it('exposes playtestVerdict as a required key', () => {
    expect(NEXT_ACTION_STATE_REQUIRED_KEYS).toContain('playtestVerdict');
  });

  it('folds the live-smoke state and pins impliesApproval false', () => {
    const unknown = buildNextActionState({ agentHandoff: handoff(), liveSmoke: null });
    expect(unknown.liveSmoke).toMatchObject({ result: 'unknown', pass: false, impliesApproval: false });

    const smoke = {
      kind: 'torii.live-smoke-state', schemaVersion: 1, result: 'pass',
      version: 'v0.2.230-alpha', smokedAt: '2026-06-26',
      checks: [
        { id: 'a', label: 'A', expected: 'x', observed: 'x', outcome: 'pass' },
        { id: 'b', label: 'B', expected: 'y', observed: 'y', outcome: 'pass' },
      ],
    };
    const green = buildNextActionState({ agentHandoff: handoff(), liveSmoke: smoke });
    expect(green.liveSmoke).toMatchObject({
      result: 'pass', pass: true, version: 'v0.2.230-alpha', smokedAt: '2026-06-26',
      checks: 2, passed: 2, failed: 0, impliesApproval: false,
    });
  });

  it('folds the dashboard-smoke state and pins approval + playtest-complete false', () => {
    const unknown = buildNextActionState({ agentHandoff: handoff(), dashboardSmoke: null });
    expect(unknown.dashboardSmoke).toMatchObject({
      result: 'unknown', pass: false, impliesApproval: false, impliesPlaytestComplete: false,
    });

    const dash = {
      kind: 'torii.dashboard-smoke-state', schemaVersion: 1, result: 'pass',
      version: 'v0.2.231-alpha', surface: 'dashboard.html', smokedAt: '2026-06-26',
      checks: [
        { id: 'a', label: 'A', expected: 'x', observed: 'x', outcome: 'pass' },
        { id: 'b', label: 'B', expected: 'y', observed: 'y', outcome: 'pass' },
      ],
    };
    const green = buildNextActionState({ agentHandoff: handoff(), dashboardSmoke: dash });
    expect(green.dashboardSmoke).toMatchObject({
      result: 'pass', pass: true, version: 'v0.2.231-alpha', surface: 'dashboard.html',
      smokedAt: '2026-06-26', checks: 2, passed: 2, failed: 0,
      impliesApproval: false, impliesPlaytestComplete: false,
    });
  });

  it('folds the handoff control panel and pins approval + playtest-complete false', () => {
    const unknown = buildNextActionState({ agentHandoff: handoff(), handoffControlPanel: null });
    expect(unknown.controlPanel).toMatchObject({
      green: false, impliesApproval: false, impliesPlaytestComplete: false,
    });

    const panel = buildHandoffControlPanel({
      version: VERSION,
      entrySmoke: { result: 'pass', pass: true, version: 'v0.2.230-alpha', checks: 3, passed: 3, failed: 0 },
      dashboardSmoke: { result: 'pass', pass: true, version: 'v0.2.231-alpha', checks: 4, passed: 4, failed: 0 },
      manualBlocker: { pending: true, statusLabel: 'pending', pill: 'manual' },
      mvpApproval: { approved: false, status: 'pending' },
      nextSafeTask: { title: 'safe slice', why: 'x', kind: 'infra' },
    });
    const green = buildNextActionState({ agentHandoff: handoff(), handoffControlPanel: panel });
    expect(green.controlPanel).toMatchObject({
      green: true, version: VERSION, manualBlockerPending: true, ethicsNonReligious: true,
      impliesApproval: false, impliesPlaytestComplete: false,
    });
  });

  it('folds the MVP approval gate, never reading approved without an explicit OK', () => {
    const unknown = buildNextActionState({ agentHandoff: handoff(), mvpGate: null });
    expect(unknown.mvpGate).toMatchObject({
      verdict: 'unknown', approved: false, impliesApproval: false, impliesPlaytestComplete: false,
    });

    // A confidence-green but approval-pending gate folds as awaiting-approval, NOT approved.
    const pendingGate = buildMvpApprovalGate({
      version: VERSION, releaseReady: true, entrySmokePass: true, dashboardSmokePass: true,
      tests: { passing: 1600, files: 96 }, approval: { approved: false, status: 'pending' },
    });
    const pending = buildNextActionState({ agentHandoff: handoff(), mvpGate: pendingGate });
    expect(pending.mvpGate).toMatchObject({
      verdict: 'awaiting-approval', approved: false, confidenceGreen: true,
      impliesApproval: false, impliesPlaytestComplete: false,
    });

    // Only an explicit human OK (approver + timestamp) folds as approved.
    const approvedGate = buildMvpApprovalGate({
      version: VERSION, releaseReady: true, entrySmokePass: true, dashboardSmokePass: true,
      tests: { passing: 1600, files: 96 },
      approval: { approved: true, status: 'approved', approvedBy: 'Chiefmonkey', approvedAt: '2026-06-27T12:00:00Z' },
    });
    const approved = buildNextActionState({ agentHandoff: handoff(), mvpGate: approvedGate });
    expect(approved.mvpGate).toMatchObject({ verdict: 'approved', approved: true, impliesApproval: false });
  });

  it('includes mvpGate in the required-keys list', () => {
    expect(NEXT_ACTION_STATE_REQUIRED_KEYS).toContain('mvpGate');
  });

  it('carries the workflow invariants verbatim (the do-not-cancel-useful-jobs rule + exceptions)', () => {
    const s = buildNextActionState({ agentHandoff: handoff() });
    expect(Array.isArray(s.workflowInvariants)).toBe(true);
    expect(s.workflowInvariants).toEqual(Array.from(WORKFLOW_INVARIANTS));
    expect(s.workflowInvariants[0]).toMatch(/cancel a useful in-progress job/i);
    // the rule is workflow guidance ONLY — it must never flip the standing safety posture.
    expect(s.safety.deploy).toBe(false);
    expect(s.safety.publish).toBe(false);
  });

  it('includes workflowInvariants in the required-keys list', () => {
    expect(NEXT_ACTION_STATE_REQUIRED_KEYS).toContain('workflowInvariants');
  });

  it('honours a caller-supplied workflowInvariants array (trimmed, non-empty only)', () => {
    const s = buildNextActionState({ agentHandoff: handoff(), workflowInvariants: ['  finish the job  ', '', '   '] });
    expect(s.workflowInvariants).toEqual(['finish the job']);
  });

  it('pins the standing safety posture all-false (read-only oversight, godMode false)', () => {
    const s = buildNextActionState({ agentHandoff: handoff() });
    expect(s.safety).toEqual({
      deploy: false, publish: false, push: false, tag: false,
      networkWrite: false, nostrWrite: false, godMode: false,
    });
  });

  it('degrades safely with no inputs (honest nulls, never throws)', () => {
    const s = buildNextActionState();
    expect(s.schema).toBe(NEXT_ACTION_STATE_SCHEMA);
    expect(s.version).toBe(null);
    expect(s.gitCommit).toBe(null);
    expect(s.release.ready).toBe(false);
    expect(s.release.gateStatus).toBe('UNKNOWN');
    expect(s.readiness.status).toBe('UNKNOWN');
    expect(s.tests).toEqual({ passing: null, files: null });
    expect(s.docs).toEqual([]);
    expect(s.reports).toEqual([]);
  });

  it('tolerates garbled inputs (arrays / wrong types) without throwing', () => {
    const s = buildNextActionState({ agentHandoff: [1, 2], manualValidation: 'nope', testStatus: 5, docs: 'x' });
    expect(s.version).toBe(null);
    expect(s.release.gateStatus).toBe('UNKNOWN');
    expect(s.docs).toEqual([]);
  });
});
