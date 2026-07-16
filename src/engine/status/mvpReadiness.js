// engine/status/mvpReadiness.js — pure, node-safe MVP RELEASE-READINESS ROLLUP
// (v0.2.198, LEAN oversight continuation). It folds the already-pure local readiness
// signals into ONE read-only rollup so the user can see the MVP percentage / status and
// the next safest task WITHOUT manually digging through every harness, doc, and gate:
//
//   1. version marker         — config VERSION is a valid vX.Y.Z[-tag] marker
//   2. nostr read health      — runReadHealth().ok (read-only relay/profile/leaderboard)
//   3. gateway travel smoke   — runGatewayTravelSmoke().ok (proximity→confirm dry-run)
//   4. update-flow smoke      — runUpdateFlowSmoke().ok (manual-only, no auto-update)
//   5. host-route smoke       — runHostRouteSmoke().ok (/zone/* SPA fallback + assets)
//   6. release metadata floor — validateReleaseMeta(buildReleaseMeta) ok + tampered floor
//   7. test suite             — injected count/profile status (last-known default)
//   8. vps dry-run            — injected dry-run verdict (last-known default)
//   9. docs / handoff         — injected continuity-docs in-sync verdict (default)
//
// A single `ok` answers "is the MVP proof surface still green end-to-end?" and a derived
// `mvpPct` / `status` summarises how close the read-only MVP proof is, so a glance (or a
// future regression check) replaces hand-checking each module.
//
// Constrained by construction — this rollup adds NO new capability:
//   - PURE + node-safe: no THREE/Rapier/DOM/window/location/fs/child_process/network/socket
//     imports. The four live smoke verdicts are computed from the already-pure harnesses
//     over their own deterministic LOCAL fixtures; the fs-backed signals (test counts, VPS
//     dry-run, docs/handoff freshness) are INJECTED via opts with curated last-known
//     defaults, exactly like the dashboard ship/health models — a build/CLI step can feed
//     real values without making this module impure.
//   - It composes plain-data outputs only; it renders and acts on nothing, exposes NO
//     serve/deploy/publish/fetch/write/exec/navigate surface, and never throws (every
//     check is wrapped; a broken signal degrades to a fail with a concrete reason).

import { VERSION } from '../../config.js';
import { runReadHealth } from '../nostr/readHealth.js';
import { runGatewayTravelSmoke } from '../gateway/travelSmoke.js';
import { runUpdateFlowSmoke } from '../update/updateFlowSmoke.js';
import { runHostRouteSmoke } from '../host/hostRouteSmoke.js';
import { buildReleaseMeta, validateReleaseMeta } from '../../../tools/releaseMeta.mjs';

// MVP_READINESS_VERSION — bumped when the rollup report shape changes.
export const MVP_READINESS_VERSION = 1;

// Badge stamped on the report: this aggregates readiness, but read-only + inert.
export const MVP_READINESS_BADGE = 'MVP READINESS ROLLUP · READ-ONLY · NO DEPLOY';

// Safety flags every rollup report MUST pin false. The rollup only READS already-computed
// verdicts; it serves/deploys/publishes/navigates/writes/fetches nothing.
const SAFETY_FLAGS = Object.freeze([
  'served', 'deployed', 'published', 'navigated',
  'performed', 'fetched', 'wrote', 'network',
]);

// DEFAULT_TEST_STATUS — the last-known local test verdict (vitest), injected as a curated
// fixture so the module stays pure. A build/CLI step can pass the live numbers via
// opts.tests. Kept in lock-step with the dashboard's CURRENT_TEST_STATUS capture
// (toriiQuestData.js) — a unit test (tests/torii-quest-dashboard.render.test.js, v0.2.200) asserts
// the two captures agree, so this count can't quietly drift from the dashboard's.
export const DEFAULT_TEST_STATUS = Object.freeze({
  passing: 2586,
  files: 147,
  profile: 'full',
  ok: true,
});

// DEFAULT_VPS_DRY_RUN — the last-known `npm run vps:dry-run` verdict. Injected via
// opts.vpsDryRun. The real dry-run is fs-backed (tools/vpsDryRun.mjs) and stays outside
// this pure module.
export const DEFAULT_VPS_DRY_RUN = Object.freeze({
  ok: true,
  detail: 'manual-deploy dry-run green (no server/SSH/network touched)',
});

// DEFAULT_DOCS_STATUS — the last-known continuity-docs freshness verdict (the regression
// docConsistency [14] + handoff:status surface). Injected via opts.docs.
export const DEFAULT_DOCS_STATUS = Object.freeze({
  ok: true,
  detail: 'continuity docs reference the current version; handoff in sync',
});

// NEXT_SAFE_TASK — the recommended next SAFE slice. Deliberately no-runtime-risk
// infra/tooling/docs that ships without unlocking a gate; live runtime / Nostr writes stay
// parked behind SEC-1/2/3 and a manual deploy. Override via opts.nextSafeTask.
export const NEXT_SAFE_TASK = Object.freeze({
  title: 'Continue the read-only oversight loop — next safe infra/dashboard/tooling slice',
  why: 'Keep shipping no-runtime-risk tooling/docs that make the MVP proof easier to read and '
    + 'the gate harder to get wrong. SEC-gated live-relay / world-hop / shooting work stays '
    + 'parked behind SEC-1/2/3 and a manual deploy — not a safe pick yet.',
  kind: 'infra',
});

// _bool(v) → strict boolean coercion: only an explicit true is true.
function _bool(v) { return v === true; }

// _signal(key, label, ok, detail) → a plain-data rollup signal row.
function _signal(key, label, ok, detail) {
  return { key, label, status: ok ? 'ok' : 'fail', detail: String(detail || '') };
}

// _injected(opt, fallback) → use a well-shaped injected object, else the curated default.
function _injected(opt, fallback) {
  return (opt && typeof opt === 'object' && !Array.isArray(opt)) ? opt : fallback;
}

// runMvpReadiness(opts?) → a JSON-serialisable, read-only MVP readiness rollup:
//   {
//     version, badge, ok, mvpPct, status,
//     signals: [ { key, label, status:'ok'|'fail', detail } ],
//     summary: { total, ok, fail },
//     safety:  { served:false, deployed:false, ... },   // contract
//     reasons: [ ... ],          // failing signal keys + details (empty iff ok)
//     nextSafeTask, currentVersion,
//     rendered: false, actionable: false,
//   }
// `ok` is true iff EVERY signal passes; `mvpPct` is the share of passing signals (0..100)
// and `status` is a coarse READY/NEAR/ATTENTION band. The live smoke verdicts come from
// the pure harnesses; fs-backed signals (tests/VPS/docs) are injected via opts with curated
// defaults. Pure — never throws, never deploys, never acts.
export function runMvpReadiness(opts = {}) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const tests = _injected(o.tests, DEFAULT_TEST_STATUS);
  const vps = _injected(o.vpsDryRun, DEFAULT_VPS_DRY_RUN);
  const docs = _injected(o.docs, DEFAULT_DOCS_STATUS);
  const nextSafeTask = _injected(o.nextSafeTask, NEXT_SAFE_TASK);

  const signals = [];

  // 1. Version marker — the running version is a valid vX.Y.Z[-tag] marker.
  try {
    const v = String(VERSION || '').trim();
    const ok = /^v\d+\.\d+\.\d+(?:-[a-z][a-z0-9.]*)?$/i.test(v);
    signals.push(_signal('version-marker', 'Version marker valid', ok, `VERSION=${v}`));
  } catch (e) {
    signals.push(_signal('version-marker', 'Version marker valid', false, `threw: ${e.message}`));
  }

  // 2. Nostr read health — the read-only relay/profile/leaderboard path is green.
  try {
    const r = runReadHealth();
    const ok = _bool(r.ok);
    signals.push(_signal('nostr-read-health', 'Nostr read-path health', ok,
      `${r.summary ? r.summary.ok : 0}/${r.summary ? r.summary.total : 0} signals`));
  } catch (e) {
    signals.push(_signal('nostr-read-health', 'Nostr read-path health', false, `threw: ${e.message}`));
  }

  // 3. Gateway travel smoke — the proximity→confirm dry-run safety contract holds.
  try {
    const r = runGatewayTravelSmoke();
    const ok = _bool(r.ok);
    signals.push(_signal('gateway-travel-smoke', 'Gateway travel smoke', ok,
      `${r.summary ? r.summary.ok : 0}/${r.summary ? r.summary.total : 0} signals`));
  } catch (e) {
    signals.push(_signal('gateway-travel-smoke', 'Gateway travel smoke', false, `threw: ${e.message}`));
  }

  // 4. Update-flow smoke — the manual-only / no-auto-update path holds.
  try {
    const r = runUpdateFlowSmoke();
    const ok = _bool(r.ok);
    signals.push(_signal('update-flow-smoke', 'Update-flow smoke', ok,
      `${r.summary ? r.summary.ok : 0}/${r.summary ? r.summary.total : 0} signals`));
  } catch (e) {
    signals.push(_signal('update-flow-smoke', 'Update-flow smoke', false, `threw: ${e.message}`));
  }

  // 5. Host-route smoke — the /zone/* SPA fallback + asset contracts hold.
  try {
    const r = runHostRouteSmoke();
    const ok = _bool(r.ok);
    signals.push(_signal('host-route-smoke', 'Host route + asset smoke', ok,
      `${r.summary ? r.summary.ok : 0}/${r.summary ? r.summary.total : 0} signals`));
  } catch (e) {
    signals.push(_signal('host-route-smoke', 'Host route + asset smoke', false, `threw: ${e.message}`));
  }

  // 6. Release metadata floor — metadata validates AND a tampered autoUpdate is rejected.
  try {
    const meta = buildReleaseMeta({ version: VERSION });
    const good = validateReleaseMeta(meta);
    const tampered = validateReleaseMeta({ ...meta, update: { ...meta.update, autoUpdate: true } });
    const ok = _bool(good.ok) && tampered.ok === false
      && meta.update.autoUpdate === false && meta.update.actionable === false;
    signals.push(_signal('release-metadata-floor', 'Release metadata safety floor', ok,
      `valid=${good.ok}, tampered rejected=${!tampered.ok}`));
  } catch (e) {
    signals.push(_signal('release-metadata-floor', 'Release metadata safety floor', false, `threw: ${e.message}`));
  }

  // 7. Test suite — the injected last-known vitest verdict is green.
  try {
    const ok = _bool(tests.ok);
    signals.push(_signal('test-suite', 'Test suite passing', ok,
      `${tests.passing != null ? tests.passing : '?'} passing / ${tests.files != null ? tests.files : '?'} files (${tests.profile || 'full'})`));
  } catch (e) {
    signals.push(_signal('test-suite', 'Test suite passing', false, `threw: ${e.message}`));
  }

  // 8. VPS dry-run — the injected manual-deploy dry-run verdict is green.
  try {
    const ok = _bool(vps.ok);
    signals.push(_signal('vps-dry-run', 'VPS manual-deploy dry-run', ok, vps.detail || ''));
  } catch (e) {
    signals.push(_signal('vps-dry-run', 'VPS manual-deploy dry-run', false, `threw: ${e.message}`));
  }

  // 9. Docs / handoff — the injected continuity-docs freshness verdict is green.
  try {
    const ok = _bool(docs.ok);
    signals.push(_signal('docs-handoff', 'Docs / handoff in sync', ok, docs.detail || ''));
  } catch (e) {
    signals.push(_signal('docs-handoff', 'Docs / handoff in sync', false, `threw: ${e.message}`));
  }

  const failed = signals.filter((s) => s.status !== 'ok');
  const reasons = failed.map((s) => `${s.key}: ${s.detail}`);
  const total = signals.length;
  const okCount = total - failed.length;
  const mvpPct = total === 0 ? 0 : Math.round((okCount / total) * 100);
  // Coarse band: all green → READY; one short → NEAR; otherwise ATTENTION.
  const status = failed.length === 0 ? 'READY' : (failed.length === 1 ? 'NEAR' : 'ATTENTION');

  return {
    version: MVP_READINESS_VERSION,
    badge: MVP_READINESS_BADGE,
    ok: failed.length === 0,
    mvpPct,
    status,
    currentVersion: String(VERSION || ''),
    signals,
    summary: { total, ok: okCount, fail: failed.length },
    // Observed safety posture — all false in every run (mirrors the contract).
    safety: {
      served: false, deployed: false, published: false, navigated: false,
      performed: false, fetched: false, wrote: false, network: false,
    },
    reasons,
    nextSafeTask: {
      title: String(nextSafeTask.title || NEXT_SAFE_TASK.title),
      why: String(nextSafeTask.why || NEXT_SAFE_TASK.why),
      kind: String(nextSafeTask.kind || NEXT_SAFE_TASK.kind),
    },
    // A read-only rollup, not a deploy tool — never renders or acts.
    rendered: false,
    actionable: false,
  };
}

// formatMvpReadiness(result) → a stable, human-readable text block for a debug shell /
// audit log. Pure, never throws, safe on null.
export function formatMvpReadiness(result) {
  const r = (result && typeof result === 'object') ? result : runMvpReadiness();
  const lines = [];
  lines.push(r.badge || MVP_READINESS_BADGE);
  const s = r.summary || { total: 0, ok: 0, fail: 0 };
  lines.push(`MVP ${r.mvpPct != null ? r.mvpPct : 0}%  ·  ${r.status || '?'}  ·  ${r.currentVersion || ''}`);
  lines.push(`verdict: ${r.ok ? 'OK' : 'FAIL'}  (${s.ok}/${s.total} signals)`);
  for (const sig of (Array.isArray(r.signals) ? r.signals : [])) {
    lines.push(`  ${sig.status === 'ok' ? '✓' : '✗'} ${sig.label} — ${sig.detail}`);
  }
  if (Array.isArray(r.reasons) && r.reasons.length) {
    lines.push(`reasons: ${r.reasons.join('; ')}`);
  }
  if (r.nextSafeTask && r.nextSafeTask.title) {
    lines.push(`next safe task: ${r.nextSafeTask.title}`);
  }
  return lines.join('\n');
}
