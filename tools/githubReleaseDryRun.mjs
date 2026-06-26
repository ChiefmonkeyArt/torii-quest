// tools/githubReleaseDryRun.mjs — PURE, node-safe GITHUB MVP RELEASE DRY-RUN assembly +
// formatting. Folds the local, network-free prerequisites that WOULD need to be true before a
// human cuts a future GitHub MVP-proof release — version stamped + synced, clean working tree,
// HEAD pushed, release-notes draft present, release-package index present, the tests/RC gate
// green, a public live URL, and non-actionable (no autoUpdate) release metadata — into ONE
// verdict (READY / NEAR / BLOCKED) with the list of missing items and the suggested FUTURE manual
// commands as TEXT ONLY. It re-derives no check — it only ASSEMBLES a dry-run from plain data the
// CLI gathers.
//
// DRY-RUN ONLY: this assembles text. It creates NO git tag, NO GitHub release, NO push, NO deploy,
// NO publish, and reaches NO network/server. Every suggested command is INERT TEXT carrying an
// explicit "do not run without user approval" — nothing here executes. Pure + deterministic: NO
// fs, NO network, NO child_process, NO process in here. The CLI (tools/github-release-dry-run.mjs)
// does the read-only fs/git I/O and hands plain data to these helpers, so the assembly/formatting
// is unit-testable (tests/github-release-dry-run.test.js). Null/garbled inputs degrade to honest
// UNKNOWNs; never throws.

// Stable schema id + integer version for the machine-readable (--json) mode. Bump
// GITHUB_RELEASE_DRY_RUN_SCHEMA_VERSION on any breaking shape change.
export const GITHUB_RELEASE_DRY_RUN_SCHEMA = 'torii.github-release-dry-run';
export const GITHUB_RELEASE_DRY_RUN_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only DRY-RUN — never a tag/release/publish action.
export const GITHUB_RELEASE_DRY_RUN_BADGE =
  'GITHUB RELEASE DRY-RUN · LOCAL · READ-ONLY · NO TAG / NO RELEASE';

// Default in-repo filename for the opt-in --write markdown dry-run.
export const GITHUB_RELEASE_DRY_RUN_WRITE_FILENAME = 'GITHUB_RELEASE_DRY_RUN.md';

// The product title shown atop the dry-run.
export const GITHUB_RELEASE_DRY_RUN_TITLE = 'Torii Quest — GitHub MVP Release Dry-Run';

// The standing approval gate — a human MUST explicitly approve before ANY tag/release/publish.
// This is never satisfiable by the tool; it rides along with every verdict, including READY.
export const GITHUB_RELEASE_APPROVAL_GATE =
  'Manual user approval is REQUIRED before any git tag, git push --tags, gh release, or publish. ' +
  'A READY verdict means the local prerequisites are met — NOT that a release should be cut.';

// The curated prerequisite checks, in display order. Frozen so a consumer can rely on the order;
// each entry is { key, label, gating }. `gating` true → must be ok for READY (a 'blocked' state
// is a hard blocker); `gating` false → soft signal that, when not ok, holds the verdict at NEAR
// (e.g. a dirty tree or an unpushed HEAD — expected in this local pipeline before the parent
// agent pushes). The CLI resolves each key's state from plain read-only signals.
export const GITHUB_RELEASE_DRY_RUN_PREREQUISITES = Object.freeze([
  Object.freeze({ key: 'version', label: 'Current version stamped (config.js VERSION)', gating: true }),
  Object.freeze({ key: 'version-sync', label: 'config VERSION matches package.json', gating: true }),
  Object.freeze({ key: 'clean-tree', label: 'Working tree clean (all changes committed)', gating: false }),
  Object.freeze({ key: 'pushed', label: 'HEAD commit pushed to remote', gating: false }),
  Object.freeze({ key: 'release-notes', label: 'Release notes draft present (RELEASE_NOTES_DRAFT.md)', gating: true }),
  Object.freeze({ key: 'release-package', label: 'Release package index present (MVP_RELEASE_PACKAGE.md)', gating: true }),
  Object.freeze({ key: 'gate-ready', label: 'Tests + RC gate green (npm run test:release)', gating: true }),
  Object.freeze({ key: 'live-url', label: 'Public live URL known', gating: true }),
  Object.freeze({ key: 'no-auto-update', label: 'Release metadata non-actionable (no autoUpdate)', gating: true }),
]);

// The known, non-blocking advisories that ride along with the proof (never gate a release).
export const GITHUB_RELEASE_DRY_RUN_ADVISORIES = Object.freeze([
  'The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).',
  'SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).',
  'This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.',
]);

// _str(x) → trimmed non-empty string, else null. Pure.
function _str(x) {
  return (typeof x === 'string' && x.trim()) ? x.trim() : null;
}

// _obj(x) → a plain object, else null. Pure.
function _obj(x) {
  return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null;
}

// _arr(x) → a shallow copy of an array, else []. Pure.
function _arr(x) {
  return Array.isArray(x) ? x.slice() : [];
}

// _bool(x) → true/false if a real boolean, else null (unknown). Pure.
function _bool(x) {
  return x === true ? true : (x === false ? false : null);
}

// _resolveState(check, inputs) → { state, detail } for one prerequisite. Pure. States:
//   ok       — prerequisite satisfied
//   blocked  — prerequisite definitively NOT satisfied (a real blocker for a gating check)
//   pending  — soft signal not yet satisfied (e.g. tree dirty / HEAD not pushed) — holds at NEAR
//   unknown  — no signal supplied this pass (does not over-claim ready)
function _resolveState(key, i) {
  switch (key) {
    case 'version': {
      const v = _str(i.version);
      return v ? { state: 'ok', detail: v } : { state: 'blocked', detail: 'no VERSION found' };
    }
    case 'version-sync': {
      const v = _str(i.version);
      const p = _str(i.packageVersion);
      if (!v || !p) return { state: 'unknown', detail: 'version or package version missing' };
      const expected = `v${p}`;
      return v === expected
        ? { state: 'ok', detail: `${v} == ${expected}` }
        : { state: 'blocked', detail: `${v} != ${expected}` };
    }
    case 'clean-tree': {
      const c = _bool(i.cleanTree);
      if (c === true) return { state: 'ok', detail: 'no uncommitted changes' };
      if (c === false) return { state: 'pending', detail: 'uncommitted changes present' };
      return { state: 'unknown', detail: 'tree status not checked' };
    }
    case 'pushed': {
      const p = _bool(i.pushed);
      if (p === true) return { state: 'ok', detail: 'HEAD on remote' };
      if (p === false) return { state: 'pending', detail: 'HEAD not pushed (parent agent pushes)' };
      return { state: 'unknown', detail: 'push status not checked (no network)' };
    }
    case 'release-notes': {
      const present = _bool(i.releaseNotesPresent);
      if (present === true) return { state: 'ok', detail: 'RELEASE_NOTES_DRAFT.md present' };
      if (present === false) return { state: 'blocked', detail: 'RELEASE_NOTES_DRAFT.md missing' };
      return { state: 'unknown', detail: 'not checked' };
    }
    case 'release-package': {
      const present = _bool(i.releasePackagePresent);
      if (present === true) return { state: 'ok', detail: 'MVP_RELEASE_PACKAGE.md present' };
      if (present === false) return { state: 'blocked', detail: 'MVP_RELEASE_PACKAGE.md missing' };
      return { state: 'unknown', detail: 'not checked' };
    }
    case 'gate-ready': {
      const g = _bool(i.gateReady);
      if (g === true) return { state: 'ok', detail: 'gate reported green' };
      if (g === false) return { state: 'blocked', detail: 'gate not green' };
      return { state: 'unknown', detail: 'run npm run test:release to confirm' };
    }
    case 'live-url': {
      const u = _str(i.liveUrl);
      return u ? { state: 'ok', detail: u } : { state: 'blocked', detail: 'no live URL' };
    }
    case 'no-auto-update': {
      const a = _bool(i.autoUpdateActionable);
      if (a === false) return { state: 'ok', detail: 'metadata non-actionable' };
      if (a === true) return { state: 'blocked', detail: 'release metadata is actionable (autoUpdate)' };
      return { state: 'unknown', detail: 'release metadata not checked' };
    }
    default:
      return { state: 'unknown', detail: '' };
  }
}

// _futureCommands(version) → the suggested FUTURE manual commands as INERT TEXT. Each carries an
// explicit do-not-run note. These are NEVER executed by the tool — they document what a human
// WOULD run, after approval, to cut the release. Pure.
function _futureCommands(version) {
  const v = _str(version) || 'vX.Y.Z-alpha';
  return [
    { cmd: `git tag -a ${v} -m "Torii Quest ${v} (MVP proof)"`, note: 'annotate the release commit — DO NOT run without user approval' },
    { cmd: `git push origin ${v}`, note: 'publish the tag — DO NOT run without user approval' },
    { cmd: `gh release create ${v} --notes-file RELEASE_NOTES_DRAFT.md --title "Torii Quest ${v}"`, note: 'create the GitHub release — DO NOT run without user approval' },
  ];
}

// buildGithubReleaseDryRunModel(inputs) → a plain, JSON-serialisable dry-run model. All inputs
// are plain data the CLI gathers (read-only):
//   version              config.js VERSION (a 'vX.Y.Z-alpha' marker); or null
//   packageVersion       package.json version (semver, no leading 'v'); or null
//   gitCommit            short commit string, or null
//   cleanTree            boolean — working tree has no uncommitted changes; null = not checked
//   pushed               boolean — HEAD is on the remote; null = not checked (no network)
//   releaseNotesPresent  boolean — RELEASE_NOTES_DRAFT.md exists; null = not checked
//   releasePackagePresent boolean — MVP_RELEASE_PACKAGE.md exists; null = not checked
//   gateReady            boolean — tests + RC gate green; null = not checked this pass
//   liveUrl              display URL for the live instance (NOT fetched)
//   autoUpdateActionable boolean — release metadata is actionable (autoUpdate); MUST be false;
//                        null = not checked
//   advisories           OPTIONAL string[] override (defaults to GITHUB_RELEASE_DRY_RUN_ADVISORIES)
//   generatedAt          OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                        reproducible tests; the CLI passes a real stamp at print time.
export function buildGithubReleaseDryRunModel({
  version = null, packageVersion = null, gitCommit = null,
  cleanTree = null, pushed = null,
  releaseNotesPresent = null, releasePackagePresent = null,
  gateReady = null, liveUrl = null, autoUpdateActionable = null,
  advisories = null, generatedAt = null,
} = {}) {
  const stamp = _str(generatedAt);
  const inputs = {
    version, packageVersion, cleanTree, pushed,
    releaseNotesPresent, releasePackagePresent, gateReady, liveUrl, autoUpdateActionable,
  };

  const prerequisites = GITHUB_RELEASE_DRY_RUN_PREREQUISITES.map((c) => {
    const { state, detail } = _resolveState(c.key, inputs);
    return { key: c.key, label: c.label, gating: c.gating, state, detail };
  });

  // Verdict. A gating check in 'blocked' is a HARD blocker → BLOCKED. Otherwise, any gating
  // 'unknown' (can't confirm) or any soft check not 'ok' (dirty tree, unpushed HEAD) holds the
  // verdict at NEAR. All ok → READY (still pending the standing manual-approval gate).
  const blockers = prerequisites.filter((c) => c.gating && c.state === 'blocked');
  const gatingUnknown = prerequisites.filter((c) => c.gating && c.state === 'unknown');
  const softPending = prerequisites.filter((c) => !c.gating && c.state !== 'ok');

  let status; let statusLabel;
  if (blockers.length) { status = 'blocked'; statusLabel = 'BLOCKED'; }
  else if (gatingUnknown.length || softPending.length) { status = 'near'; statusLabel = 'NEAR'; }
  else { status = 'ready'; statusLabel = 'READY (pending manual approval)'; }

  const missing = [...blockers, ...gatingUnknown, ...softPending]
    .map((c) => ({ key: c.key, label: c.label, state: c.state, detail: c.detail }));

  const advList = _arr(advisories).map(String).filter(Boolean);
  const resolvedAdvisories = advList.length ? advList : GITHUB_RELEASE_DRY_RUN_ADVISORIES.slice();

  return {
    schema: GITHUB_RELEASE_DRY_RUN_SCHEMA,
    schemaVersion: GITHUB_RELEASE_DRY_RUN_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: GITHUB_RELEASE_DRY_RUN_BADGE,
    title: GITHUB_RELEASE_DRY_RUN_TITLE,
    dryRun: true,
    status,
    statusLabel,
    ready: status === 'ready',
    version: _str(version),
    packageVersion: _str(packageVersion),
    gitCommit: _str(gitCommit),
    liveUrl: _str(liveUrl),
    prerequisites,
    missing,
    advisories: resolvedAdvisories,
    approvalGate: GITHUB_RELEASE_APPROVAL_GATE,
    approvalRequired: true,
    futureCommands: _futureCommands(version),
    // Observed safety posture — all false in every run (the dry-run only ASSEMBLES text; it
    // tags/releases/pushes/publishes/deploys/announces/serves/navigates/writes/networks nothing).
    safety: {
      tagged: false, released: false, pushed: false, published: false, deployed: false,
      announced: false, served: false, navigated: false, wrote: false, network: false,
    },
    rendered: false,
    actionable: false,
  };
}

// _mark(state) → a stable glyph per prerequisite state. Pure.
function _mark(state) {
  switch (state) {
    case 'ok': return '✓';
    case 'blocked': return '✗';
    case 'pending': return '•';
    default: return '?';
  }
}

// formatGithubReleaseDryRun(model) → a concise multi-line text block for the terminal. Pure;
// null-safe.
export function formatGithubReleaseDryRun(model) {
  const m = _obj(model);
  if (!m) return 'github-release-dry-run: (no dry-run)';
  const L = [];
  L.push(`${m.title} — release dry-run`);
  L.push('─'.repeat(60));
  L.push(`${m.badge}`);
  if (m.generatedAt) L.push(`generated: ${m.generatedAt}`);
  L.push(`verdict: ${m.statusLabel}   (${m.version ?? '(unknown)'}${m.gitCommit ? ` @ ${m.gitCommit}` : ''})`);
  if (m.liveUrl) L.push(`live: ${m.liveUrl}`);
  L.push('');
  L.push('Prerequisites:');
  for (const c of (Array.isArray(m.prerequisites) ? m.prerequisites : [])) {
    L.push(`  ${_mark(c.state)} ${c.label}${c.gating ? '' : '  (soft)'}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  if (Array.isArray(m.missing) && m.missing.length) {
    L.push('');
    L.push('Missing / not-yet-satisfied:');
    for (const x of m.missing) L.push(`  • ${x.label} [${x.state}]`);
  }
  L.push('');
  L.push('Known non-blocking advisories:');
  for (const a of (Array.isArray(m.advisories) ? m.advisories : [])) L.push(`  • ${a}`);
  L.push('');
  L.push('Suggested FUTURE manual commands (TEXT ONLY — none executed here):');
  for (const fc of (Array.isArray(m.futureCommands) ? m.futureCommands : [])) {
    L.push(`  $ ${fc.cmd}`);
    L.push(`      ↳ ${fc.note}`);
  }
  L.push('');
  L.push(`APPROVAL GATE: ${m.approvalGate}`);
  L.push('');
  L.push('DRY-RUN ONLY — no git tag, no GitHub release, no push, no publish, no network.');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatGithubReleaseDryRunMarkdown(model) → a markdown dry-run suitable for
// GITHUB_RELEASE_DRY_RUN.md. Pure; null-safe.
export function formatGithubReleaseDryRunMarkdown(model) {
  const m = _obj(model);
  if (!m) return '# GitHub release dry-run\n\n_(no dry-run)_\n';
  const L = [];
  L.push(`# ${m.title}`);
  L.push('');
  L.push(`> ${m.badge}`);
  if (m.generatedAt) L.push(`> generated: ${m.generatedAt}`);
  L.push('');
  L.push(`- **Verdict:** ${m.statusLabel}`);
  L.push(`- **Version:** ${m.version ?? '(unknown)'}${m.gitCommit ? ` @ ${m.gitCommit}` : ''}`);
  if (m.packageVersion) L.push(`- **package.json:** ${m.packageVersion}`);
  if (m.liveUrl) L.push(`- **Live:** ${m.liveUrl}`);
  L.push('');
  L.push('## Prerequisites');
  L.push('');
  for (const c of (Array.isArray(m.prerequisites) ? m.prerequisites : [])) {
    L.push(`- ${_mark(c.state)} ${c.label}${c.gating ? '' : ' _(soft)_'} — _${c.state}_${c.detail ? `: ${c.detail}` : ''}`);
  }
  L.push('');
  if (Array.isArray(m.missing) && m.missing.length) {
    L.push('## Missing / not-yet-satisfied');
    L.push('');
    for (const x of m.missing) L.push(`- ${x.label} _(${x.state})_`);
    L.push('');
  }
  L.push('## Known non-blocking advisories');
  L.push('');
  for (const a of (Array.isArray(m.advisories) ? m.advisories : [])) L.push(`- ${a}`);
  L.push('');
  L.push('## Suggested FUTURE manual commands');
  L.push('');
  L.push('> TEXT ONLY — none of these are executed by this tool. **Do not run without explicit user approval.**');
  L.push('');
  L.push('```sh');
  for (const fc of (Array.isArray(m.futureCommands) ? m.futureCommands : [])) {
    L.push(`# ${fc.note}`);
    L.push(fc.cmd);
  }
  L.push('```');
  L.push('');
  L.push('## Approval gate');
  L.push('');
  L.push(m.approvalGate);
  L.push('');
  L.push('---');
  L.push('');
  L.push('_DRY-RUN ONLY — this document creates no git tag, no GitHub release, no push, no ' +
    'publish, and reaches no network. The parent agent owns security review, deploy, publish, ' +
    'push, and Space upload._');
  L.push('');
  return L.join('\n');
}
