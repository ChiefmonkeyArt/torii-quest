// tools/agentHandoff.mjs — PURE, node-safe AGENT HANDOFF READINESS assembly + formatting
// (v0.2.199). Folds the EXISTING local status signals a NEXT agent — including non-Perplexity
// tools (DeepSeek / Perplexica / Routstr-style handoffs) — needs to continue the safe MVP
// pipeline WITHOUT reading the entire repo: current version, live URL, the gate verdict, test
// counts, the latest reports, the standing hard constraints, the recommended next SAFE task,
// the pure smoke-harness inventory, and the v0.2.198 MVP-readiness rollup (pct + status).
//
// This is a SUPERSET view layered on the v0.2.190 handoff auto-summary: it COMPOSES an existing
// buildHandoffSummary() brief (passed in) and an existing runMvpReadiness() rollup (passed in)
// rather than re-deriving either — it adds only the smoke-harness inventory + the readiness
// pct/status the base summary lacks. Build-time only; never imported by the game.
//
// Pure + deterministic: NO fs, NO network, NO child_process, NO process in here. The CLI
// (tools/agent-handoff.mjs) does the fs/git I/O — it runs gatherReleaseReadiness(),
// buildHandoffSummary(), and runMvpReadiness() — and hands plain inputs to these helpers, so the
// assembly/formatting is fully unit-testable (tests/agent-handoff.test.js). The --write target
// confinement reuses resolveHandoffWritePath() from handoffSummary.mjs (no second boundary).

// Badge naming the export as read-only oversight, never a deploy/publish/upload action.
export const AGENT_HANDOFF_BADGE = 'AGENT HANDOFF READINESS · LOCAL · READ-ONLY';

// Stable schema id + integer version for the machine-readable mode. Bump on a breaking shape
// change.
export const AGENT_HANDOFF_SCHEMA = 'torii.agent-handoff';
export const AGENT_HANDOFF_SCHEMA_VERSION = 1;

// Default in-repo filename for the opt-in --write export. The curated HANDOFF.md is NEVER
// replaced — this generated artifact sits beside it so a fresh agent can act immediately while
// the human-authored handoff stays the source of truth.
export const AGENT_HANDOFF_WRITE_FILENAME = 'HANDOFF.generated.md';

// SMOKE_HARNESSES — the pure, read-only smoke/health harness inventory a next agent can run with
// no network to confirm posture. Each entry maps the shipped module to its SDK namespace, debug
// shell, the MVP-readiness signal key it backs (or null for the rollup itself), and a one-line
// purpose. Curated + frozen; buildAgentHandoff attaches the live pass/fail from the readiness
// rollup signals by `signalKey`.
export const SMOKE_HARNESSES = Object.freeze([
  Object.freeze({
    key: 'readHealth', sdk: 'SDK.readHealth', shell: 'shells.readHealth(o?)',
    signalKey: 'nostr-read-health',
    purpose: 'Nostr read-path health proof over a deterministic local sample (no relay I/O).',
  }),
  Object.freeze({
    key: 'gatewayTravelSmoke', sdk: 'SDK.gatewayTravelSmoke', shell: 'shells.travelSmoke(o?)',
    signalKey: 'gateway-travel-smoke',
    purpose: 'Gateway travel-contract smoke (dry-run boundary; never navigates).',
  }),
  Object.freeze({
    key: 'updateFlowSmoke', sdk: 'SDK.updateFlowSmoke', shell: 'shells.updateFlowSmoke(o?)',
    signalKey: 'update-flow-smoke',
    purpose: 'Update-flow contract smoke over frozen fixtures (manual-only; never fetches/installs).',
  }),
  Object.freeze({
    key: 'hostRouteSmoke', sdk: 'SDK.hostRouteSmoke', shell: 'shells.hostRouteSmoke(o?)',
    signalKey: 'host-route-smoke',
    purpose: 'Static-host route + asset readiness smoke (no server/DNS/SSH/network).',
  }),
  Object.freeze({
    key: 'mvpReadiness', sdk: 'SDK.mvpReadiness', shell: 'shells.mvpReadiness(o?)',
    signalKey: null,
    purpose: 'MVP release-readiness rollup folding the harnesses into one pct + status.',
  }),
]);

// _str(x) → trimmed string or null. _int(x) → integer or null. Defensive helpers; never throw.
function _str(x) { return typeof x === 'string' && x.trim() ? x.trim() : null; }
function _int(x) { return Number.isInteger(x) ? x : null; }

// buildAgentHandoff(inputs) → a plain, JSON-serialisable agent-handoff export. All inputs are
// plain data supplied by the CLI:
//   handoffSummary  a buildHandoffSummary() brief, or null/garbled → degrades to honest 'unknown'
//   mvpReadiness    a runMvpReadiness() rollup, or null/garbled → readiness 'unknown'
//   smokeHarnesses  override for SMOKE_HARNESSES (optional)
//   generatedAt     OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                   reproducible tests; the CLI passes a real stamp at print time.
export function buildAgentHandoff({
  handoffSummary = null, mvpReadiness = null,
  smokeHarnesses = SMOKE_HARNESSES, generatedAt = null,
} = {}) {
  const stamp = _str(generatedAt);
  const hs = handoffSummary && typeof handoffSummary === 'object' && !Array.isArray(handoffSummary)
    ? handoffSummary : null;
  const mvp = mvpReadiness && typeof mvpReadiness === 'object' && !Array.isArray(mvpReadiness)
    ? mvpReadiness : null;
  const gate = (hs && hs.gate && typeof hs.gate === 'object') ? hs.gate : {};

  // readiness: the MVP rollup pct/status, degraded honestly when absent.
  const mvpSignals = (mvp && Array.isArray(mvp.signals)) ? mvp.signals : [];
  const signalByKey = new Map();
  for (const s of mvpSignals) {
    if (s && typeof s === 'object' && _str(s.key)) signalByKey.set(s.key, s);
  }
  const readiness = {
    pct: mvp ? _int(mvp.mvpPct) : null,
    status: mvp ? (_str(mvp.status) || 'UNKNOWN') : 'UNKNOWN',
    ok: !!(mvp && mvp.ok),
    summary: {
      total: mvp && mvp.summary ? _int(mvp.summary.total) : null,
      ok: mvp && mvp.summary ? _int(mvp.summary.ok) : null,
      fail: mvp && mvp.summary ? _int(mvp.summary.fail) : null,
    },
    reasons: mvp && Array.isArray(mvp.reasons) ? mvp.reasons.slice() : [],
  };

  // harnesses: the curated inventory, each annotated with its live pass/fail from the rollup.
  const inv = Array.isArray(smokeHarnesses) ? smokeHarnesses : SMOKE_HARNESSES;
  const harnesses = inv.map((h) => {
    const sig = h && h.signalKey ? signalByKey.get(h.signalKey) : null;
    return {
      key: h ? (_str(h.key) || null) : null,
      sdk: h ? (_str(h.sdk) || null) : null,
      shell: h ? (_str(h.shell) || null) : null,
      purpose: h ? (_str(h.purpose) || null) : null,
      signalKey: h ? (_str(h.signalKey) || null) : null,
      status: sig ? (_str(sig.status) || null) : null,
    };
  });

  // nextSafeTask: prefer the rollup's structured task; fall back to the summary's string.
  const mvpTask = (mvp && mvp.nextSafeTask && typeof mvp.nextSafeTask === 'object')
    ? mvp.nextSafeTask : null;
  const nextSafeTask = mvpTask
    ? { title: _str(mvpTask.title), why: _str(mvpTask.why), kind: _str(mvpTask.kind) }
    : { title: hs ? _str(hs.nextSafeTask) : null, why: null, kind: null };

  return {
    schema: AGENT_HANDOFF_SCHEMA,
    schemaVersion: AGENT_HANDOFF_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: AGENT_HANDOFF_BADGE,
    version: hs ? _str(hs.version) : (mvp ? _str(mvp.currentVersion) : null),
    packageVersion: hs ? _str(hs.packageVersion) : null,
    gitCommit: hs ? _str(hs.gitCommit) : null,
    liveUrl: hs ? _str(hs.liveUrl) : null,
    gate: {
      statusLabel: _str(gate.statusLabel) || 'UNKNOWN',
      ready: !!gate.ready,
      gateCommand: _str(gate.gateCommand) || 'npm run test:release',
      blockers: Array.isArray(gate.blockers) ? gate.blockers.slice() : [],
      regression: {
        count: gate.regression ? _int(gate.regression.count) : null,
        expected: gate.regression ? _int(gate.regression.expected) : null,
      },
      testProfiles: {
        fast: gate.testProfiles ? _int(gate.testProfiles.fast) : null,
        foundation: gate.testProfiles ? _int(gate.testProfiles.foundation) : null,
      },
    },
    readiness,
    harnesses,
    nextSafeTask,
    constraints: hs && Array.isArray(hs.constraints) ? hs.constraints.slice() : [],
    verifyCommands: hs && Array.isArray(hs.verifyCommands)
      ? hs.verifyCommands.map((c) => ({ cmd: _str(c.cmd), desc: _str(c.desc) })) : [],
    latestReports: hs && Array.isArray(hs.latestReports) ? hs.latestReports.slice() : [],
  };
}

// formatAgentHandoff(handoff) → a concise multi-line text block for the terminal. Pure.
export function formatAgentHandoff(handoff) {
  if (!handoff || typeof handoff !== 'object') return 'agent-handoff: (no handoff)';
  const g = handoff.gate || {};
  const r = handoff.readiness || {};
  const L = [];
  L.push('Torii Quest — agent handoff readiness');
  L.push('─'.repeat(60));
  L.push(`${handoff.badge}`);
  if (handoff.generatedAt) L.push(`generated: ${handoff.generatedAt}`);
  L.push(`version:   ${handoff.version ?? '(unknown)'}  (pkg ${handoff.packageVersion ?? '?'})  @ ${handoff.gitCommit ?? 'no-git'}`);
  L.push(`live (manual deploy): ${handoff.liveUrl ?? '(unknown)'}`);
  L.push('');
  L.push(`MVP readiness: ${r.pct ?? '?'}% · ${r.status ?? 'UNKNOWN'}  (${r.summary?.ok ?? '?'}/${r.summary?.total ?? '?'} signals)`);
  if (r.reasons && r.reasons.length) L.push(`  attention: ${r.reasons.join('; ')}`);
  L.push(`gate verdict: ${g.statusLabel ?? 'UNKNOWN'}${g.ready ? '  ✓ READY' : ''}`);
  if (g.blockers && g.blockers.length) L.push(`  blockers: ${g.blockers.join(', ')}`);
  const reg = g.regression || {};
  L.push(`  regression: ${reg.count ?? '?'}/${reg.expected ?? '?'} checks`);
  const tp = g.testProfiles || {};
  L.push(`  test profiles: fast ${tp.fast ?? '?'} · foundation ${tp.foundation ?? '?'} file(s)`);
  L.push('');
  L.push('smoke harnesses (pure · read-only · no network):');
  for (const h of handoff.harnesses ?? []) {
    const mark = h.status === 'ok' ? '✓' : (h.status ? '✗' : '·');
    L.push(`  ${mark} ${h.shell ?? h.key}  ${h.purpose ?? ''}`);
  }
  L.push('');
  const t = handoff.nextSafeTask || {};
  L.push(`next safe task: ${t.title ?? '(none)'}`);
  if (t.why) L.push(`  why: ${t.why}`);
  L.push('');
  L.push('key constraints:');
  for (const c of handoff.constraints ?? []) L.push(`  • ${c}`);
  L.push('');
  L.push('verify before ship (local, no network):');
  for (const c of handoff.verifyCommands ?? []) L.push(`  ${(c.cmd ?? '').padEnd(22)} ${c.desc ?? ''}`);
  L.push('');
  L.push(handoff.latestReports && handoff.latestReports.length
    ? `latest reports: ${handoff.latestReports.join(', ')}`
    : 'latest reports: (none found)');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatAgentHandoffMarkdown(handoff) → a markdown export suitable for HANDOFF.generated.md.
// Pure. This is the artifact a non-Perplexity agent reads to continue without the whole repo.
export function formatAgentHandoffMarkdown(handoff) {
  if (!handoff || typeof handoff !== 'object') return '# Agent handoff\n\n_(no handoff)_\n';
  const g = handoff.gate || {};
  const r = handoff.readiness || {};
  const reg = g.regression || {};
  const tp = g.testProfiles || {};
  const t = handoff.nextSafeTask || {};
  const L = [];
  L.push('# Torii Quest — agent handoff readiness (generated)');
  L.push('');
  L.push(`> ${handoff.badge}`);
  L.push('> Generated artifact — do NOT hand-edit. The curated `HANDOFF.md` stays the source of truth.');
  if (handoff.generatedAt) L.push(`> generated: ${handoff.generatedAt}`);
  L.push('');
  L.push(`- **Version:** ${handoff.version ?? '(unknown)'} (pkg ${handoff.packageVersion ?? '?'})`);
  L.push(`- **Git commit:** ${handoff.gitCommit ?? '(unavailable)'}`);
  L.push(`- **Live (manual deploy):** ${handoff.liveUrl ?? '(unknown)'}`);
  L.push(`- **MVP readiness:** ${r.pct ?? '?'}% · ${r.status ?? 'UNKNOWN'} (${r.summary?.ok ?? '?'}/${r.summary?.total ?? '?'} signals)`);
  if (r.reasons && r.reasons.length) L.push(`  - attention: ${r.reasons.join('; ')}`);
  L.push(`- **Gate verdict:** ${g.statusLabel ?? 'UNKNOWN'}${g.ready ? ' (READY)' : ''}`);
  if (g.blockers && g.blockers.length) L.push(`  - blockers: ${g.blockers.join(', ')}`);
  L.push(`- **Regression:** ${reg.count ?? '?'} / ${reg.expected ?? '?'} checks`);
  L.push(`- **Test profiles:** fast ${tp.fast ?? '?'} · foundation ${tp.foundation ?? '?'} file(s)`);
  L.push('');
  L.push('## Smoke harnesses (pure · read-only · no network)');
  L.push('');
  L.push('| Harness | SDK | Debug shell | Status | Purpose |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const h of handoff.harnesses ?? []) {
    const st = h.status === 'ok' ? 'ok' : (h.status || 'n/a');
    L.push(`| ${h.key ?? '?'} | \`${h.sdk ?? '?'}\` | \`${h.shell ?? '?'}\` | ${st} | ${h.purpose ?? ''} |`);
  }
  L.push('');
  L.push('## Next safe task');
  L.push('');
  L.push(t.title ?? '_(none)_');
  if (t.why) { L.push(''); L.push(`_Why:_ ${t.why}`); }
  L.push('');
  L.push('## Key constraints');
  L.push('');
  for (const c of handoff.constraints ?? []) L.push(`- ${c}`);
  L.push('');
  L.push('## Verify before ship (local, no network)');
  L.push('');
  for (const c of handoff.verifyCommands ?? []) L.push(`- \`${c.cmd ?? ''}\` — ${c.desc ?? ''}`);
  L.push('');
  L.push('## Latest reports');
  L.push('');
  if (handoff.latestReports && handoff.latestReports.length) {
    for (const rep of handoff.latestReports) L.push(`- ${rep}`);
  } else {
    L.push('_(none found)_');
  }
  L.push('');
  return L.join('\n');
}
