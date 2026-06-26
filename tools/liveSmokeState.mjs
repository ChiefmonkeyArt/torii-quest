// tools/liveSmokeState.mjs — PURE, node-safe LIVE-SMOKE STATE helpers (v0.2.231).
// A single, auditable record of the latest LIVE cloud-browser smoke of the deployed site —
// the one posture that LOCAL automated gates (npm run test:release) can NEVER prove, because
// it is an observation of the production URL after a manual deploy. This module SHAPES +
// VALIDATES the live-smoke-state object; the thin CLI (tools/live-smoke-state.mjs) does the
// fs/git I/O and the (flag-gated, in-repo) write. Build-time only — never imported by the
// game; NO fs/network/child_process/THREE/DOM in here. Deterministic + plain-data so the
// logic is unit-testable (tests/live-smoke-state.test.js).
//
// SAFETY CONTRACT (enforced by validateLiveSmokeState):
//   - This artifact is DESCRIPTIVE bookkeeping only. Recording a smoke result NEVER triggers a
//     deploy/publish/push/tag/network/Nostr write (the pinned `safety` block is all-false).
//   - A result of 'pass' is INVALID (validator ERROR) unless EVERY recorded check is itself a
//     'pass' AND a concrete `version` marker + `smokedAt` timestamp are present — so a green
//     verdict can never be claimed without the per-check evidence and provenance behind it.
//   - `result` is COERCED: anything that is not exactly 'pass' or 'fail' becomes 'unknown', so
//     the state can never silently render as a pass through a typo or a partial edit.
//   - It is read-only oversight: it never implies MVP approval — that stays the separate
//     [[mvp-approval-state]] gate.

export const LIVE_SMOKE_BADGE =
  'LIVE SMOKE STATE · LOCAL · READ-ONLY · OBSERVED ON THE DEPLOYED SITE';

// Stable schema id + integer version for the machine-readable artifact. Bump on a breaking
// shape change.
export const LIVE_SMOKE_SCHEMA = 'torii.live-smoke-state';
export const LIVE_SMOKE_SCHEMA_VERSION = 1;

// Canonical in-repo path the CLI writes (with --write).
export const LIVE_SMOKE_FILE = 'LIVE_SMOKE_STATE.json';

// The three possible verdicts. 'unknown' is the floor; 'pass'/'fail' require recorded checks.
export const LIVE_SMOKE_RESULTS = Object.freeze({ PASS: 'pass', FAIL: 'fail', UNKNOWN: 'unknown' });

// Per-check outcome vocabulary. A check is { id, label, expected, observed, outcome }.
export const LIVE_SMOKE_CHECK_OUTCOMES = Object.freeze(['pass', 'fail', 'skip']);

const VERSION_MARKER_RE = /^v\d+\.\d+\.\d+(?:-[a-z][a-z0-9.]*)?$/i;
function isVersionMarker(s) { return typeof s === 'string' && VERSION_MARKER_RE.test(s.trim()); }

// _str(x) → trimmed non-empty string or null. _bool(x) → strict boolean. Defensive; never throw.
function _str(x) { return typeof x === 'string' && x.trim() ? x.trim() : null; }
function _bool(x) { return x === true; }

// _check(raw) → a normalised { id, label, expected, observed, outcome } check, or null if it has
// no id. The outcome is coerced to the known vocabulary; anything unrecognised becomes 'skip' so a
// stray value can never read as a silent pass.
function _check(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = _str(raw.id);
  if (!id) return null;
  const outcome = LIVE_SMOKE_CHECK_OUTCOMES.includes(raw.outcome) ? raw.outcome : 'skip';
  return {
    id,
    label: _str(raw.label) || id,
    expected: _str(raw.expected),
    observed: _str(raw.observed),
    outcome,
  };
}

// buildLiveSmokeState(inputs) → a plain, JSON-serialisable live-smoke state. All inputs are plain
// data. `result` is COERCED: anything not exactly 'pass'/'fail' becomes 'unknown'. Checks are
// normalised + filtered (idless entries dropped). The validator — not the builder — enforces that
// a 'pass' verdict actually carried all-passing checks + provenance, so a half-recorded pass FAILS
// loudly rather than being quietly sanitised into a green-looking record.
export function buildLiveSmokeState({
  result, version = null, commit = null, liveUrl = null,
  smokedAt = null, smokedBy = null, checks = null, notes = null, generatedAt = null,
} = {}) {
  const r = _str(result);
  const normResult = (r === LIVE_SMOKE_RESULTS.PASS || r === LIVE_SMOKE_RESULTS.FAIL)
    ? r : LIVE_SMOKE_RESULTS.UNKNOWN;
  const normChecks = Array.isArray(checks) ? checks.map(_check).filter(Boolean) : [];
  return {
    kind: LIVE_SMOKE_SCHEMA,
    schemaVersion: LIVE_SMOKE_SCHEMA_VERSION,
    badge: LIVE_SMOKE_BADGE,
    generatedAt: _str(generatedAt),
    result: normResult,
    version: _str(version),
    commit: _str(commit),
    liveUrl: _str(liveUrl),
    smokedAt: _str(smokedAt),
    smokedBy: _str(smokedBy),
    checks: normChecks,
    notes: _str(notes),
    // Standing safety posture — recording a smoke result is bookkeeping only; it NEVER triggers a
    // deploy/publish/push/tag/network/Nostr write, never implies MVP approval, and gameplay
    // godMode stays false. Pinned false so a reviewer can confirm this artifact changes no runtime.
    safety: {
      deploy: false, publish: false, push: false, tag: false,
      networkWrite: false, nostrWrite: false, godMode: false, impliesApproval: false,
    },
  };
}

// validateLiveSmokeState(state) → { ok, errors, warnings }. Pure; never throws. `ok` is true iff
// there are zero errors. The pass-requires-evidence rule is an ERROR, not an advisory.
export function validateLiveSmokeState(state) {
  const errors = [];
  const warnings = [];
  const add = (e) => errors.push(e);
  const warn = (w) => warnings.push(w);

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, errors: ['live-smoke state is not an object'], warnings };
  }

  if (state.kind !== LIVE_SMOKE_SCHEMA) add(`kind must be "${LIVE_SMOKE_SCHEMA}"`);
  if (state.schemaVersion !== LIVE_SMOKE_SCHEMA_VERSION) add(`schemaVersion must be ${LIVE_SMOKE_SCHEMA_VERSION}`);

  const validResults = new Set(Object.values(LIVE_SMOKE_RESULTS));
  if (!validResults.has(state.result)) add(`result must be one of ${[...validResults].join(', ')}`);

  if (state.version !== null && !isVersionMarker(state.version)) {
    add('version must be a valid version marker (vX.Y.Z[-tag]) or null');
  }
  if (!Array.isArray(state.checks)) add('checks must be an array');

  const checks = Array.isArray(state.checks) ? state.checks : [];
  for (const c of checks) {
    if (!_str(c && c.id)) add('every check requires a non-empty id');
    else if (!LIVE_SMOKE_CHECK_OUTCOMES.includes(c.outcome)) {
      add(`check "${c.id}" outcome must be one of ${LIVE_SMOKE_CHECK_OUTCOMES.join(', ')}`);
    }
  }

  if (state.result === LIVE_SMOKE_RESULTS.PASS) {
    // The safety floor: a green verdict MUST carry its evidence (≥1 check, all passing) + provenance.
    if (checks.length === 0) add('result "pass" requires at least one recorded check');
    if (checks.some((c) => c.outcome === 'fail')) add('result "pass" is invalid while any check failed');
    if (!isVersionMarker(state.version)) add('result "pass" requires a concrete version marker');
    if (!_str(state.smokedAt)) add('result "pass" requires a non-empty smokedAt timestamp');
  } else if (state.result === LIVE_SMOKE_RESULTS.FAIL) {
    if (checks.length === 0) warn('result "fail" recorded with no checks — add the failing check(s)');
  } else {
    if (state.version === null) warn('version is null — set it to the current version marker');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// isLiveSmokePass(state) → strict boolean. True ONLY when result is exactly 'pass' AND the state
// passes validation. Consumers should use THIS rather than reading state.result directly, so an
// invalid/partial "pass" record is treated as NOT a pass.
export function isLiveSmokePass(state) {
  return !!state && state.result === LIVE_SMOKE_RESULTS.PASS && validateLiveSmokeState(state).ok;
}

// formatLiveSmokeState(state) → a concise text block for the terminal. Pure; safe on null.
export function formatLiveSmokeState(state) {
  if (!state || typeof state !== 'object') return 'live-smoke-state: (no state)';
  const L = [];
  L.push('Torii Quest — live smoke state');
  L.push('─'.repeat(60));
  L.push(LIVE_SMOKE_BADGE);
  L.push(`result:     ${state.result ?? '(unknown)'}${isLiveSmokePass(state) ? '  ✓ PASS' : ''}`);
  L.push(`version:    ${state.version ?? '(unset)'}`);
  L.push(`commit:     ${state.commit ?? '(none)'}`);
  L.push(`live url:   ${state.liveUrl ?? '(unknown)'}`);
  L.push(`smoked at:  ${state.smokedAt ?? '(—)'}`);
  L.push(`smoked by:  ${state.smokedBy ?? '(—)'}`);
  const checks = Array.isArray(state.checks) ? state.checks : [];
  L.push(`checks:     ${checks.length}`);
  for (const c of checks) {
    const mark = c.outcome === 'pass' ? '✓' : (c.outcome === 'fail' ? '✗' : '·');
    L.push(`  ${mark} ${c.label}${c.observed ? ` — ${c.observed}` : ''}`);
  }
  if (state.notes) L.push(`notes:      ${state.notes}`);
  const { ok, errors, warnings } = validateLiveSmokeState(state);
  L.push('');
  L.push(ok ? '✓ live-smoke state valid.' : `✗ ${errors.length} error(s): ${errors.join('; ')}`);
  if (warnings.length) L.push(`· ${warnings.length} warning(s): ${warnings.join('; ')}`);
  L.push('─'.repeat(60));
  return L.join('\n');
}

// summarizeLiveSmokeForState(state) → the compact block folded into the machine-readable
// next-action state ([[next-action-state]]). Pure; safe on null/garbled. Uses isLiveSmokePass() so a
// partial/invalid "pass" record reports pass:false. Never implies approval.
export function summarizeLiveSmokeForState(state) {
  const s = state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  const checks = s && Array.isArray(s.checks) ? s.checks : [];
  return {
    result: s ? (_str(s.result) || 'unknown') : 'unknown',
    pass: isLiveSmokePass(s),
    version: s ? _str(s.version) : null,
    smokedAt: s ? _str(s.smokedAt) : null,
    checks: checks.length,
    passed: checks.filter((c) => c.outcome === 'pass').length,
    failed: checks.filter((c) => c.outcome === 'fail').length,
    impliesApproval: false,
  };
}

// LIVE_SMOKE_REQUIRED_KEYS — the keys a consumer (or guard test) can assert are always present,
// regardless of how degraded the inputs are. buildLiveSmokeState never omits these.
export const LIVE_SMOKE_REQUIRED_KEYS = Object.freeze([
  'kind', 'schemaVersion', 'badge', 'result', 'version', 'commit', 'liveUrl',
  'smokedAt', 'smokedBy', 'checks', 'notes', 'safety',
]);
