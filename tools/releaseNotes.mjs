// tools/releaseNotes.mjs — PURE, node-safe MVP-PROOF RELEASE-NOTES DRAFT assembly + formatting
// (v0.2.202). Produces a DRAFT release-notes document for the first MVP proof-of-concept
// candidate. It explains concisely WHAT has been built — the shooter proof loop, the Nostr
// read/profile/leaderboard proof surfaces, the gateway-travel shell, the update/VPS readiness,
// the Continuum dashboard, the SDK/debug handoff surfaces, the tests/guardrails, and the known
// non-blocking advisories — and stamps the current candidate verdict by FOLDING the already-
// computed local readiness signals (the MVP-readiness rollup + the release-candidate gate +
// the handoff brief). It re-derives no check.
//
// DRAFT ONLY: this assembles text. It creates NO GitHub release, NO git tag, NO public
// announcement, and reaches NO network/server. Pure + deterministic: NO fs, NO network, NO
// child_process, NO process in here. The CLI (tools/release-notes.mjs) does the fs/git I/O and
// hands plain verdicts to these helpers, so the assembly/formatting is unit-testable
// (tests/release-notes.test.js). Null/garbled inputs degrade to honest UNKNOWNs; never throws.

// Shared, non-misleading wording for the stamped source commit (this draft is generated
// before its own commit — see tools/commitStamp.mjs).
import { sourceCommitInline } from './commitStamp.mjs';

// Stable schema id + integer version for the machine-readable (--json) mode. Bump
// RELEASE_NOTES_SCHEMA_VERSION on any breaking shape change.
export const RELEASE_NOTES_SCHEMA = 'torii.release-notes';
export const RELEASE_NOTES_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only DRAFT — never a release/tag/publish action.
export const RELEASE_NOTES_BADGE = 'MVP PROOF RELEASE NOTES · DRAFT · LOCAL · READ-ONLY';

// Default in-repo filename for the opt-in --write markdown draft.
export const RELEASE_NOTES_WRITE_FILENAME = 'RELEASE_NOTES_DRAFT.md';

// The product title shown atop the notes.
export const RELEASE_NOTES_TITLE = 'Torii Quest — MVP Proof-of-Concept';

// The curated "what's built" sections — the stable, hand-maintained narrative of the MVP proof
// surfaces. Frozen so a consumer can rely on the order; each entry is { heading, items[] }.
// This is the only narrative the notes carry that is NOT folded from a live signal — it
// describes the shipped proof loop and is updated by hand as the MVP grows.
export const RELEASE_NOTES_SECTIONS = Object.freeze([
  Object.freeze({
    heading: 'Shooter proof loop',
    items: Object.freeze([
      'A playable first-person arena proof: pointer-lock controls, ESC instant-pause, and a kill-feed HUD.',
      'Rapier3D physics-backed movement and projectile resolution in a bounded test arena.',
      'Panel-locked cursor clicks never fire the weapon — pause/menu interaction is fire-safe.',
    ]),
  }),
  Object.freeze({
    heading: 'Nostr read / profile / leaderboard proof surfaces',
    items: Object.freeze([
      'Read-only Nostr surfaces: live read health, profile lookup, and a leaderboard proof view.',
      'Signed login, character publication, the presence beacon and Kami ema are implemented here; other write paths stay gated behind review.',
      'A nostrich-friendly relay read path with bounded WS handling.',
    ]),
  }),
  Object.freeze({
    heading: 'Gateway travel shell',
    items: Object.freeze([
      'A gateway/portal travel shell that routes between zones with a /zone/* fallback.',
      'Host-route and gateway-travel smoke harnesses confirm the shell resolves without a live server.',
    ]),
  }),
  Object.freeze({
    heading: 'Update / VPS readiness',
    items: Object.freeze([
      'An update-flow smoke harness and a VPS dry-run that validate deploy readiness locally.',
      'No live updater, DNS, SSH, or server action runs in this proof — all checks are read-only.',
    ]),
  }),
  Object.freeze({
    heading: 'Continuum dashboard',
    items: Object.freeze([
      'A generated Continuum dashboard surfacing version, test status, active slices, and recent work.',
      'Built from progress.md and the status rollups; regenerated as part of the build.',
    ]),
  }),
  Object.freeze({
    heading: 'SDK / debug handoff surfaces',
    items: Object.freeze([
      'A ToriiDebug shell + SDK status surfaces, shipped unconditionally for inspection.',
      'Local handoff exports (handoff summary, agent handoff, MVP release-candidate gate) let a next agent continue without reading the whole repo.',
    ]),
  }),
  Object.freeze({
    heading: 'Tests / guardrails',
    items: Object.freeze([
      'A full Vitest unit suite over the pure helpers and contracts.',
      'A static + runtime regression gate (npm run check) and a release gate (npm run test:release).',
      'Version-sync, zone-fallback, docs-consistency, and bundle-baseline guardrails.',
    ]),
  }),
]);

// The known, non-blocking advisories that ride along with the proof (never gate a release).
export const RELEASE_NOTES_ADVISORIES = Object.freeze([
  'The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).',
  'SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).',
  'This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.',
]);

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

// buildReleaseNotesModel(inputs) → a plain, JSON-serialisable release-notes DRAFT model. All
// inputs are plain data the CLI gathers from the existing pure modules:
//   rcGate        a buildMvpRcGate() verdict { status, isCandidate, pct, reasons[], version,
//                 gitCommit, ... } or null/garbled — drives the candidate line
//   mvpReadiness  a runMvpReadiness() rollup { mvpPct, status, currentVersion, signals[] } or
//                 null/garbled — drives the readiness summary
//   handoff       OPTIONAL buildHandoffSummary() brief — version cross-read + report fallback
//   version       config.js VERSION (e.g. 'v0.2.202-alpha'); falls back to the rollup/gate/handoff
//   gitCommit     short commit string, or null
//   liveUrl       display URL for the live instance (NOT fetched)
//   reports       OPTIONAL string[] of recent report names (defaults to handoff.latestReports)
//   generatedAt   OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                 reproducible tests; the CLI passes a real stamp at print time.
export function buildReleaseNotesModel({
  rcGate = null, mvpReadiness = null, handoff = null,
  version = null, gitCommit = null, liveUrl = null, reports = null, generatedAt = null,
} = {}) {
  const stamp = _str(generatedAt);
  const gate = _obj(rcGate);
  const mvp = _obj(mvpReadiness);
  const ho = _obj(handoff);

  const resolvedVersion = _str(version)
    || (mvp && _str(mvp.currentVersion))
    || (gate && _str(gate.version))
    || (ho && _str(ho.version))
    || null;
  const resolvedCommit = _str(gitCommit)
    || (gate && _str(gate.gitCommit))
    || (ho && _str(ho.gitCommit))
    || null;

  // Candidate verdict (folded from the RC gate; honest UNKNOWN when absent).
  const candidate = {
    present: !!gate,
    status: gate ? (_str(gate.status) || 'UNKNOWN') : 'UNKNOWN',
    isCandidate: gate ? gate.isCandidate === true : false,
    pct: gate ? _int(gate.pct) : null,
    reasons: gate ? _arr(gate.reasons).map(String) : [],
  };

  // Readiness summary (folded from the MVP rollup; honest UNKNOWN when absent).
  const readiness = {
    present: !!mvp,
    pct: mvp ? _int(mvp.mvpPct) : null,
    status: mvp ? (_str(mvp.status) || 'UNKNOWN') : 'UNKNOWN',
    ok: mvp ? mvp.ok === true : false,
  };

  const latestReports = _arr(reports).map(String).filter(Boolean);
  const resolvedReports = latestReports.length
    ? latestReports
    : (ho ? _arr(ho.latestReports).map(String).filter(Boolean) : []);

  return {
    schema: RELEASE_NOTES_SCHEMA,
    schemaVersion: RELEASE_NOTES_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: RELEASE_NOTES_BADGE,
    title: RELEASE_NOTES_TITLE,
    draft: true,
    version: resolvedVersion,
    gitCommit: resolvedCommit,
    liveUrl: _str(liveUrl),
    candidate,
    readiness,
    sections: RELEASE_NOTES_SECTIONS.map((s) => ({
      heading: s.heading, items: s.items.slice(),
    })),
    advisories: RELEASE_NOTES_ADVISORIES.slice(),
    latestReports: resolvedReports,
    // Observed safety posture — all false in every run (the draft only ASSEMBLES text; it
    // releases/tags/publishes/announces/serves/navigates/writes/networks nothing).
    safety: {
      released: false, tagged: false, published: false, announced: false,
      served: false, navigated: false, wrote: false, network: false,
    },
    rendered: false,
    actionable: false,
  };
}

// formatReleaseNotes(model) → a concise multi-line text block for the terminal. Pure; null-safe.
export function formatReleaseNotes(model) {
  const m = _obj(model);
  if (!m) return 'release-notes: (no draft)';
  const cand = _obj(m.candidate) || {};
  const rd = _obj(m.readiness) || {};
  const L = [];
  L.push(`${m.title} — release notes (DRAFT)`);
  L.push('─'.repeat(60));
  L.push(`${m.badge}`);
  if (m.generatedAt) L.push(`generated: ${m.generatedAt}`);
  L.push(`version: ${m.version ?? '(unknown)'}${sourceCommitInline(m.gitCommit)}`);
  if (m.liveUrl) L.push(`live: ${m.liveUrl}`);
  L.push(`candidate: ${cand.isCandidate ? 'YES' : 'NO'}  ·  ${cand.status}${cand.pct != null ? ` (${cand.pct}%)` : ''}`);
  L.push(`MVP readiness: ${rd.present ? `${rd.pct ?? '?'}% · ${rd.status}` : '(not supplied)'}`);
  L.push('');
  L.push('What has been built:');
  for (const s of (Array.isArray(m.sections) ? m.sections : [])) {
    L.push(`  ${s.heading}:`);
    for (const it of (Array.isArray(s.items) ? s.items : [])) L.push(`    • ${it}`);
  }
  L.push('');
  L.push('Known non-blocking advisories:');
  for (const a of (Array.isArray(m.advisories) ? m.advisories : [])) L.push(`  • ${a}`);
  if (Array.isArray(m.latestReports) && m.latestReports.length) {
    L.push('');
    L.push('Recent reports:');
    for (const r of m.latestReports) L.push(`  • ${r}`);
  }
  L.push('');
  L.push('DRAFT ONLY — no GitHub release, no tag, no announcement, no network.');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatReleaseNotesMarkdown(model) → a markdown draft suitable for RELEASE_NOTES_DRAFT.md.
// Pure; null-safe.
export function formatReleaseNotesMarkdown(model) {
  const m = _obj(model);
  if (!m) return '# Release notes (draft)\n\n_(no draft)_\n';
  const cand = _obj(m.candidate) || {};
  const rd = _obj(m.readiness) || {};
  const L = [];
  L.push(`# ${m.title} — Release Notes (DRAFT)`);
  L.push('');
  L.push(`> ${m.badge}`);
  if (m.generatedAt) L.push(`> generated: ${m.generatedAt}`);
  L.push('');
  L.push(`- **Version:** ${m.version ?? '(unknown)'}${sourceCommitInline(m.gitCommit)}`);
  if (m.liveUrl) L.push(`- **Live:** ${m.liveUrl}`);
  L.push(`- **Release candidate:** ${cand.isCandidate ? 'YES' : 'NO'} (${cand.status}${cand.pct != null ? `, ${cand.pct}%` : ''})`);
  L.push(`- **MVP readiness:** ${rd.present ? `${rd.pct ?? '?'}% · ${rd.status}` : '(not supplied)'}`);
  L.push('');
  L.push('## What has been built');
  L.push('');
  for (const s of (Array.isArray(m.sections) ? m.sections : [])) {
    L.push(`### ${s.heading}`);
    L.push('');
    for (const it of (Array.isArray(s.items) ? s.items : [])) L.push(`- ${it}`);
    L.push('');
  }
  L.push('## Known non-blocking advisories');
  L.push('');
  for (const a of (Array.isArray(m.advisories) ? m.advisories : [])) L.push(`- ${a}`);
  L.push('');
  if (Array.isArray(m.latestReports) && m.latestReports.length) {
    L.push('## Recent reports');
    L.push('');
    for (const r of m.latestReports) L.push(`- ${r}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('_DRAFT ONLY — this document creates no GitHub release, no git tag, no public ' +
    'announcement, and reaches no network. The parent agent owns security review, deploy, ' +
    'publish, push, and Space upload._');
  L.push('');
  return L.join('\n');
}
