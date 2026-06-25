// tools/mvpRcGate.mjs — PURE, node-safe MVP RELEASE-CANDIDATE GATE assembly + formatting
// (v0.2.201). Answers ONE question for a handoff/shipper: is this build ready to be called an
// MVP proof-of-concept RELEASE CANDIDATE? It does so by FOLDING the two already-computed
// composite readiness verdicts — the MVP readiness rollup (engine/status/mvpReadiness.js, 9
// live + injected signals: version marker, Nostr read health, gateway-travel smoke, update-flow
// smoke, host-route smoke, release-metadata safety floor, test suite, VPS dry-run, docs/handoff)
// and the release-readiness summary (tools/releaseReadiness.mjs: version sync, test profiles,
// the regression-check gate, the advisory bundle baseline, the /zone/* fallback, docs
// consistency) — into ONE concise verdict: READY / NEAR / BLOCKED, a percentage, the blocking
// reasons, and the next one or two safe tasks.
//
// Pure + deterministic: NO fs, NO network, NO child_process, NO process in here. The CLI
// (tools/mvp-rc-gate.mjs) does the fs/git I/O — it runs runMvpReadiness() + gatherReleaseReadiness()
// + buildHandoffSummary() and hands their plain verdicts to these helpers — so the assembly /
// banding / formatting is unit-testable (tests/mvp-rc-gate.test.js). It COMPOSES the existing
// pure verdicts; it re-implements no check, contacts no server, and creates NO release: it makes
// no git tag, no GitHub release, no deploy, no publish, no upload. Null/garbled inputs degrade to
// an honest BLOCKED-with-UNKNOWNs verdict; it never throws.

// Stable schema id + integer version for the machine-readable (--json) mode. Bump
// MVP_RC_GATE_SCHEMA_VERSION on any breaking shape change.
export const MVP_RC_GATE_SCHEMA = 'torii.mvp-rc-gate';
export const MVP_RC_GATE_SCHEMA_VERSION = 1;

// Badge naming the gate as read-only local oversight, never a release/deploy action.
export const MVP_RC_GATE_BADGE = 'MVP RELEASE-CANDIDATE GATE · LOCAL · READ-ONLY';

// The full release gate this verdict PREVIEWS. The RC gate never runs it — it only reports
// whether the composed local signals are green. The authoritative gate stays this command.
export const MVP_RC_GATE_COMMAND = 'npm run test:release';

// The three coarse RC verdicts (never over-claims):
//   READY   — both composites fully green (no blockers, no unknowns) → call it an RC
//   NEAR    — one short / signals not checked this pass, but nothing hard-blocking
//   BLOCKED — a real blocker (failing required signal) → not an RC yet
export const MVP_RC_STATES = Object.freeze(['READY', 'NEAR', 'BLOCKED']);

// _str(x) → trimmed non-empty string, else null. Pure.
function _str(x) {
  return (typeof x === 'string' && x.trim()) ? x.trim() : null;
}

// _int(x) → integer, else null. Pure.
function _int(x) {
  return Number.isInteger(x) ? x : null;
}

// _obj(x) → a plain object, else null. Pure.
function _obj(x) {
  return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null;
}

// _arr(x) → a shallow copy of an array, else []. Pure.
function _arr(x) {
  return Array.isArray(x) ? x.slice() : [];
}

// buildMvpRcGate(inputs) → a plain, JSON-serialisable RC-gate verdict. All inputs are plain
// data the CLI gathers from the existing pure modules:
//   mvpReadiness     a runMvpReadiness() rollup { ok, mvpPct, status, signals[], reasons[],
//                    nextSafeTask:{title,why,kind}, currentVersion, ... } or null/garbled
//   releaseReadiness a buildReleaseReadiness() summary { status, statusLabel, ready, blockers[],
//                    unknowns[], signals{}, version, gitCommit, ... } or null/garbled
//   handoff          OPTIONAL buildHandoffSummary() brief — used only as a next-task fallback
//                    and a version cross-read; never required
//   generatedAt      OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                    reproducible tests; the CLI passes a real stamp at print time
//
// Verdict logic (honest, never over-claims):
//   - hard blockers  = release.blockers (required signals failing) ∪ mvp signals failing when
//                      TWO OR MORE are short (mvp.status 'ATTENTION'); a single mvp miss is a
//                      NEAR, not a hard block.
//   - BLOCKED  iff there is any hard blocker (or inputs are missing → honest BLOCKED).
//   - READY    iff release.ready AND mvp.ok AND no release unknowns (nothing left unchecked).
//   - NEAR     otherwise (one short, or a required signal not checked this pass).
//   - rcPct    = share of the composed underlying signals that are ok (mvp signals + the five
//                required release signals), 0..100 — a concrete blended percentage.
export function buildMvpRcGate({
  mvpReadiness = null, releaseReadiness = null, handoff = null, generatedAt = null,
} = {}) {
  const stamp = _str(generatedAt);
  const mvp = _obj(mvpReadiness);
  const rel = _obj(releaseReadiness);
  const ho = _obj(handoff);

  // --- MVP rollup extraction (honest UNKNOWN when absent) ---
  const mvpSignals = mvp ? _arr(mvp.signals).filter((s) => _obj(s)) : [];
  const mvpFails = mvpSignals.filter((s) => s.status !== 'ok');
  const mvpOk = mvp ? mvp.ok === true : false;
  const mvpPct = mvp ? _int(mvp.mvpPct) : null;
  const mvpStatus = mvp ? (_str(mvp.status) || 'UNKNOWN') : 'UNKNOWN';

  // --- Release-readiness extraction (honest UNKNOWN when absent) ---
  const relBlockers = rel ? _arr(rel.blockers).map(String) : [];
  const relUnknowns = rel ? _arr(rel.unknowns).map(String) : [];
  const relReady = rel ? rel.ready === true : false;
  const relStatus = rel ? (_str(rel.status) || 'unknown') : 'unknown';
  const relStatusLabel = rel ? (_str(rel.statusLabel) || 'UNKNOWN') : 'NO RELEASE SUMMARY';

  // The five REQUIRED release signals (bundle is advisory and never counted). Mirrors
  // releaseReadiness.buildReleaseReadiness so the rcPct denominator stays honest.
  const relSig = rel ? _obj(rel.signals) || {} : {};
  const requiredKeys = ['versionSync', 'tests', 'regression', 'zoneFallback', 'docs'];
  const relRequired = requiredKeys.map((k) => ({ key: k, sig: _obj(relSig[k]) }));
  const relRequiredOk = relRequired.filter((r) => r.sig && r.sig.state === 'ok').length;

  // --- Blended RC percentage over the composed underlying signals ---
  const totalSignals = mvpSignals.length + requiredKeys.length;
  const okSignals = (mvpSignals.length - mvpFails.length) + relRequiredOk;
  const rcPct = totalSignals === 0 ? 0 : Math.round((okSignals / totalSignals) * 100);

  // --- Hard blockers vs. near-misses ---
  // A single short MVP signal is a NEAR (one fixable miss); two or more is a hard block.
  const mvpHardBlock = mvpFails.length >= 2;
  const hasInputs = !!(mvp || rel);
  const hardBlocked = !hasInputs || relBlockers.length > 0 || mvpHardBlock;

  // Reasons keeping the build from a clean RC. For BLOCKED these are the blockers; for NEAR
  // the near-misses + anything not checked this pass; for READY this is empty.
  const reasons = [];
  if (!hasInputs) reasons.push('inputs missing — no MVP rollup and no release summary supplied');
  for (const k of relBlockers) reasons.push(`release:${k}`);
  for (const s of mvpFails) reasons.push(`mvp:${s.key}: ${_str(s.detail) || 'failed'}`);
  for (const k of relUnknowns) reasons.push(`release:${k} (not checked this pass)`);

  let status;
  if (hardBlocked) status = 'BLOCKED';
  else if (relReady && mvpOk && relUnknowns.length === 0) status = 'READY';
  else status = 'NEAR';

  // Next one or two SAFE tasks. When something is keeping it from READY, the first task is to
  // clear the top reason; the recommended safe slice (from the MVP rollup, or the handoff
  // brief as a fallback) always follows. Deduped + capped at two.
  const safeTask = (mvp && _obj(mvp.nextSafeTask) && _str(mvp.nextSafeTask.title))
    || (ho && _str(ho.nextSafeTask))
    || 'Continue the safe no-blocker infra/tooling/docs cadence; live runtime / Nostr writes stay gated behind SEC-1/2/3.';
  const nextTasks = [];
  if (reasons.length) nextTasks.push(`Clear top blocker: ${reasons[0]}`);
  nextTasks.push(safeTask);
  const dedupedNextTasks = nextTasks.filter((t, i) => nextTasks.indexOf(t) === i).slice(0, 2);

  const version = (mvp && _str(mvp.currentVersion))
    || (rel && _str(rel.version))
    || (ho && _str(ho.version))
    || null;
  const gitCommit = (rel && _str(rel.gitCommit)) || (ho && _str(ho.gitCommit)) || null;

  return {
    schema: MVP_RC_GATE_SCHEMA,
    schemaVersion: MVP_RC_GATE_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: MVP_RC_GATE_BADGE,
    gateCommand: MVP_RC_GATE_COMMAND,
    version,
    gitCommit,
    status,
    isCandidate: status === 'READY',
    pct: rcPct,
    reasons,
    nextTasks: dedupedNextTasks,
    components: {
      mvpReadiness: { present: !!mvp, ok: mvpOk, pct: mvpPct, status: mvpStatus, fails: mvpFails.length },
      releaseReadiness: {
        present: !!rel, ready: relReady, status: relStatus, statusLabel: relStatusLabel,
        blockers: relBlockers.slice(), unknowns: relUnknowns.slice(),
        requiredOk: relRequiredOk, requiredTotal: requiredKeys.length,
      },
    },
    // Observed safety posture — all false in every run (the gate only READS verdicts; it
    // serves/deploys/publishes/navigates/writes/tags/releases nothing).
    safety: {
      served: false, deployed: false, published: false, navigated: false,
      released: false, tagged: false, wrote: false, network: false,
    },
    rendered: false,
    actionable: false,
  };
}

// _statusGlyph(status) → a stable glyph per RC verdict. Pure.
function _statusGlyph(status) {
  if (status === 'READY') return '✓';
  if (status === 'NEAR') return '○';
  return '✗';
}

// formatMvpRcGate(gate) → a concise multi-line text block for the terminal. Pure; null-safe.
export function formatMvpRcGate(gate) {
  const g = _obj(gate);
  if (!g) return 'mvp-rc-gate: (no verdict)';
  const c = _obj(g.components) || {};
  const mvp = _obj(c.mvpReadiness) || {};
  const rel = _obj(c.releaseReadiness) || {};
  const L = [];
  L.push('Torii Quest — MVP release-candidate gate');
  L.push('─'.repeat(60));
  L.push(`${g.badge}`);
  if (g.generatedAt) L.push(`generated: ${g.generatedAt}`);
  L.push(`verdict: ${_statusGlyph(g.status)} ${g.status}  ·  ${g.pct}%  ·  ${g.version ?? '(unknown)'}${g.gitCommit ? ` @ ${g.gitCommit}` : ''}`);
  L.push(`release candidate: ${g.isCandidate ? 'YES' : 'NO'}`);
  L.push('');
  L.push(`  MVP rollup:     ${mvp.present ? `${mvp.pct ?? '?'}% · ${mvp.status} (${mvp.fails} short)` : '(not supplied)'}`);
  L.push(`  Release ready:  ${rel.present ? `${rel.statusLabel} (${rel.requiredOk}/${rel.requiredTotal} required ok)` : '(not supplied)'}`);
  L.push('');
  if (Array.isArray(g.reasons) && g.reasons.length) {
    L.push('blocking / open reasons:');
    for (const r of g.reasons) L.push(`  • ${r}`);
  } else {
    L.push('blocking / open reasons: (none — clean RC)');
  }
  L.push('');
  L.push('next safe task(s):');
  for (const t of (Array.isArray(g.nextTasks) ? g.nextTasks : [])) L.push(`  ▸ ${t}`);
  L.push('');
  L.push(`full release gate: ${g.gateCommand}`);
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatMvpRcGateMarkdown(gate) → a markdown brief suitable for a handoff doc. Pure; null-safe.
export function formatMvpRcGateMarkdown(gate) {
  const g = _obj(gate);
  if (!g) return '# MVP release-candidate gate\n\n_(no verdict)_\n';
  const c = _obj(g.components) || {};
  const mvp = _obj(c.mvpReadiness) || {};
  const rel = _obj(c.releaseReadiness) || {};
  const L = [];
  L.push('# Torii Quest — MVP release-candidate gate');
  L.push('');
  L.push(`> ${g.badge}`);
  if (g.generatedAt) L.push(`> generated: ${g.generatedAt}`);
  L.push('');
  L.push(`- **Verdict:** ${g.status} (${g.pct}%)`);
  L.push(`- **Release candidate:** ${g.isCandidate ? 'YES' : 'NO'}`);
  L.push(`- **Version:** ${g.version ?? '(unknown)'}${g.gitCommit ? ` @ ${g.gitCommit}` : ''}`);
  L.push(`- **MVP rollup:** ${mvp.present ? `${mvp.pct ?? '?'}% · ${mvp.status} (${mvp.fails} short)` : '(not supplied)'}`);
  L.push(`- **Release readiness:** ${rel.present ? `${rel.statusLabel} (${rel.requiredOk}/${rel.requiredTotal} required ok)` : '(not supplied)'}`);
  L.push('');
  L.push('## Blocking / open reasons');
  L.push('');
  if (Array.isArray(g.reasons) && g.reasons.length) {
    for (const r of g.reasons) L.push(`- ${r}`);
  } else {
    L.push('_(none — clean RC)_');
  }
  L.push('');
  L.push('## Next safe task(s)');
  L.push('');
  for (const t of (Array.isArray(g.nextTasks) ? g.nextTasks : [])) L.push(`- ${t}`);
  L.push('');
  L.push(`_Full release gate:_ \`${g.gateCommand}\``);
  L.push('');
  return L.join('\n');
}
