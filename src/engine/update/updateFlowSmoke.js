// engine/update/updateFlowSmoke.js — pure, node-safe UPDATE-FLOW SMOKE HARNESS
// (UPDATE / torii.quest + VPS self-update path, v0.2.196, LEAN-5 continuation). It
// folds the already-pure update-check contracts into ONE fail-fast smoke report so
// future VPS/self-update work can be regression-checked locally without a browser,
// shell, package manager, or network:
//
//   1. current version read            — config VERSION is a valid version marker
//   2. release metadata shape           — selectLatestRelease yields a usable release
//   3. update availability classified   — a newer release → update-available
//   4. up-to-date classified            — a same/older release → up-to-date
//   5. unknown degrades safely          — draft/empty/malformed → unknown, no throw
//   6. manual-only, no auto-update      — status panel + view are readOnly/actionable:false
//   7. metadata safety floor            — validateReleaseMeta ERRORS if autoUpdate/actionable
//   8. no exec / install / fetch surface— outputs expose no shell/install/network method
//   9. confirmation-gated               — update:apply blocked w/o grant; allowed but
//                                          never performed WITH a grant (no irreversible act)
//  10. no auto action                   — read path is synchronous plain data; every
//                                          report pins performed/actionable/autoUpdate/
//                                          installed/executed/fetched/network/signed/
//                                          published/navigated = false
//
// A single `ok` answers "do the update-flow safety contracts still hold?" so a test
// (and a future regression check) can fail fast with a concrete `reasons` list instead
// of discovering an unsafe updater path in production.
//
// Constrained by construction — this harness adds NO new capability and exercises the
// flow in the SAFEST possible mode:
//   - PURE + node-safe: no THREE/Rapier/DOM/window/fs/child_process/network imports. It
//     evaluates DETERMINISTIC LOCAL release fixtures only and never reaches the wire.
//   - It composes plain-data outputs of the shipped pure helpers; it renders and acts on
//     nothing, exposes NO fetch/install/update/apply/exec/spawn/download/navigate surface,
//     and never throws (every check is wrapped; malformed input degrades to a fail).
//   - The single network entry in the update layer (githubReleaseSource.fetchLatestRelease)
//     is host-only and refuses without an injected fetcher; this harness never invokes it.
//   - All manual-only / no-auto-update / consent guarantees are inherited unchanged from
//     the modules it exercises.

import { VERSION } from '../../config.js';
import {
  selectLatestRelease, evaluateFromSource, SOURCE_STATUS, SOURCE_KIND,
} from './githubReleaseSource.js';
import { evaluateUpdate, updateCheckView, UPDATE_STATUS } from './updateCheck.js';
import { updateStatusPanel } from './updateStatus.js';
import { evaluateConsent, CONSENT_REASON } from '../consent/consentGate.js';
import { buildReleaseMeta, validateReleaseMeta } from '../../../tools/releaseMeta.mjs';

// UPDATE_SMOKE_VERSION — bumped when the smoke report shape changes.
export const UPDATE_SMOKE_VERSION = 1;

// Badge stamped on the report: this exercises the update flow, but read-only + inert.
export const UPDATE_SMOKE_BADGE = 'UPDATE FLOW SMOKE · READ-ONLY · NO AUTO-UPDATE';

// The action a real self-update WOULD pass through the consent gate. Pinned here so the
// harness and tests assert against the same identifier.
export const UPDATE_ACTION = 'update:apply';

// Safety flags every update-flow report MUST pin false. A report that flips any of these
// would mean the no-auto-action / no-install / no-network contract is broken.
const SAFETY_FLAGS = Object.freeze([
  'performed', 'actionable', 'autoUpdate', 'installed', 'executed',
  'fetched', 'network', 'signed', 'published', 'navigated',
]);

// Method/identifier names that would imply the ability to ACT on an update — fetch the
// wire, run a shell, install a package, mutate the repo, or apply code. The read-only
// update outputs must expose NONE of these as a callable.
const FORBIDDEN_METHODS = Object.freeze([
  'fetch', 'install', 'update', 'apply', 'exec', 'spawn', 'run',
  'download', 'write', 'navigate', 'sign', 'publish', 'deploy',
]);

// A deterministic LOCAL "newer release" feed (GitHub `releases` array shape). The newest
// eligible entry is far ahead of any real version, so it always classifies as
// update-available without ever touching the wire. Fixed for reproducibility.
export const SAMPLE_NEWER_FEED = Object.freeze([
  Object.freeze({
    tag_name: 'v0.2.500-alpha',
    name: 'Torii Quest v0.2.500-alpha',
    html_url: 'https://github.com/ChiefmonkeyArt/torii-gate/releases/tag/v0.2.500-alpha',
    body: 'Older sample release (local fixture).',
    draft: false,
    prerelease: true,
    published_at: '2026-05-01T00:00:00Z',
  }),
  Object.freeze({
    tag_name: 'v0.2.999-alpha',
    name: 'Torii Quest v0.2.999-alpha',
    html_url: 'https://github.com/ChiefmonkeyArt/torii-gate/releases/tag/v0.2.999-alpha',
    body: 'Newest sample release (local fixture) — nostrich skins, Chiefmonkey balance.',
    draft: false,
    prerelease: true,
    published_at: '2026-06-24T00:00:00Z',
  }),
]);

// A deterministic LOCAL release that exactly matches the running version → up-to-date.
export const SAMPLE_CURRENT_RELEASE = Object.freeze({
  tag_name: VERSION,
  name: `Torii Quest ${VERSION}`,
  html_url: 'https://github.com/ChiefmonkeyArt/torii-gate/releases/tag/' + VERSION,
  body: 'Current running version (local fixture).',
  draft: false,
  prerelease: true,
  published_at: '2026-06-25T00:00:00Z',
});

// Payloads a malformed/garbled source could yield — each must degrade to an UNKNOWN
// verdict (never throw, never fabricate a version). Deterministic fixture.
export const MALFORMED_PAYLOADS = Object.freeze([
  null,
  42,
  'not-a-release',
  Object.freeze({}),                                  // object with no tag
  Object.freeze({ draft: true, tag_name: 'v9.9.9' }), // draft → filtered out
  Object.freeze([]),                                  // empty list
]);

// _flagsAllFalse(report) → true iff every SAFETY_FLAG present on the report is false.
// A missing flag is treated as safe (false); a flag that is exactly `true` fails.
function _flagsAllFalse(report) {
  if (!report || typeof report !== 'object') return true;
  for (const f of SAFETY_FLAGS) {
    if (report[f] === true) return false;
  }
  return true;
}

// _noForbiddenMethods(obj) → true iff `obj` exposes none of FORBIDDEN_METHODS as a
// callable. A forbidden name that is a non-function value (e.g. a boolean flag like
// `actionable`) is allowed; only a callable would imply the ability to act.
function _noForbiddenMethods(obj) {
  if (!obj || typeof obj !== 'object') return true;
  for (const name of FORBIDDEN_METHODS) {
    if (typeof obj[name] === 'function') return false;
  }
  return true;
}

// _signal(key, label, ok, detail) → a plain-data smoke signal row.
function _signal(key, label, ok, detail) {
  return { key, label, status: ok ? 'ok' : 'fail', detail: String(detail || '') };
}

// runUpdateFlowSmoke(opts?) → a JSON-serialisable, read-only smoke report:
//   {
//     version, badge, ok,
//     signals: [ { key, label, status:'ok'|'fail', detail } ],
//     summary: { total, ok, fail },
//     safety:  { performed:false, actionable:false, autoUpdate:false, ... },  // contract
//     reasons: [ ... ],   // failing signal keys + details (empty iff ok)
//     rendered: false, actionable: false,
//   }
// `ok` is true iff ALL signals pass AND no exercised report flipped a safety flag.
// Fixtures may be injected via opts (newerFeed / currentRelease / malformed) so a test
// can drive a deliberately-broken flow and prove the harness catches it. Pure — never
// throws, never fetches, never installs, never acts.
export function runUpdateFlowSmoke(opts = {}) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const newerFeed = o.newerFeed || SAMPLE_NEWER_FEED;
  const currentRelease = o.currentRelease || SAMPLE_CURRENT_RELEASE;
  const malformed = Array.isArray(o.malformed) ? o.malformed : MALFORMED_PAYLOADS;

  const signals = [];
  // Track whether ANY exercised report flipped a safety flag.
  let safetyClean = true;
  const _watch = (report) => { if (!_flagsAllFalse(report)) safetyClean = false; return report; };

  // 1. Current version read — the running version is a valid marker the flow compares
  // against. (vX.Y.Z[-tag]; a missing/garbled VERSION would break every verdict.)
  try {
    const v = String(VERSION || '');
    const ok = /^v\d+\.\d+\.\d+(?:-[a-z][a-z0-9.]*)?$/i.test(v.trim());
    signals.push(_signal('current-version-read', 'Current version read', ok, `VERSION=${v}`));
  } catch (e) {
    signals.push(_signal('current-version-read', 'Current version read', false, `threw: ${e.message}`));
  }

  // 2. Release metadata shape — a well-formed releases feed yields a usable release.
  try {
    const sel = selectLatestRelease(newerFeed);
    const ok = sel.status === SOURCE_STATUS.OK && sel.kind === SOURCE_KIND.LIST
      && !!sel.release && typeof sel.release.tag_name === 'string';
    signals.push(_signal(
      'release-metadata-shape',
      'Release metadata shape parsed',
      ok,
      `status=${sel.status}, kind=${sel.kind}, tag=${sel.release ? sel.release.tag_name : 'none'}`,
    ));
  } catch (e) {
    signals.push(_signal('release-metadata-shape', 'Release metadata shape parsed', false, `threw: ${e.message}`));
  }

  // 3. Update availability classified — a strictly-newer release → update-available.
  try {
    const evald = evaluateFromSource(newerFeed);
    const ok = evald.status === UPDATE_STATUS.UPDATE_AVAILABLE && evald.updateAvailable === true;
    signals.push(_signal(
      'update-available-classified',
      'Newer release → update-available',
      ok,
      `status=${evald.status}, latest=${evald.latestVersion}, available=${evald.updateAvailable}`,
    ));
  } catch (e) {
    signals.push(_signal('update-available-classified', 'Newer release → update-available', false, `threw: ${e.message}`));
  }

  // 4. Up-to-date classified — a release equal to the running version → up-to-date.
  try {
    const evald = evaluateUpdate(currentRelease, VERSION);
    const ok = evald.status === UPDATE_STATUS.UP_TO_DATE && evald.updateAvailable === false;
    signals.push(_signal(
      'up-to-date-classified',
      'Current release → up-to-date',
      ok,
      `status=${evald.status}, available=${evald.updateAvailable}`,
    ));
  } catch (e) {
    signals.push(_signal('up-to-date-classified', 'Current release → up-to-date', false, `threw: ${e.message}`));
  }

  // 5. Unknown degrades safely — every malformed payload → unknown, updateAvailable:false,
  // and the call never throws.
  try {
    const bad = [];
    for (const payload of malformed) {
      const evald = evaluateFromSource(payload);
      if (evald.status !== UPDATE_STATUS.UNKNOWN || evald.updateAvailable !== false) {
        bad.push(JSON.stringify(payload));
      }
    }
    signals.push(_signal(
      'unknown-degrades-safely',
      'Malformed payloads → unknown (no throw)',
      bad.length === 0,
      bad.length === 0 ? `all ${malformed.length} degraded to unknown` : `misclassified: ${bad.join(', ')}`,
    ));
  } catch (e) {
    signals.push(_signal('unknown-degrades-safely', 'Malformed payloads → unknown (no throw)', false, `threw: ${e.message}`));
  }

  // 6. Manual-only, no auto-update — the in-game status panel + view are display-only.
  try {
    const panel = _watch(updateStatusPanel(newerFeed));
    const view = _watch(updateCheckView(SAMPLE_NEWER_FEED[1]));
    const ok = panel.readOnly === true && panel.actionable === false
      && view.actionable === false
      && typeof panel.badge === 'string' && /MANUAL/.test(panel.badge);
    signals.push(_signal(
      'manual-only-no-auto-update',
      'Status panel/view are display-only (manual)',
      ok,
      `panel readOnly=${panel.readOnly}/actionable=${panel.actionable}, view actionable=${view.actionable}`,
    ));
  } catch (e) {
    signals.push(_signal('manual-only-no-auto-update', 'Status panel/view are display-only (manual)', false, `threw: ${e.message}`));
  }

  // 7. Metadata safety floor — release metadata validates ONLY with the no-auto-update
  // contract (autoUpdate:false / actionable:false / manual:true); a tampered metadata
  // that flips autoUpdate is REJECTED.
  try {
    const meta = buildReleaseMeta({ version: VERSION });
    const good = validateReleaseMeta(meta);
    const tampered = validateReleaseMeta({ ...meta, update: { ...meta.update, autoUpdate: true } });
    const ok = good.ok === true
      && meta.update.autoUpdate === false && meta.update.actionable === false && meta.update.manual === true
      && tampered.ok === false
      && tampered.errors.some((e) => /autoUpdate MUST be false/.test(e));
    signals.push(_signal(
      'metadata-safety-floor',
      'Metadata enforces no-auto-update floor',
      ok,
      `valid=${good.ok}, tampered rejected=${!tampered.ok}`,
    ));
  } catch (e) {
    signals.push(_signal('metadata-safety-floor', 'Metadata enforces no-auto-update floor', false, `threw: ${e.message}`));
  }

  // 8. No exec / install / fetch surface — none of the read-only update outputs expose a
  // callable that could fetch the wire, run a shell, install a package, or apply code.
  try {
    const panel = updateStatusPanel(newerFeed);
    const view = updateCheckView(SAMPLE_NEWER_FEED[1]);
    const meta = buildReleaseMeta({ version: VERSION });
    const evald = evaluateFromSource(newerFeed);
    const offenders = [];
    if (!_noForbiddenMethods(panel)) offenders.push('panel');
    if (!_noForbiddenMethods(view)) offenders.push('view');
    if (!_noForbiddenMethods(meta)) offenders.push('meta');
    if (!_noForbiddenMethods(evald)) offenders.push('evaluation');
    signals.push(_signal(
      'no-exec-install-surface',
      'No exec/install/fetch surface on outputs',
      offenders.length === 0,
      offenders.length === 0 ? 'no fetch/install/exec/apply/spawn/write callable exposed' : `offenders: ${offenders.join(', ')}`,
    ));
  } catch (e) {
    signals.push(_signal('no-exec-install-surface', 'No exec/install/fetch surface on outputs', false, `threw: ${e.message}`));
  }

  // 9. Confirmation-gated — applying an update is a write/update action: blocked without
  // an explicit grant; allowed WITH a matching grant but the gate STILL never performs
  // it (no irreversible action without — and not even with — explicit confirmation here).
  try {
    const noGrant = _watch(evaluateConsent(UPDATE_ACTION, null));
    const withGrant = _watch(evaluateConsent(UPDATE_ACTION, true));
    const ok = noGrant.allowed === false && noGrant.blocked === true
      && noGrant.reason === CONSENT_REASON.CONSENT_REQUIRED
      && withGrant.allowed === true && withGrant.reason === CONSENT_REASON.CONSENT_GRANTED
      && withGrant.performed === false && noGrant.performed === false;
    signals.push(_signal(
      'confirmation-gated',
      'Apply-update is confirmation-gated',
      ok,
      `noGrant.blocked=${noGrant.blocked}/${noGrant.reason}, grant.allowed=${withGrant.allowed}, grant.performed=${withGrant.performed}`,
    ));
  } catch (e) {
    signals.push(_signal('confirmation-gated', 'Apply-update is confirmation-gated', false, `threw: ${e.message}`));
  }

  // 10. No auto action — every exercised report kept all safety flags false, and the
  // read/eval path is synchronous plain data (never a Promise → never an awaited fetch).
  try {
    const evald = evaluateFromSource(newerFeed);
    const panel = updateStatusPanel(newerFeed);
    const synchronous = typeof evald.then !== 'function' && typeof panel.then !== 'function';
    signals.push(_signal(
      'no-auto-action',
      'No automatic update / fetch / install',
      safetyClean === true && synchronous,
      safetyClean && synchronous
        ? 'all reports pinned performed/actionable/autoUpdate/installed/executed/fetched/network=false; read path is synchronous'
        : (synchronous ? 'a report flipped a safety flag' : 'read path returned a thenable'),
    ));
  } catch (e) {
    signals.push(_signal('no-auto-action', 'No automatic update / fetch / install', false, `threw: ${e.message}`));
  }

  const failed = signals.filter((s) => s.status !== 'ok');
  const reasons = failed.map((s) => `${s.key}: ${s.detail}`);

  return {
    version: UPDATE_SMOKE_VERSION,
    badge: UPDATE_SMOKE_BADGE,
    ok: failed.length === 0,
    signals,
    summary: { total: signals.length, ok: signals.length - failed.length, fail: failed.length },
    // Observed safety posture — all false in a clean run (mirrors the contract).
    safety: {
      performed: false, actionable: false, autoUpdate: false, installed: false,
      executed: false, fetched: false, network: false, signed: false,
      published: false, navigated: false,
    },
    reasons,
    // A smoke harness, not a live updater — never renders or acts.
    rendered: false,
    actionable: false,
  };
}

// formatUpdateFlowSmoke(result) → a stable, human-readable text block for a debug
// shell / audit log. Pure, never throws, safe on null.
export function formatUpdateFlowSmoke(result) {
  const r = (result && typeof result === 'object') ? result : runUpdateFlowSmoke();
  const lines = [];
  lines.push(r.badge || UPDATE_SMOKE_BADGE);
  const s = r.summary || { total: 0, ok: 0, fail: 0 };
  lines.push(`verdict: ${r.ok ? 'OK' : 'FAIL'}  (${s.ok}/${s.total} signals)`);
  for (const sig of (Array.isArray(r.signals) ? r.signals : [])) {
    lines.push(`  ${sig.status === 'ok' ? '✓' : '✗'} ${sig.label} — ${sig.detail}`);
  }
  if (Array.isArray(r.reasons) && r.reasons.length) {
    lines.push(`reasons: ${r.reasons.join('; ')}`);
  }
  return lines.join('\n');
}
