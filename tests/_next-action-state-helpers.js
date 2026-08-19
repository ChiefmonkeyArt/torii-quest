// tests/_next-action-state-helpers.js — shared fixtures for the next-action-state.* split
// suites (E3, v0.2.267). NOT a test file (no .test.js suffix) so the suite glob skips it.
export const V = 'v0.2.217-alpha';
export const PKG = '0.2.217-alpha';

// A representative buildAgentHandoff() export (the shape the CLI passes in).
export const handoff = (over = {}) => ({
  schema: 'torii.agent-handoff', schemaVersion: 1, generatedAt: null,
  badge: 'AGENT HANDOFF READINESS · LOCAL · READ-ONLY',
  version: V, packageVersion: PKG, gitCommit: 'abc1234',
  liveUrl: 'https://chiefmonkey.art/quest',
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
export const manualPending = { pill: 'manual', statusLabel: 'LOCAL GATES GREEN · MANUAL PLAYTEST + APPROVAL PENDING' };
export const manualClear = { pill: 'no-blocker', statusLabel: 'NO MANUAL VALIDATION OUTSTANDING' };
