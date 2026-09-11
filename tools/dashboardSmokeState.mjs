// tools/dashboardSmokeState.mjs — PURE, node-safe DASHBOARD-SMOKE STATE helpers (v0.2.232).
// A single, auditable record of the latest LIVE cloud-browser smoke of the deployed OVERSIGHT
// DASHBOARD (continuum.html) — distinct from the app-entry smoke ([[live-smoke-state]]). Where the
// app-entry smoke proves the title screen's buttons surface visible feedback, THIS record proves
// the deployed dashboard SURFACE itself loads and visibly renders the oversight data (version,
// the folded live-smoke evidence, the active slice). It is the one posture LOCAL automated gates
// (npm run test:release) can NEVER prove, because it is an observation of the production URL after
// a manual deploy. This module SHAPES + VALIDATES the dashboard-smoke-state object; the thin CLI
// (tools/dashboard-smoke-state.mjs) does the fs/git I/O and the (flag-gated, in-repo) write.
// Build-time only — never imported by the game; NO fs/network/child_process/THREE/DOM in here.
// Deterministic + plain-data so the logic is unit-testable (tests/dashboard-smoke-state.test.js).
//
// SAFETY CONTRACT (enforced by validateDashboardSmokeState):
//   - This artifact is DESCRIPTIVE bookkeeping only. Recording a smoke result NEVER triggers a
//     deploy/publish/push/tag/network/Nostr write (the pinned `safety` block is all-false).
//   - A result of 'pass' is INVALID (validator ERROR) unless EVERY recorded check is itself a
//     'pass' AND a concrete `version` marker + `smokedAt` timestamp are present — so a green
//     verdict can never be claimed without the per-check evidence and provenance behind it.
//   - `result` is COERCED: anything that is not exactly 'pass' or 'fail' becomes 'unknown', so
//     the state can never silently render as a pass through a typo or a partial edit.
//   - It is read-only oversight: a green dashboard smoke is NOT MVP approval (that stays the
//     separate [[mvp-approval-state]] gate) and does NOT imply the human playtest is complete
//     (that stays [[playtest-results-state]]). Both implications are pinned false in `safety`.

export const DASHBOARD_SMOKE_BADGE =
  'DASHBOARD SMOKE STATE · LOCAL · READ-ONLY · OBSERVED ON THE DEPLOYED DASHBOARD';

// Stable schema id + integer version for the machine-readable artifact. Bump on a breaking
// shape change.
export const DASHBOARD_SMOKE_SCHEMA = 'torii.dashboard-smoke-state';
export const DASHBOARD_SMOKE_SCHEMA_VERSION = 1;

// Canonical in-repo path the CLI writes (with --write).
export const DASHBOARD_SMOKE_FILE = 'DASHBOARD_SMOKE_STATE.json';

// The three possible verdicts. 'unknown' is the floor; 'pass'/'fail' require recorded checks.
export const DASHBOARD_SMOKE_RESULTS = Object.freeze({ PASS: 'pass', FAIL: 'fail', UNKNOWN: 'unknown' });

// Per-check outcome vocabulary. A check is { id, label, expected, observed, outcome }.
export const DASHBOARD_SMOKE_CHECK_OUTCOMES = Object.freeze(['pass', 'fail', 'skip']);

const VERSION_MARKER_RE = /^v\d+\.\d+\.\d+(?:-[a-z][a-z0-9.]*)?$/i;
function isVersionMarker(s) { return typeof s === 'string' && VERSION_MARKER_RE.test(s.trim()); }

// _str(x) → trimmed non-empty string or null. _bool(x) → strict boolean. Defensive; never throw.
function _str(x) { return typeof x === 'string' && x.trim() ? x.trim() : null; }

// _check(raw) → a normalised { id, label, expected, observed, outcome } check, or null if it has
// no id. The outcome is coerced to the known vocabulary; anything unrecognised becomes 'skip' so a
// stray value can never read as a silent pass.
function _check(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = _str(raw.id);
  if (!id) return null;
  const outcome = DASHBOARD_SMOKE_CHECK_OUTCOMES.includes(raw.outcome) ? raw.outcome : 'skip';
  return {
    id,
    label: _str(raw.label) || id,
    expected: _str(raw.expected),
    observed: _str(raw.observed),
    outcome,
  };
}

// buildDashboardSmokeState(inputs) → a plain, JSON-serialisable dashboard-smoke state. All inputs
// are plain data. `result` is COERCED: anything not exactly 'pass'/'fail' becomes 'unknown'. Checks
// are normalised + filtered (idless entries dropped). The validator — not the builder — enforces
// that a 'pass' verdict actually carried all-passing checks + provenance, so a half-recorded pass
// FAILS loudly rather than being quietly sanitised into a green-looking record.
export function buildDashboardSmokeState({
  result, version = null, commit = null, dashboardUrl = null, surface = null,
  smokedAt = null, smokedBy = null, checks = null, notes = null, generatedAt = null,
} = {}) {
  const r = _str(result);
  const normResult = (r === DASHBOARD_SMOKE_RESULTS.PASS || r === DASHBOARD_SMOKE_RESULTS.FAIL)
    ? r : DASHBOARD_SMOKE_RESULTS.UNKNOWN;
  const normChecks = Array.isArray(checks) ? checks.map(_check).filter(Boolean) : [];
  return {
    kind: DASHBOARD_SMOKE_SCHEMA,
    schemaVersion: DASHBOARD_SMOKE_SCHEMA_VERSION,
    badge: DASHBOARD_SMOKE_BADGE,
    generatedAt: _str(generatedAt),
    result: normResult,
    version: _str(version),
    commit: _str(commit),
    dashboardUrl: _str(dashboardUrl),
    surface: _str(surface),
    smokedAt: _str(smokedAt),
    smokedBy: _str(smokedBy),
    checks: normChecks,
    notes: _str(notes),
    // Standing safety posture — recording a dashboard smoke is bookkeeping only; it NEVER triggers
    // a deploy/publish/push/tag/network/Nostr write, never implies MVP approval, never implies the
    // human playtest is complete, and gameplay godMode stays false. Pinned so a reviewer can
    // confirm this artifact changes no runtime.
    safety: {
      deploy: false, publish: false, push: false, tag: false,
      networkWrite: false, nostrWrite: false, godMode: false,
      impliesApproval: false, impliesPlaytestComplete: false,
    },
  };
}

// validateDashboardSmokeState(state) → { ok, errors, warnings }. Pure; never throws. `ok` is true
// iff there are zero errors. The pass-requires-evidence rule is an ERROR, not an advisory.
export function validateDashboardSmokeState(state) {
  const errors = [];
  const warnings = [];
  const add = (e) => errors.push(e);
  const warn = (w) => warnings.push(w);

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, errors: ['dashboard-smoke state is not an object'], warnings };
  }

  if (state.kind !== DASHBOARD_SMOKE_SCHEMA) add(`kind must be "${DASHBOARD_SMOKE_SCHEMA}"`);
  if (state.schemaVersion !== DASHBOARD_SMOKE_SCHEMA_VERSION) add(`schemaVersion must be ${DASHBOARD_SMOKE_SCHEMA_VERSION}`);

  const validResults = new Set(Object.values(DASHBOARD_SMOKE_RESULTS));
  if (!validResults.has(state.result)) add(`result must be one of ${[...validResults].join(', ')}`);

  if (state.version !== null && !isVersionMarker(state.version)) {
    add('version must be a valid version marker (vX.Y.Z[-tag]) or null');
  }
  if (!Array.isArray(state.checks)) add('checks must be an array');

  const checks = Array.isArray(state.checks) ? state.checks : [];
  for (const c of checks) {
    if (!_str(c && c.id)) add('every check requires a non-empty id');
    else if (!DASHBOARD_SMOKE_CHECK_OUTCOMES.includes(c.outcome)) {
      add(`check "${c.id}" outcome must be one of ${DASHBOARD_SMOKE_CHECK_OUTCOMES.join(', ')}`);
    }
  }

  if (state.result === DASHBOARD_SMOKE_RESULTS.PASS) {
    // The safety floor: a green verdict MUST carry its evidence (≥1 check, all passing) + provenance.
    if (checks.length === 0) add('result "pass" requires at least one recorded check');
    // F16: a green verdict must carry all-passing evidence — a skip (including an
    // unknown outcome coerced to skip) is NOT positive evidence of success, so a
    // skip-only/mixed record must not validate as PASS.
    if (checks.some((c) => c.outcome !== 'pass')) add('result "pass" requires every check to be "pass" (no skip/unknown)');
    if (!isVersionMarker(state.version)) add('result "pass" requires a concrete version marker');
    if (!_str(state.smokedAt)) add('result "pass" requires a non-empty smokedAt timestamp');
  } else if (state.result === DASHBOARD_SMOKE_RESULTS.FAIL) {
    if (checks.length === 0) warn('result "fail" recorded with no checks — add the failing check(s)');
  } else {
    if (state.version === null) warn('version is null — set it to the current version marker');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// isDashboardSmokePass(state) → strict boolean. True ONLY when result is exactly 'pass' AND the
// state passes validation. Consumers should use THIS rather than reading state.result directly, so
// an invalid/partial "pass" record is treated as NOT a pass.
export function isDashboardSmokePass(state) {
  return !!state && state.result === DASHBOARD_SMOKE_RESULTS.PASS && validateDashboardSmokeState(state).ok;
}

// formatDashboardSmokeState(state) → a concise text block for the terminal. Pure; safe on null.
export function formatDashboardSmokeState(state) {
  if (!state || typeof state !== 'object') return 'dashboard-smoke-state: (no state)';
  const L = [];
  L.push('Torii Quest — dashboard smoke state');
  L.push('─'.repeat(60));
  L.push(DASHBOARD_SMOKE_BADGE);
  L.push(`result:     ${state.result ?? '(unknown)'}${isDashboardSmokePass(state) ? '  ✓ PASS' : ''}`);
  L.push(`version:    ${state.version ?? '(unset)'}`);
  L.push(`commit:     ${state.commit ?? '(none)'}`);
  L.push(`dashboard:  ${state.dashboardUrl ?? '(unknown)'}`);
  L.push(`surface:    ${state.surface ?? '(—)'}`);
  L.push(`smoked at:  ${state.smokedAt ?? '(—)'}`);
  L.push(`smoked by:  ${state.smokedBy ?? '(—)'}`);
  const checks = Array.isArray(state.checks) ? state.checks : [];
  L.push(`checks:     ${checks.length}`);
  for (const c of checks) {
    const mark = c.outcome === 'pass' ? '✓' : (c.outcome === 'fail' ? '✗' : '·');
    L.push(`  ${mark} ${c.label}${c.observed ? ` — ${c.observed}` : ''}`);
  }
  if (state.notes) L.push(`notes:      ${state.notes}`);
  const { ok, errors, warnings } = validateDashboardSmokeState(state);
  L.push('');
  L.push(ok ? '✓ dashboard-smoke state valid.' : `✗ ${errors.length} error(s): ${errors.join('; ')}`);
  if (warnings.length) L.push(`· ${warnings.length} warning(s): ${warnings.join('; ')}`);
  L.push('─'.repeat(60));
  return L.join('\n');
}

// summarizeDashboardSmokeForState(state) → the compact block folded into the machine-readable
// next-action state ([[next-action-state]]). Pure; safe on null/garbled. Uses isDashboardSmokePass()
// so a partial/invalid "pass" record reports pass:false. Never implies approval or playtest-complete.
export function summarizeDashboardSmokeForState(state) {
  const s = state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  const checks = s && Array.isArray(s.checks) ? s.checks : [];
  return {
    result: s ? (_str(s.result) || 'unknown') : 'unknown',
    pass: isDashboardSmokePass(s),
    version: s ? _str(s.version) : null,
    surface: s ? _str(s.surface) : null,
    smokedAt: s ? _str(s.smokedAt) : null,
    checks: checks.length,
    passed: checks.filter((c) => c.outcome === 'pass').length,
    failed: checks.filter((c) => c.outcome === 'fail').length,
    impliesApproval: false,
    impliesPlaytestComplete: false,
  };
}

// DASHBOARD_SMOKE_REQUIRED_KEYS — the keys a consumer (or guard test) can assert are always
// present, regardless of how degraded the inputs are. buildDashboardSmokeState never omits these.
export const DASHBOARD_SMOKE_REQUIRED_KEYS = Object.freeze([
  'kind', 'schemaVersion', 'badge', 'result', 'version', 'commit', 'dashboardUrl', 'surface',
  'smokedAt', 'smokedBy', 'checks', 'notes', 'safety',
]);
