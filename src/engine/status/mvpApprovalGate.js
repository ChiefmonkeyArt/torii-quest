// engine/status/mvpApprovalGate.js — PURE, node-safe MVP APPROVAL GATE (v0.2.234). ONE compact,
// read-only rubric that makes the MVP sign-off decision unambiguous so an automated green run can
// NEVER be mistaken for human game-feel approval. It answers, in order:
//   1. the automated CONFIDENCE SIGNALS (release gate, app-entry smoke, dashboard smoke, test
//      suite) — green here is CONFIDENCE only, not approval
//   2. the explicit APPROVAL state (MVP_APPROVAL_STATE.json) — the gate reads APPROVED only when a
//      human (Chiefmonkey / the user) has explicitly signed off
//   3. the manual PLAYTEST FOCUS a human must judge by hand on the live build (entry flow, shooter
//      feel, hit registration / headshots, bot behaviour, movement / footsteps, reload feel,
//      mirror / reflection, crates, NAP monkey, dashboard clarity, and any subjective fun / feel
//      blocker)
//
// SINGLE SOURCE OF TRUTH: this module is consumed by BOTH the static Continuum dashboard
// (src/engine/dashboard/toriiQuestData.js → a card) AND the node next-action state
// (tools/nextActionState.mjs → a folded field), so the "what does MVP approval require?" rubric can
// never drift between the page and the CLI. Every field is FOLDED from inputs the caller already
// gathered (release readiness, the two smoke summaries, the test count, the approval record); this
// is NOT a second checklist and NOT a second approval record.
//
// Constrained by construction:
//   - PURE + browser-safe: NO fs / network / child_process / THREE / Rapier / DOM here, and it
//     imports NO tools/ module, so the game bundle stays clean. It renders + acts on nothing.
//   - APPROVAL-REQUIRES-EXPLICIT-OK: the gate verdict is 'approved' ONLY when the approval input
//     carries approved === true (the strict isApproved() floor upstream). A verdict of 'approved'
//     without that flag is a validator ERROR, so green confidence signals can never silently flip
//     the gate to approved. Smoke pass ≠ approval; dashboard pass ≠ a completed human playtest; no
//     live Nostr write is ever implied.

// The two live URLs the gate names so a tester knows where to run the manual playtest.
export const MVP_GATE_LIVE_URL = 'https://torii-quest.pplx.app';
export const MVP_GATE_DASHBOARD_URL = 'https://torii-quest.pplx.app/dashboard.html';

export const MVP_APPROVAL_GATE_BADGE =
  'MVP APPROVAL GATE · LOCAL · READ-ONLY · GREEN CHECKS ≠ HUMAN APPROVAL';

// MVP_PLAYTEST_FOCUS — the areas a human must judge by hand on the live build before sign-off.
// Compact category headers (the full step-by-step lives in MVP_PLAYTEST_CHECKLIST.md); this list
// keeps the focus visible on the dashboard so "what must a human still check?" is one glance away.
export const MVP_PLAYTEST_FOCUS = Object.freeze([
  'Entry flow: title screen loads, ENTER ARENA and LOGIN WITH NOSTR give visible feedback, pointer-lock engages.',
  'Shooter feel: the core shoot → hit → respawn loop feels responsive and fair.',
  'Hit registration / headshots: connecting shots register, and headshots vs body shots resolve as expected.',
  'Bot behaviour: bots move, react, take damage, die, and respawn without freezing or stalling.',
  'Movement / footsteps: WASD + jump are smooth, walls hold, and footstep feedback tracks motion.',
  'Reload feel: reload triggers, feels snappy, and refills ammo to the magazine size.',
  'Mirror / reflection: the mirror is coherent (no garble / recursion meltdown) and not a framerate sink.',
  'Crates: crates are solid under movement and fire and do not jitter, launch, or sink through the floor.',
  'NAP monkey: crossing the torii gate into the Non-Aggression zone disables the weapon and bots do not follow.',
  'Dashboard clarity: dashboard.html renders the version, test status, and active slice clearly and matches the build.',
  'Subjective fun / feel: any game-feel blocker that makes the proof unconvincing, even if every automated check is green.',
]);

// MVP_GATE_CLARIFICATIONS — the three things the gate makes explicit, carried IN the model so any
// surface that renders it inherits the wording verbatim. Deliberately plain, practical language.
export const MVP_GATE_CLARIFICATIONS = Object.freeze([
  'Automated tests and cloud smokes are CONFIDENCE signals: green means the code and the deployed surfaces look healthy — it is NOT approval.',
  'MVP approval still requires an EXPLICIT human OK: a person (Chiefmonkey / the user) runs the live-browser playtest and says "MVP approved".',
  'A smoke pass is not MVP approval and a dashboard pass is not a completed human playtest — the gate stays PENDING until the explicit sign-off is recorded.',
]);

// The gate verdicts. 'approved' requires the explicit approval flag; 'awaiting-approval' means the
// automated confidence signals are all green and only the human OK is missing; 'signals-incomplete'
// means at least one automated confidence signal is not yet green.
export const MVP_GATE_VERDICTS = Object.freeze({
  APPROVED: 'approved',
  AWAITING_APPROVAL: 'awaiting-approval',
  SIGNALS_INCOMPLETE: 'signals-incomplete',
});

// _str(x) → trimmed non-empty string or null. _int(x) → integer or null. _bool(x) → strict boolean.
function _str(x) { return typeof x === 'string' && x.trim() ? x.trim() : null; }
function _int(x) { return Number.isInteger(x) ? x : null; }
function _arr(x) { return Array.isArray(x) ? x.filter((s) => _str(s)).map((s) => s.trim()) : []; }

const VERSION_MARKER_RE = /^v\d+\.\d+\.\d+(?:-[a-z][a-z0-9.]*)?$/i;
function isVersionMarker(s) { return typeof s === 'string' && VERSION_MARKER_RE.test(s.trim()); }

// buildMvpApprovalGate(inputs) → a plain, JSON-serialisable gate model. All inputs are plain data
// the caller already gathered. With NO inputs it degrades to honest "not green / pending" fields
// and the curated focus + clarifications — never throws. The validator — not the builder — decides
// the verdict's validity, so a half-populated gate reads as NOT approved rather than being silently
// coerced into an approved-looking record.
//   version          config.js VERSION marker
//   releaseReady     boolean — the local release gate (npm run test:release) is green
//   entrySmokePass   boolean — the latest app-entry cloud smoke PASSED
//   dashboardSmokePass boolean — the latest oversight-dashboard cloud smoke PASSED
//   tests            { passing, files } last-known suite count
//   approval         { approved, status, approvedBy, approvedAt } from the approval state summary
//   generatedAt      OPTIONAL ISO stamp; omit (null) for reproducible tests
export function buildMvpApprovalGate({
  version = null, releaseReady = null, entrySmokePass = null, dashboardSmokePass = null,
  tests = null, approval = null, focus = MVP_PLAYTEST_FOCUS, clarifications = MVP_GATE_CLARIFICATIONS,
  generatedAt = null,
} = {}) {
  const ts = tests && typeof tests === 'object' && !Array.isArray(tests) ? tests : null;
  const ap = approval && typeof approval === 'object' && !Array.isArray(approval) ? approval : null;

  const passing = ts ? _int(ts.passing) : null;
  const files = ts ? _int(ts.files) : null;
  const suiteGreen = passing != null && passing > 0;

  const signals = {
    releaseReady: releaseReady === true,
    entrySmokePass: entrySmokePass === true,
    dashboardSmokePass: dashboardSmokePass === true,
    suiteGreen,
    tests: { passing, files },
  };
  // Confidence is green only when EVERY automated signal is green. This is the "looks healthy"
  // floor — it is necessary but NOT sufficient for approval.
  const confidenceGreen = signals.releaseReady && signals.entrySmokePass
    && signals.dashboardSmokePass && signals.suiteGreen;

  const approved = ap ? ap.approved === true : false;
  let verdict;
  if (approved) verdict = MVP_GATE_VERDICTS.APPROVED;
  else if (confidenceGreen) verdict = MVP_GATE_VERDICTS.AWAITING_APPROVAL;
  else verdict = MVP_GATE_VERDICTS.SIGNALS_INCOMPLETE;

  const focusArr = _arr(focus).length ? _arr(focus) : Array.from(MVP_PLAYTEST_FOCUS);
  const clarArr = _arr(clarifications).length ? _arr(clarifications) : Array.from(MVP_GATE_CLARIFICATIONS);

  return {
    badge: MVP_APPROVAL_GATE_BADGE,
    generatedAt: _str(generatedAt),
    version: _str(version),
    liveUrl: MVP_GATE_LIVE_URL,
    dashboardUrl: MVP_GATE_DASHBOARD_URL,
    confidenceSignals: signals,
    confidenceGreen,
    approval: {
      approved,
      status: ap ? (_str(ap.status) || 'unknown') : 'unknown',
      approvedBy: ap ? _str(ap.approvedBy) : null,
      approvedAt: ap ? _str(ap.approvedAt) : null,
    },
    verdict,
    playtestFocus: focusArr,
    clarifications: clarArr,
    // Standing safety posture — this gate is read-only oversight; it NEVER triggers a deploy/
    // publish/push/tag/network/Nostr write, never implies the human playtest is complete, and
    // gameplay godMode stays false. Pinned so a reviewer can confirm this surface changes no
    // runtime behaviour. impliesApproval stays false: only the explicit human OK approves.
    safety: {
      deploy: false, publish: false, push: false, tag: false,
      networkWrite: false, nostrWrite: false, godMode: false,
      impliesApproval: false, impliesPlaytestComplete: false,
    },
  };
}

// validateMvpApprovalGate(gate) → { ok, errors, warnings }. Pure; never throws. `ok` is true iff
// there are zero errors. The APPROVAL-REQUIRES-EXPLICIT-OK rule is the safety floor: a verdict of
// 'approved' without an explicit approved===true (plus approver provenance) is an ERROR, so the
// gate can never read approved on green confidence signals alone.
export function validateMvpApprovalGate(gate) {
  const errors = [];
  const warnings = [];
  const add = (e) => errors.push(e);
  const warn = (w) => warnings.push(w);

  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    return { ok: false, errors: ['mvp approval gate is not an object'], warnings };
  }

  if (!isVersionMarker(gate.version)) add('a current version marker (vX.Y.Z[-tag]) is required');

  const validVerdicts = new Set(Object.values(MVP_GATE_VERDICTS));
  if (!validVerdicts.has(gate.verdict)) add(`verdict must be one of ${[...validVerdicts].join(', ')}`);

  const ap = gate.approval && typeof gate.approval === 'object' ? gate.approval : null;
  const approved = ap ? ap.approved === true : false;

  // The floor: a verdict of 'approved' requires the explicit approved flag AND approver
  // provenance (who + when). Green confidence signals NEVER satisfy this.
  if (gate.verdict === MVP_GATE_VERDICTS.APPROVED) {
    if (!approved) add('verdict "approved" requires approval.approved === true (an explicit human OK)');
    if (!_str(ap && ap.approvedBy)) add('verdict "approved" requires a recorded approver (approval.approvedBy)');
    if (!_str(ap && ap.approvedAt)) add('verdict "approved" requires an approval timestamp (approval.approvedAt)');
  }
  // The mirror floor: the gate cannot claim approved===true while the verdict is anything else.
  if (approved && gate.verdict !== MVP_GATE_VERDICTS.APPROVED) {
    add('approval.approved is true but verdict is not "approved" — these must agree');
  }

  // The manual playtest focus must stay visible — a human needs to know what to judge by hand.
  if (!Array.isArray(gate.playtestFocus) || gate.playtestFocus.length === 0) {
    add('the manual playtest focus list is required');
  }
  // The clarifications (green ≠ approval) must stay visible.
  if (!Array.isArray(gate.clarifications) || gate.clarifications.length === 0) {
    add('the gate clarifications are required');
  }

  // Standing posture: every safety flag must stay false.
  const sf = gate.safety || {};
  for (const k of ['deploy', 'publish', 'push', 'tag', 'networkWrite', 'nostrWrite', 'godMode',
    'impliesApproval', 'impliesPlaytestComplete']) {
    if (sf[k] !== false) add(`safety.${k} must be false`);
  }

  // Advisory: an awaiting-approval gate with green confidence is the EXPECTED pre-sign-off posture.
  if (gate.verdict === MVP_GATE_VERDICTS.AWAITING_APPROVAL) {
    warn('confidence signals are green — awaiting the explicit human MVP approval (green ≠ approved)');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// isMvpGateApproved(gate) → strict boolean. True ONLY when the gate passes validation AND its
// verdict is exactly 'approved' (which the validator already ties to an explicit human OK).
// Consumers should use THIS rather than reading gate.verdict directly.
export function isMvpGateApproved(gate) {
  return !!gate && gate.verdict === MVP_GATE_VERDICTS.APPROVED && validateMvpApprovalGate(gate).ok;
}

// MVP_APPROVAL_GATE_REQUIRED_KEYS — the keys a consumer (or guard test) can assert are always
// present, however degraded the inputs. buildMvpApprovalGate never omits these.
export const MVP_APPROVAL_GATE_REQUIRED_KEYS = Object.freeze([
  'badge', 'version', 'liveUrl', 'dashboardUrl', 'confidenceSignals', 'confidenceGreen',
  'approval', 'verdict', 'playtestFocus', 'clarifications', 'safety',
]);

// summarizeMvpApprovalGateForState(gate) → the compact block folded into the machine-readable
// next-action state ([[next-action-state]]). Pure; safe on null/garbled. `approved` uses
// isMvpGateApproved so a half-populated gate reports approved:false. Never implies approval.
export function summarizeMvpApprovalGateForState(gate) {
  const g = gate && typeof gate === 'object' && !Array.isArray(gate) ? gate : null;
  const cs = g && g.confidenceSignals && typeof g.confidenceSignals === 'object'
    ? g.confidenceSignals : {};
  const ap = g && g.approval && typeof g.approval === 'object' ? g.approval : {};
  return {
    verdict: g ? (_str(g.verdict) || 'unknown') : 'unknown',
    approved: isMvpGateApproved(g),
    confidenceGreen: g ? g.confidenceGreen === true : false,
    confidenceSignals: {
      releaseReady: cs.releaseReady === true,
      entrySmokePass: cs.entrySmokePass === true,
      dashboardSmokePass: cs.dashboardSmokePass === true,
      suiteGreen: cs.suiteGreen === true,
    },
    approvalStatus: _str(ap.status) || 'unknown',
    focusCount: g && Array.isArray(g.playtestFocus) ? g.playtestFocus.length : 0,
    impliesApproval: false,
    impliesPlaytestComplete: false,
  };
}

// _yesNo(b) → a compact PASS / pending label for a boolean confidence signal.
function _yesNo(b) { return b === true ? 'green' : 'not yet'; }

// buildMvpApprovalGateCard(gate) → a render-ready dashboard card model for the Continuum page (same
// shape as the other card builders: { badge, kind, band, statusLabel, pill, metrics, note }). Pure;
// reuses the existing .metric/.pill markup → NO new script/CSS, so the torii-quest CSP +
// refresh-script hash stay intact. With no gate it degrades to an honest pending card. The pill is
// 'no-blocker' only when the gate is APPROVED; otherwise 'manual' (a human OK is still required).
export function buildMvpApprovalGateCard(gate = null) {
  const g = gate && typeof gate === 'object' && !Array.isArray(gate)
    ? gate : buildMvpApprovalGate();
  const approved = isMvpGateApproved(g);
  const cs = g.confidenceSignals || {};

  let band; let statusLabel; let pill;
  if (approved) {
    band = 'approved'; statusLabel = 'MVP APPROVED (EXPLICIT HUMAN OK RECORDED)'; pill = 'no-blocker';
  } else if (g.verdict === MVP_GATE_VERDICTS.AWAITING_APPROVAL) {
    band = 'awaiting'; statusLabel = 'CONFIDENCE GREEN · AWAITING EXPLICIT USER PLAYTEST + OK'; pill = 'manual';
  } else {
    band = 'signals-incomplete'; statusLabel = 'AUTOMATED CONFIDENCE SIGNALS INCOMPLETE'; pill = 'manual';
  }

  const t = cs.tests || {};
  const metrics = [
    { label: 'Gate verdict', value: approved ? 'APPROVED' : (g.verdict || 'unknown') },
    { label: 'Release gate', value: `${_yesNo(cs.releaseReady)} (confidence only, not approval)` },
    { label: 'Entry smoke', value: `${_yesNo(cs.entrySmokePass)} (confidence only, not approval)` },
    { label: 'Dashboard smoke', value: `${_yesNo(cs.dashboardSmokePass)} (confidence only, not approval)` },
    { label: 'Test suite', value: `${_yesNo(cs.suiteGreen)}${t.passing != null ? ` — ${t.passing} passing / ${t.files ?? '?'} files` : ''}` },
    { label: 'Explicit approval', value: approved
      ? `APPROVED by ${g.approval.approvedBy || '(recorded)'} @ ${g.approval.approvedAt || '(recorded)'}`
      : 'PENDING — a human must run the live playtest and explicitly say "MVP approved"' },
    { label: 'How approval works', value: (g.clarifications || []).join(' · ') },
    { label: 'Manual playtest focus', value: (g.playtestFocus || []).join(' · ') },
  ];

  return {
    badge: MVP_APPROVAL_GATE_BADGE,
    kind: g.version ? 'generated' : 'last-known',
    band,
    statusLabel,
    pill,
    approved,
    verdict: g.verdict,
    metrics,
    note: 'MVP approval gate — the rubric that keeps automated green from being mistaken for human '
      + 'game-feel approval. The automated tests, the release gate, and the two cloud smokes are '
      + 'CONFIDENCE signals: green means the code and the deployed surfaces look healthy, NOT that '
      + 'the MVP is approved. Approval is a separate, explicit step: a human (Chiefmonkey / the user) '
      + 'runs the live-browser playtest — judging entry flow, shooter feel, hit registration / '
      + 'headshots, bot behaviour, movement, reload, mirror, crates, the NAP monkey, dashboard '
      + 'clarity, and overall fun / feel — and then says "MVP approved", which records the approver '
      + 'and timestamp in MVP_APPROVAL_STATE.json. A smoke pass is not approval and a dashboard pass '
      + 'is not a completed playtest. This card approves/releases/deploys/publishes NOTHING.',
  };
}
