// tests/next-action-state.test.js — pure NEXT-ACTION STATE assembly + formatting
// (tools/nextActionState.mjs, v0.2.217). Covers buildNextActionState (flattening an
// agent-handoff export + a manual-validation card + a curated test count into one compact
// machine-readable next-action state), the required-keys guard, the no-stale-version guard, the
// manual-blocker derivation, the text/markdown formatters, and degraded/garbled inputs. No
// fs/git — every input is plain data, fully deterministic (generatedAt omitted).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NEXT_ACTION_STATE_BADGE, NEXT_ACTION_STATE_SCHEMA, NEXT_ACTION_STATE_SCHEMA_VERSION,
  NEXT_ACTION_STATE_WRITE_FILENAME, NEXT_ACTION_STATE_REQUIRED_KEYS,
  buildNextActionState, formatNextActionState, formatNextActionStateMarkdown,
} from '../tools/nextActionState.mjs';
import { VERSION } from '../src/config.js';
import { CURRENT_TEST_STATUS } from '../src/engine/dashboard/continuumData.js';
import { buildHandoffControlPanel } from '../src/engine/status/handoffControlPanel.js';

const V = 'v0.2.217-alpha';
const PKG = '0.2.217-alpha';

// A representative buildAgentHandoff() export (the shape the CLI passes in).
const handoff = (over = {}) => ({
  schema: 'torii.agent-handoff', schemaVersion: 1, generatedAt: null,
  badge: 'AGENT HANDOFF READINESS · LOCAL · READ-ONLY',
  version: V, packageVersion: PKG, gitCommit: 'abc1234',
  liveUrl: 'https://torii-quest.pplx.app',
  gate: {
    statusLabel: 'READY', ready: true, gateCommand: 'npm run test:release',
    blockers: [], regression: { count: 15, expected: 15 },
    testProfiles: { fast: 5, foundation: 25 },
  },
  readiness: { pct: 100, status: 'READY', ok: true, summary: { total: 9, ok: 9, fail: 0 }, reasons: [] },
  harnesses: [],
  nextSafeTask: { title: 'Next infra slice', why: 'keep cadence', kind: 'infra' },
  constraints: ['version bump every deploy', 'godMode false'],
  verifyCommands: [],
  latestReports: ['torii-v0.2.216-no-blocker-queue-dashboard-report.md'],
  ...over,
});

// A representative buildManualValidationModel() card — manual playtest still pending.
const manualPending = { pill: 'manual', statusLabel: 'LOCAL GATES GREEN · MANUAL PLAYTEST + APPROVAL PENDING' };
const manualClear = { pill: 'no-blocker', statusLabel: 'NO MANUAL VALIDATION OUTSTANDING' };

describe('next-action-state — constants', () => {
  it('exposes a stable badge, schema, write filename, and required-keys list', () => {
    expect(NEXT_ACTION_STATE_BADGE).toBe('NEXT-ACTION STATE · LOCAL · READ-ONLY');
    expect(NEXT_ACTION_STATE_SCHEMA).toBe('torii.next-action-state');
    expect(NEXT_ACTION_STATE_SCHEMA_VERSION).toBe(1);
    expect(NEXT_ACTION_STATE_WRITE_FILENAME).toBe('NEXT_ACTION_STATE.json');
    expect(Object.isFrozen(NEXT_ACTION_STATE_REQUIRED_KEYS)).toBe(true);
  });
});

describe('buildNextActionState — assembly', () => {
  it('folds an agent-handoff + manual card + test count into a stable export', () => {
    const s = buildNextActionState({
      agentHandoff: handoff(), manualValidation: manualPending,
      testStatus: { passing: 1417, files: 87 },
      docs: ['HANDOFF.md', 'progress.md'],
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
    expect(s.docs).toEqual(['HANDOFF.md', 'progress.md']);
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
      version: 'v0.2.231-alpha', surface: 'continuum.html', smokedAt: '2026-06-26',
      checks: [
        { id: 'a', label: 'A', expected: 'x', observed: 'x', outcome: 'pass' },
        { id: 'b', label: 'B', expected: 'y', observed: 'y', outcome: 'pass' },
      ],
    };
    const green = buildNextActionState({ agentHandoff: handoff(), dashboardSmoke: dash });
    expect(green.dashboardSmoke).toMatchObject({
      result: 'pass', pass: true, version: 'v0.2.231-alpha', surface: 'continuum.html',
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

describe('next-action-state — formatters', () => {
  it('renders a text block with badge, release, tests, manual blocker, and next task', () => {
    const s = buildNextActionState({ agentHandoff: handoff(), manualValidation: manualPending, testStatus: { passing: 1417, files: 87 } });
    const txt = formatNextActionState(s);
    expect(txt).toContain(NEXT_ACTION_STATE_BADGE);
    expect(txt).toContain('release: READY');
    expect(txt).toContain('1417 passing / 87 files');
    expect(txt).toContain('manual blocker: PENDING');
    expect(txt).toContain('MVP playtest:');
    expect(txt).toContain('implies approval: no');
    expect(txt).toContain('Next infra slice');
    expect(txt).toContain(V);
  });

  it('renders a markdown export mirroring the JSON state', () => {
    const s = buildNextActionState({ agentHandoff: handoff(), manualValidation: manualPending });
    const md = formatNextActionStateMarkdown(s);
    expect(md).toContain('# Torii Quest — next-action state (generated)');
    expect(md).toContain('do NOT hand-edit');
    expect(md).toContain('**Source commit:**');
    expect(md).toContain('## Next safe task');
    expect(md).toContain('## Docs pointers');
  });

  it('formatters are null-safe', () => {
    expect(formatNextActionState(null)).toBe('next-action-state: (no state)');
    expect(formatNextActionStateMarkdown(null)).toContain('_(no state)_');
  });
});

// No-stale-version guard: the next-action state must track the live config VERSION, and the
// curated test count it carries must match CURRENT_TEST_STATUS — so a version/test bump can't
// leave this artifact behind.
describe('next-action-state — no stale version', () => {
  it('reports the current config VERSION when fed it (no hardcoded stale version)', () => {
    const s = buildNextActionState({ agentHandoff: handoff({ version: VERSION, packageVersion: VERSION.replace(/^v/, '') }) });
    expect(s.version).toBe(VERSION);
  });

  it('the committed NEXT_ACTION_STATE.json (if present) is not stale vs config VERSION', () => {
    let raw = null;
    try { raw = readFileSync(join(process.cwd(), 'NEXT_ACTION_STATE.json'), 'utf8'); } catch { raw = null; }
    if (raw == null) return; // artifact regenerated by the build; absence is not a failure here
    const parsed = JSON.parse(raw);
    expect(parsed.schema).toBe(NEXT_ACTION_STATE_SCHEMA);
    expect(parsed.version).toBe(VERSION);
    expect(parsed.tests).toEqual({ passing: CURRENT_TEST_STATUS.passing, files: CURRENT_TEST_STATUS.files });
  });
});
