// engine/status/handoffControlPanel.js — PURE, node-safe HANDOFF / RELEASE CONTROL PANEL
// (v0.2.233). ONE compact, read-only oversight surface a fresh AI agent (Claude / GPT /
// DeepSeek) or a human can read in a single glance to pick up the project safely, WITHOUT
// re-deriving the posture from every tool. It answers, in order:
//   1. the current live version + the game URL + the dashboard URL
//   2. the latest app-entry cloud smoke (DEPLOYED title screen)
//   3. the latest oversight-dashboard cloud smoke (DEPLOYED continuum.html)
//   4. the one manual blocker (the human must run the live-browser MVP playtest + approve)
//   5. the next SAFE no-blocker task an agent can pick up with no user input
//   6. the exact actions NOT to take without explicit user input (HANDOFF_DO_NOT)
//   7. the standing workflow invariants — e.g. do NOT cancel a useful in-progress job (WORKFLOW_INVARIANTS)
//   8. the project's practical, NON-RELIGIOUS operating principles (PROJECT_PRINCIPLES)
//
// SINGLE SOURCE OF TRUTH: this module is consumed by BOTH the static Continuum dashboard
// (src/engine/dashboard/continuumData.js → a card) AND the node next-action state
// (tools/nextActionState.mjs → a folded field), so the "is the handoff surface complete?"
// logic can never drift between the page and the CLI. Every field is FOLDED from inputs the
// caller already gathered (smoke summaries, manual-validation card, next-safe task); this is
// NOT a second task list.
//
// Constrained by construction:
//   - PURE + browser-safe: NO fs / network / child_process / THREE / Rapier / DOM here, and it
//     imports NO tools/ module, so the game bundle stays clean. It renders + acts on nothing.
//   - GREEN-REQUIRES-EVIDENCE: isHandoffPanelGreen() is true ONLY when the panel actually
//     carries a current version marker, the live + dashboard URLs, PASSING entry- and
//     dashboard-smoke evidence (≥1 check, all passing, a version marker), an EXPLICIT manual-
//     blocker verdict (truthful status reporting — pending must be a known boolean, never
//     unknown), AND non-religious ethics copy. A missing field or any religious language in the
//     ethics copy is a validator ERROR, so the panel can never go green on an empty/garbled or
//     off-tone surface.
//   - "Green" means the HANDOFF SURFACE is complete + trustworthy — NOT that the MVP is
//     approved. A green panel still reports the manual blocker as PENDING. Smoke pass ≠ MVP
//     approval; dashboard pass ≠ human playtest complete; no live Nostr write is ever implied.

// The live URLs. Plain text only — the dashboard renders them as text, never as a redirect.
export const HANDOFF_LIVE_URL = 'https://torii-quest.pplx.app';
export const HANDOFF_DASHBOARD_URL = 'https://torii-quest.pplx.app/continuum.html';

export const HANDOFF_CONTROL_PANEL_BADGE =
  'HANDOFF / RELEASE CONTROL PANEL · LOCAL · READ-ONLY · ONE-GLANCE PICKUP';

// PROJECT_PRINCIPLES — the project's practical operating compass. These are ENGINEERING /
// PRODUCT principles, not doctrine: a future agent reads them to make decisions that stay
// aligned with what Torii Quest is for. Deliberately NON-RELIGIOUS — no sacred language, no
// worship framing, no preaching. Each entry is a concrete, testable stance.
export const PROJECT_PRINCIPLES = Object.freeze([
  'Self-sovereignty: the user owns their identity (their npub) and their data; the project never holds the keys to a user.',
  'Consent first: nothing signs, publishes, pays, or navigates on the user\'s behalf without an explicit, informed action.',
  'Privacy by default: collect nothing by default; no surveillance, no tracking, no telemetry phoned home.',
  'Open protocols: build on Nostr, Bitcoin, and ecash so the user can leave and take their identity and value with them.',
  'Free and open source: the code is FOSS so anyone can read, fork, verify, and self-host it — no black boxes.',
  'No vendor lock-in: interoperable by design; data and identity stay portable across clients and relays.',
  'Local circular economics: favour voluntary, peer-to-peer value exchange over extractive, ad-funded, or rent-seeking models.',
  'No dark patterns: no manipulation, no coercive monetization, no engagement traps — the user stays in control.',
  'Reversible, user-controlled actions: prefer actions the user can undo and explicitly trigger over irreversible automatic ones.',
  'Community agency: tools should grow the community\'s capability to act for itself, not centralise control.',
  'Truthful status reporting: dashboards and handoffs report the real posture — a pass is never claimed without the evidence behind it.',
]);

// HANDOFF_DO_NOT — the exact actions a picking-up agent must NOT take without explicit user
// input. These mirror the standing safety gates; an automated agent stays inside them.
export const HANDOFF_DO_NOT = Object.freeze([
  'Do NOT deploy, publish, or push — the maintainer performs the manual deploy.',
  'Do NOT create a git tag, GitHub release, or announcement.',
  'Do NOT perform any live Nostr write (no signing, no relay publish) beyond the existing read-only NIP-07 reads.',
  'Do NOT make a payment or move real value — alpha sats are fake.',
  'Do NOT mark the MVP approved — only the user can, after running the live-browser playtest.',
  'Do NOT enable godMode or any debug capability in shipped runtime — godMode stays false.',
  'Do NOT add network calls, auto-update, or external redirects to the oversight surfaces.',
]);

// WORKFLOW_INVARIANTS — standing process rules a picking-up agent follows REGARDLESS of the task,
// surfaced on the handoff panel so they can't be missed (v0.2.237). The first entry is the
// do-not-cancel-useful-jobs rule; the rest are its explicit exceptions. Cancelling a useful
// in-progress job wastes compute time and money and forces the work to be redone, so the default is
// to FINISH it, then handle the next request. nostrich.
export const WORKFLOW_INVARIANTS = Object.freeze([
  'Do NOT cancel a useful in-progress job halfway through — finish it first, THEN process the user\'s next request. Cancelling useful work wastes compute time and money.',
  'Exception — explicit cancel: the user explicitly asks to cancel or abandon the job.',
  'Exception — immediate conflict: the running job conflicts with an immediate user request (e.g. it would clash with edits the new request needs now).',
  'Exception — safely resumable: the work can be safely resumed later from where it left off, so stopping loses nothing.',
  'Exception — stale/hung & already shipped: the job is stale or hung AND its output has already been committed, shipped, pushed, synced, and smoke-tested — stopping it only avoids further waste.',
]);

// ETHICS_NOTE — a one-paragraph framing of the principles above for a fresh agent. Practical
// and non-religious by construction (asserted by containsReligiousLanguage()).
export const ETHICS_NOTE =
  'These are practical operating principles, not dogma: Torii Quest exists to give people '
  + 'self-sovereign, consent-driven freedom tech on open protocols (Nostr, Bitcoin, ecash) with no '
  + 'surveillance, no dark patterns, and no lock-in. When a decision is ambiguous, choose the option '
  + 'that keeps the user in control of their identity, data, and value, and that reports status truthfully.';

// RELIGIOUS_DENYLIST — words/phrases that would make the ethics copy read as sacred/doctrinal/
// preaching. The guard below flags them so the principles stay a practical engineering compass.
// NOTE: this guard intentionally does NOT include the brand vocabulary (torii / gate / shrine /
// the ⛩ mark) — those are the product's name, not religious framing — and it deliberately omits a
// bare "god" so it never trips on the standing `godMode` safety flag. It only guards the ETHICS copy.
export const RELIGIOUS_DENYLIST = Object.freeze([
  'sacred', 'holy', 'hallowed', 'consecrate', 'consecrated', 'worship', 'worshipper',
  'prayer', 'pray', 'divine', 'deity', 'almighty', 'scripture', 'gospel', 'doctrine',
  'sermon', 'preach', 'preaching', 'sacrament', 'commandment', 'blessed', 'blessing',
  'salvation', 'heaven', 'heavenly', 'sinful', 'righteous', 'faithful', 'prophet',
  'prophecy', 'disciple', 'congregation', 'reverent', 'reverence', 'devotion', 'devout',
]);

// findReligiousLanguage(text) → array of denylisted terms found in `text` (word-boundary,
// case-insensitive). Empty when the copy is clean. Pure; safe on null.
export function findReligiousLanguage(text) {
  const s = typeof text === 'string' ? text.toLowerCase() : '';
  if (!s) return [];
  const hits = [];
  for (const term of RELIGIOUS_DENYLIST) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(s)) hits.push(term);
  }
  return hits;
}

// containsReligiousLanguage(text) → strict boolean. True if any denylisted term appears.
export function containsReligiousLanguage(text) {
  return findReligiousLanguage(text).length > 0;
}

// _str(x) → trimmed non-empty string or null. _arr(x) → array of clean strings.
function _str(x) { return typeof x === 'string' && x.trim() ? x.trim() : null; }
function _arr(x) { return Array.isArray(x) ? x.filter((s) => _str(s)).map((s) => s.trim()) : []; }
function _int(x) { return Number.isInteger(x) ? x : null; }

const VERSION_MARKER_RE = /^v\d+\.\d+\.\d+(?:-[a-z][a-z0-9.]*)?$/i;
function isVersionMarker(s) { return typeof s === 'string' && VERSION_MARKER_RE.test(s.trim()); }

// _smoke(raw) → a normalised smoke-evidence block from a summarizeLiveSmokeForState /
// summarizeDashboardSmokeForState summary (or null). `pass` is taken strictly from the
// summary's own `pass` (which the source modules already gate behind their pass-requires-
// evidence validator), never re-derived here.
function _smoke(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  return {
    result: s ? (_str(s.result) || 'unknown') : 'unknown',
    pass: s ? s.pass === true : false,
    version: s ? _str(s.version) : null,
    checks: s ? (_int(s.checks) ?? 0) : 0,
    passed: s ? (_int(s.passed) ?? 0) : 0,
    failed: s ? (_int(s.failed) ?? 0) : 0,
    smokedAt: s ? _str(s.smokedAt) : null,
    surface: s ? _str(s.surface) : null,
  };
}

// buildHandoffControlPanel(inputs) → a plain, JSON-serialisable control panel. All inputs are
// plain data the caller already gathered. With NO inputs it degrades to honest "incomplete"
// fields (null version, unknown smokes, unknown blocker) and the curated ethics copy — never
// throws. The validator — not the builder — decides green, so a half-populated panel reads as
// NOT green rather than being silently sanitised.
export function buildHandoffControlPanel({
  version = null, liveUrl = HANDOFF_LIVE_URL, dashboardUrl = HANDOFF_DASHBOARD_URL,
  entrySmoke = null, dashboardSmoke = null, manualBlocker = null, mvpApproval = null,
  nextSafeTask = null, principles = PROJECT_PRINCIPLES, doNot = HANDOFF_DO_NOT,
  workflowInvariants = WORKFLOW_INVARIANTS, ethicsNote = ETHICS_NOTE, generatedAt = null,
} = {}) {
  const mb = manualBlocker && typeof manualBlocker === 'object' && !Array.isArray(manualBlocker)
    ? manualBlocker : null;
  // The manual blocker pending flag is a STRICT tri-state: true / false / null(unknown). A green
  // panel requires it to be a known boolean (truthful status reporting) — never unknown.
  const pending = mb && typeof mb.pending === 'boolean' ? mb.pending : null;

  const ap = mvpApproval && typeof mvpApproval === 'object' && !Array.isArray(mvpApproval)
    ? mvpApproval : null;
  const task = nextSafeTask && typeof nextSafeTask === 'object' && !Array.isArray(nextSafeTask)
    ? nextSafeTask : null;

  const principlesArr = _arr(principles).length ? _arr(principles) : Array.from(PROJECT_PRINCIPLES);
  const doNotArr = _arr(doNot).length ? _arr(doNot) : Array.from(HANDOFF_DO_NOT);
  const workflowArr = _arr(workflowInvariants).length
    ? _arr(workflowInvariants) : Array.from(WORKFLOW_INVARIANTS);
  const note = _str(ethicsNote) || ETHICS_NOTE;

  return {
    badge: HANDOFF_CONTROL_PANEL_BADGE,
    generatedAt: _str(generatedAt),
    version: _str(version),
    liveUrl: _str(liveUrl) || HANDOFF_LIVE_URL,
    dashboardUrl: _str(dashboardUrl) || HANDOFF_DASHBOARD_URL,
    entrySmoke: _smoke(entrySmoke),
    dashboardSmoke: _smoke(dashboardSmoke),
    manualBlocker: {
      pending,
      statusLabel: mb ? _str(mb.statusLabel) : null,
      pill: mb ? _str(mb.pill) : null,
    },
    mvpApproval: {
      approved: ap ? ap.approved === true : false,
      status: ap ? (_str(ap.status) || 'unknown') : 'unknown',
    },
    nextSafeTask: {
      title: task ? _str(task.title) : null,
      why: task ? _str(task.why) : null,
      kind: task ? _str(task.kind) : null,
    },
    principles: principlesArr,
    doNot: doNotArr,
    workflowInvariants: workflowArr,
    ethicsNote: note,
    // Standing safety posture — this panel is read-only oversight; it NEVER triggers a deploy/
    // publish/push/tag/network/Nostr write, never implies MVP approval, never implies the human
    // playtest is complete, and gameplay godMode stays false. Pinned so a reviewer can confirm
    // this surface changes no runtime behaviour.
    safety: {
      deploy: false, publish: false, push: false, tag: false,
      networkWrite: false, nostrWrite: false, godMode: false,
      impliesApproval: false, impliesPlaytestComplete: false,
    },
  };
}

// validateHandoffControlPanel(panel) → { ok, errors, warnings }. Pure; never throws. `ok` is true
// iff there are zero errors. This is the GREEN-REQUIRES-EVIDENCE floor: each missing field or any
// religious language in the ethics copy is an ERROR, so the panel cannot read complete without it.
export function validateHandoffControlPanel(panel) {
  const errors = [];
  const warnings = [];
  const add = (e) => errors.push(e);
  const warn = (w) => warnings.push(w);

  if (!panel || typeof panel !== 'object' || Array.isArray(panel)) {
    return { ok: false, errors: ['control panel is not an object'], warnings };
  }

  // 1. current version marker.
  if (!isVersionMarker(panel.version)) add('a current version marker (vX.Y.Z[-tag]) is required');
  // 2. live + dashboard URLs.
  if (!_str(panel.liveUrl)) add('the live game URL is required');
  if (!_str(panel.dashboardUrl)) add('the live dashboard URL is required');

  // 3 + 4. entry- and dashboard-smoke evidence: each must be a PASS carrying ≥1 check, all
  // passing, and a version marker — a "pass" with no checks or no version is not evidence.
  const requireSmoke = (s, name) => {
    if (!s || typeof s !== 'object') { add(`${name} smoke evidence is missing`); return; }
    if (s.pass !== true) { add(`${name} smoke must be PASS (got ${s.result || 'unknown'})`); return; }
    if (!(_int(s.checks) > 0)) add(`${name} smoke PASS requires at least one recorded check`);
    if (_int(s.failed) > 0) add(`${name} smoke PASS is invalid while any check failed`);
    if (!isVersionMarker(s.version)) add(`${name} smoke PASS requires a concrete version marker`);
  };
  requireSmoke(panel.entrySmoke, 'entry');
  requireSmoke(panel.dashboardSmoke, 'dashboard');

  // 5. manual-blocker semantics: pending must be a KNOWN boolean (truthful status reporting),
  // never unknown. A green handoff panel reports the blocker honestly — pending true OR false.
  const mb = panel.manualBlocker;
  if (!mb || typeof mb !== 'object' || typeof mb.pending !== 'boolean') {
    add('manual-blocker pending must be an explicit boolean (true or false), not unknown');
  }

  // 6. next safe task present.
  if (!panel.nextSafeTask || !_str(panel.nextSafeTask.title)) {
    add('a next safe no-blocker task is required');
  }

  // 7. do-not list + principles present, and the ethics copy must be NON-RELIGIOUS.
  if (!Array.isArray(panel.doNot) || panel.doNot.length === 0) add('the do-not list is required');
  if (!Array.isArray(panel.workflowInvariants) || panel.workflowInvariants.length === 0) {
    add('the workflow invariants (incl. the do-not-cancel-useful-jobs rule) are required');
  }
  if (!Array.isArray(panel.principles) || panel.principles.length === 0) {
    add('the project principles are required');
  } else {
    const ethicsBlob = [panel.ethicsNote || '', ...panel.principles].join('\n');
    const hits = findReligiousLanguage(ethicsBlob);
    if (hits.length) add(`ethics copy must be non-religious — found: ${hits.join(', ')}`);
  }
  if (!_str(panel.ethicsNote)) add('an ethics note is required');

  // Standing posture: every safety flag must stay false.
  const sf = panel.safety || {};
  for (const k of ['deploy', 'publish', 'push', 'tag', 'networkWrite', 'nostrWrite', 'godMode',
    'impliesApproval', 'impliesPlaytestComplete']) {
    if (sf[k] !== false) add(`safety.${k} must be false`);
  }

  // Advisory: a complete green panel that still reports the manual blocker pending is the
  // EXPECTED MVP posture — surface it as a warning, never an error.
  if (mb && mb.pending === true) warn('manual blocker is PENDING — green panel ≠ MVP approved');

  return { ok: errors.length === 0, errors, warnings };
}

// isHandoffPanelGreen(panel) → strict boolean. True ONLY when the panel passes validation, i.e.
// it carries every required piece of evidence AND non-religious ethics copy. "Green" means the
// HANDOFF SURFACE is complete + trustworthy — NOT that the MVP is approved.
export function isHandoffPanelGreen(panel) {
  return !!panel && validateHandoffControlPanel(panel).ok;
}

// HANDOFF_CONTROL_PANEL_REQUIRED_KEYS — the keys a consumer (or guard test) can assert are always
// present, however degraded the inputs. buildHandoffControlPanel never omits these.
export const HANDOFF_CONTROL_PANEL_REQUIRED_KEYS = Object.freeze([
  'badge', 'version', 'liveUrl', 'dashboardUrl', 'entrySmoke', 'dashboardSmoke',
  'manualBlocker', 'mvpApproval', 'nextSafeTask', 'principles', 'doNot', 'workflowInvariants',
  'ethicsNote', 'safety',
]);

// summarizeHandoffControlPanelForState(panel) → the compact block folded into the machine-readable
// next-action state ([[next-action-state]]). Pure; safe on null/garbled. `green` uses
// isHandoffPanelGreen so a half-populated panel reports green:false. Never implies approval.
export function summarizeHandoffControlPanelForState(panel) {
  const p = panel && typeof panel === 'object' && !Array.isArray(panel) ? panel : null;
  const es = p ? _smoke(p.entrySmoke) : _smoke(null);
  const ds = p ? _smoke(p.dashboardSmoke) : _smoke(null);
  const mb = p && p.manualBlocker && typeof p.manualBlocker === 'object' ? p.manualBlocker : {};
  return {
    green: isHandoffPanelGreen(p),
    version: p ? _str(p.version) : null,
    liveUrl: p ? _str(p.liveUrl) : null,
    dashboardUrl: p ? _str(p.dashboardUrl) : null,
    entrySmoke: { result: es.result, pass: es.pass, version: es.version },
    dashboardSmoke: { result: ds.result, pass: ds.pass, version: ds.version },
    manualBlockerPending: typeof mb.pending === 'boolean' ? mb.pending : null,
    nextSafeTask: p && p.nextSafeTask ? (_str(p.nextSafeTask.title) || null) : null,
    workflowInvariants: p && Array.isArray(p.workflowInvariants) ? p.workflowInvariants.length : 0,
    principles: p && Array.isArray(p.principles) ? p.principles.length : 0,
    ethicsNonReligious: p ? !containsReligiousLanguage(
      [p.ethicsNote || '', ...(Array.isArray(p.principles) ? p.principles : [])].join('\n')) : false,
    impliesApproval: false,
    impliesPlaytestComplete: false,
  };
}

// _smokeLabel(s) → a compact one-line label for a smoke block.
function _smokeLabel(s) {
  if (!s) return 'unknown';
  const v = s.version ? ` @ ${s.version}` : '';
  const counts = `${s.passed ?? '?'}/${s.checks ?? '?'} checks`;
  return `${s.pass ? 'PASS' : (s.result || 'unknown')}${v} (${counts}; implies approval: no)`;
}

// buildHandoffControlPanelCard(panel) → a render-ready dashboard card model for the Continuum
// page (same shape as the other card builders: { badge, kind, band, statusLabel, pill, metrics,
// note }). Pure; reuses the existing .metric/.pill markup → NO new script/CSS, so the continuum
// CSP + refresh-script hash stay intact. With no panel it degrades to an honest INCOMPLETE card.
// The pill is 'manual' whenever the manual blocker is pending (the MVP is not approved) — a
// complete handoff surface is still gated on the human playtest — and 'no-blocker' only when the
// panel is green AND the blocker is explicitly clear.
export function buildHandoffControlPanelCard(panel = null) {
  const p = panel && typeof panel === 'object' && !Array.isArray(panel)
    ? panel : buildHandoffControlPanel();
  const green = isHandoffPanelGreen(p);
  const pending = p.manualBlocker && typeof p.manualBlocker.pending === 'boolean'
    ? p.manualBlocker.pending : null;

  let band; let statusLabel; let pill;
  if (!green) {
    band = 'incomplete'; statusLabel = 'HANDOFF PANEL INCOMPLETE · MISSING EVIDENCE'; pill = 'manual';
  } else if (pending) {
    band = 'ready-pending'; statusLabel = 'HANDOFF READY · MVP BLOCKER PENDING (USER PLAYTEST + OK)'; pill = 'manual';
  } else {
    band = 'ready-clear'; statusLabel = 'HANDOFF READY · NO BLOCKER'; pill = 'no-blocker';
  }

  const task = p.nextSafeTask || {};
  const metrics = [
    { label: 'Version', value: p.version || '(unset)' },
    { label: 'Live game', value: p.liveUrl || '(unknown)' },
    { label: 'Live dashboard', value: p.dashboardUrl || '(unknown)' },
    { label: 'Entry smoke', value: _smokeLabel(p.entrySmoke) },
    { label: 'Dashboard smoke', value: _smokeLabel(p.dashboardSmoke) },
    { label: 'Manual blocker', value: pending === true
      ? `PENDING — ${p.manualBlocker.statusLabel || 'user must run live playtest + approve'}`
      : (pending === false ? 'clear' : 'unknown') },
    { label: 'MVP approval', value: p.mvpApproval && p.mvpApproval.approved ? 'APPROVED' : 'PENDING (explicit user OK required)' },
    { label: 'Next safe task', value: task.title || '(none)' },
    { label: 'Do NOT (without user OK)', value: (p.doNot || []).join(' · ') },
    { label: 'Workflow invariants', value: (p.workflowInvariants || []).join(' · ') },
    { label: 'Operating principles', value: (p.principles || []).join(' · ') },
    { label: 'Ethics', value: p.ethicsNote || '' },
  ];

  return {
    badge: HANDOFF_CONTROL_PANEL_BADGE,
    kind: p.version ? 'generated' : 'last-known',
    band,
    statusLabel,
    pill,
    green,
    metrics,
    note: 'Handoff / release control panel — the single read-only surface a fresh agent or human '
      + 'reads first to pick up the project safely: current version + live URLs, the latest app-entry '
      + 'and oversight-dashboard cloud smokes, the one manual blocker (the human must run the live-'
      + 'browser MVP playtest and explicitly approve), the next safe no-blocker task, the exact '
      + 'actions NOT to take without user input, the standing workflow invariants (e.g. finish a useful '
      + 'in-progress job rather than cancelling it), and the project\'s practical non-religious operating '
      + 'principles. GREEN means this surface is COMPLETE + trustworthy, NOT that the MVP is approved: '
      + 'a smoke pass is not approval, a dashboard pass is not a completed human playtest, and no live '
      + 'Nostr write is ever implied. It approves/releases/deploys/publishes NOTHING.',
  };
}
