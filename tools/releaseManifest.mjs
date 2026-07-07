// tools/releaseManifest.mjs — PURE, node-safe RELEASE ARTIFACT MANIFEST assembly + formatting
// (v0.2.212). Produces ONE manifest that records the RC package artifacts a future GitHub release /
// VPS self-update flow would need to verify: the exact version + commit + live URL, the REQUIRED
// artifacts (release notes, release package index, GitHub release dry-run, build metadata, config),
// the OPTIONAL artifacts (RC snapshot, playtest docs, handoff, VPS install notes), each with a
// present/missing flag and a stable sha256 checksum + byte size the CLI injects from disk, plus the
// recent slice reports and a short note on how the manifest supports future release-integrity / self-
// update checks.
//
// It hashes NOTHING itself and reaches NO fs/network: the CLI (tools/release-manifest.mjs) reads each
// in-repo text doc / build-metadata file, computes a sha256 via node:crypto, and hands a plain
// { key: { present, sha256, bytes } } map to buildReleaseManifestModel. So the assembly/formatting is
// fully unit-testable (tests/release-manifest.test.js). MANIFEST ONLY: it creates NO GitHub release,
// NO git tag, NO publish, NO self-update, and reaches NO network/server. Pure + deterministic: NO fs,
// NO network, NO crypto, NO child_process, NO process in here. Null/garbled inputs degrade to honest
// UNKNOWNs; never throws.

// Shared, non-misleading wording for the stamped source commit (this manifest is generated before its
// own commit — see tools/commitStamp.mjs).
import { sourceCommitInline } from './commitStamp.mjs';

// Stable schema id + integer version for the machine-readable (--json) mode. Bump
// RELEASE_MANIFEST_SCHEMA_VERSION on any breaking shape change.
export const RELEASE_MANIFEST_SCHEMA = 'torii.release-manifest';
export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only MANIFEST — never a release/tag/publish/self-update.
export const RELEASE_MANIFEST_BADGE = 'RELEASE ARTIFACT MANIFEST · LOCAL · READ-ONLY';

// Default in-repo filename for the opt-in --write markdown manifest.
export const RELEASE_MANIFEST_WRITE_FILENAME = 'RELEASE_ARTIFACT_MANIFEST.md';

// The product title shown atop the manifest.
export const RELEASE_MANIFEST_TITLE = 'Torii Quest — Release Artifact Manifest';

// The two coarse manifest verdicts (never over-claims):
//   COMPLETE   — every REQUIRED artifact is present on disk (optional ones may still be missing)
//   INCOMPLETE — at least one REQUIRED artifact is missing (a future release would be blocked)
export const RELEASE_MANIFEST_STATES = Object.freeze(['COMPLETE', 'INCOMPLETE']);

// RELEASE_MANIFEST_REQUIRED — the artifacts a future GitHub release / VPS self-update flow MUST have
// to verify package integrity, each { key, file, label, category }. Frozen so a consumer can rely on
// the order. `key` is the stable id the CLI uses to inject a present/sha256/bytes record (it reads
// `file` relative to the repo root). The unit test asserts every file here actually exists in the
// repo, so a missing REQUIRED artifact is caught locally before any release is attempted.
export const RELEASE_MANIFEST_REQUIRED = Object.freeze([
  Object.freeze({ key: 'release-notes', file: 'RELEASE_NOTES_DRAFT.md', label: 'MVP release notes (DRAFT)', category: 'doc' }),
  Object.freeze({ key: 'release-package', file: 'MVP_RELEASE_PACKAGE.md', label: 'MVP release package index', category: 'doc' }),
  Object.freeze({ key: 'github-dry-run', file: 'GITHUB_RELEASE_DRY_RUN.md', label: 'GitHub release dry-run', category: 'doc' }),
  Object.freeze({ key: 'release-metadata', file: 'public/release-metadata.json', label: 'Build / release metadata (served)', category: 'build-metadata' }),
  Object.freeze({ key: 'package-json', file: 'package.json', label: 'Package manifest (version + scripts)', category: 'config' }),
  Object.freeze({ key: 'index-html', file: 'index.html', label: 'App entry (version-stamped)', category: 'config' }),
]);

// RELEASE_MANIFEST_OPTIONAL — supporting artifacts that strengthen the package but do NOT block a
// future release if absent. Same { key, file, label, category } shape; the CLI injects the same
// present/sha256/bytes record.
export const RELEASE_MANIFEST_OPTIONAL = Object.freeze([
  Object.freeze({ key: 'rc-snapshot', file: 'MVP_RC_SNAPSHOT.md', label: 'MVP RC freeze-candidate snapshot', category: 'doc' }),
  Object.freeze({ key: 'playtest-checklist', file: 'MVP_PLAYTEST_CHECKLIST.md', label: 'MVP playtest checklist', category: 'doc' }),
  Object.freeze({ key: 'playtest-results', file: 'MVP_PLAYTEST_RESULTS_TEMPLATE.md', label: 'MVP playtest results template', category: 'doc' }),
  Object.freeze({ key: 'handoff', file: 'torii-quest-handoff.md', label: 'Handoff narrative (source of truth)', category: 'doc' }),
  Object.freeze({ key: 'vps-install', file: 'VPS_INSTALL.md', label: 'VPS install / manual deploy notes', category: 'doc' }),
  Object.freeze({ key: 'continuum-data', file: 'public/continuum-data.json', label: 'Continuum dashboard data (served)', category: 'build-metadata' }),
]);

// RELEASE_MANIFEST_NOTES — how this manifest supports a future release-integrity / self-update check.
// Inert documentation only; nothing here runs or fetches.
export const RELEASE_MANIFEST_NOTES = Object.freeze([
  'Each artifact carries a sha256 + byte size captured at generation time, so a future release/self-update step can verify the shipped copy matches what was committed (no silent drift).',
  'The REQUIRED list is the minimum set a GitHub release / VPS self-update must resolve; an INCOMPLETE verdict means a future release would be blocked until the missing artifact is restored.',
  'Checksums cover in-repo text docs + small served build-metadata JSON only — no secrets, no large binaries (the rapier chunk and other dist/ bundles are intentionally not hashed here).',
  'This manifest is a VISIBILITY artifact: it performs no release, no tag, no publish, no network self-update. The parent agent owns security review, deploy, publish, push, and Space upload.',
]);

// RELEASE_MANIFEST_REPORT_RE / _CAP — the slice-report filename shape the CLI discovers from disk
// and how many of the most recent it keeps. This is the JS equivalent of the old `torii-v*-report.md`
// shell glob: starts `torii-v`, ends `-report.md`. Used by selectRecentReports so discovery needs no
// child_process / shell.
export const RELEASE_MANIFEST_REPORT_RE = /^torii-v.*-report\.md$/;
export const RELEASE_MANIFEST_REPORT_CAP = 6;

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

// _strList(x, fallback) → a cleaned string[] (non-empty), or the frozen fallback sliced. Pure.
function _strList(x, fallback) {
  const list = _arr(x).map(String).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback.slice();
}

// selectRecentReports(names, cap) → recent slice-report filenames (those matching the report shape),
// sorted lexicographically for a deterministic order, capped to the most recent `cap` (newest-ish
// last). Pure; null-safe; never throws. Replaces the old `ls torii-v*-report.md` shell glob: the CLI
// hands it readdirSync(root) and no child_process / shell is involved.
export function selectRecentReports(names, cap = RELEASE_MANIFEST_REPORT_CAP) {
  const n = (Number.isInteger(cap) && cap > 0) ? cap : RELEASE_MANIFEST_REPORT_CAP;
  return _arr(names)
    .map(String).map((s) => s.trim()).filter(Boolean)
    .filter((s) => RELEASE_MANIFEST_REPORT_RE.test(s))
    .sort()
    .slice(-n);
}

// _sha(x) → a 64-hex sha256 string (lowercased), else null. Pure (validates an injected hash).
function _sha(x) {
  const s = _str(x);
  return (s && /^[0-9a-f]{64}$/i.test(s)) ? s.toLowerCase() : null;
}

// _entry(ref, rec) → a plain artifact record { key, file, label, category, present, sha256, bytes }.
// `rec` is the CLI-injected { present, sha256, bytes }; an absent rec degrades to present:null. Pure.
function _entry(ref, rec) {
  const r = _obj(rec);
  const present = r && Object.prototype.hasOwnProperty.call(r, 'present')
    ? r.present === true : null;
  return {
    key: ref.key, file: ref.file, label: ref.label, category: ref.category,
    present,
    sha256: r ? _sha(r.sha256) : null,
    bytes: r ? _int(r.bytes) : null,
  };
}

// buildReleaseManifestModel(inputs) → a plain, JSON-serialisable release artifact manifest model.
// All inputs are plain data the CLI gathers:
//   version        config.js VERSION (a 'vX.Y.Z-alpha' marker); or null
//   packageVersion package.json version; or null
//   gitCommit      short commit string, or null (the SOURCE commit — precedes this file's commit)
//   liveUrl        display URL for the live instance (NOT fetched)
//   artifacts      map { key: { present, sha256, bytes } } injected by the CLI from disk; or null
//   required / optional   OPTIONAL ref-list overrides ({key,file,label,category}); defaults frozen above
//   notes          OPTIONAL string[] override (default RELEASE_MANIFEST_NOTES)
//   reports        OPTIONAL string[] of recent report names
//   generatedAt    OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                  reproducible tests; the CLI passes a real stamp at print time.
export function buildReleaseManifestModel({
  version = null, packageVersion = null, gitCommit = null, liveUrl = null,
  artifacts = null, required = null, optional = null, notes = null,
  reports = null, generatedAt = null,
} = {}) {
  const stamp = _str(generatedAt);
  const artMap = _obj(artifacts) || {};

  const reqRefs = Array.isArray(required) && required.length ? required : RELEASE_MANIFEST_REQUIRED;
  const optRefs = Array.isArray(optional) && optional.length ? optional : RELEASE_MANIFEST_OPTIONAL;

  const requiredEntries = reqRefs.map((d) => _entry(d, artMap[d.key]));
  const optionalEntries = optRefs.map((d) => _entry(d, artMap[d.key]));

  // A REQUIRED artifact counts as missing only when explicitly known-absent (present === false).
  // An unknown (null) present flag is NOT treated as missing — the manifest never invents a blocker.
  const missingRequired = requiredEntries.filter((e) => e.present === false).map((e) => e.file);
  const status = missingRequired.length ? 'INCOMPLETE' : 'COMPLETE';

  const counts = {
    required: requiredEntries.length,
    requiredPresent: requiredEntries.filter((e) => e.present === true).length,
    requiredMissing: missingRequired.length,
    optional: optionalEntries.length,
    optionalPresent: optionalEntries.filter((e) => e.present === true).length,
    hashed: requiredEntries.concat(optionalEntries).filter((e) => e.sha256).length,
  };

  return {
    schema: RELEASE_MANIFEST_SCHEMA,
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: RELEASE_MANIFEST_BADGE,
    title: RELEASE_MANIFEST_TITLE,
    manifest: true,
    status,
    complete: status === 'COMPLETE',
    version: _str(version),
    packageVersion: _str(packageVersion),
    gitCommit: _str(gitCommit),
    liveUrl: _str(liveUrl),
    required: requiredEntries,
    optional: optionalEntries,
    missingRequired,
    counts,
    notes: _strList(notes, RELEASE_MANIFEST_NOTES),
    latestReports: _arr(reports).map(String).filter(Boolean),
    // Observed safety posture — all false in every run (the manifest only ASSEMBLES text; it
    // releases/tags/publishes/self-updates/serves/writes/networks nothing).
    safety: {
      released: false, tagged: false, published: false, selfUpdated: false,
      served: false, wrote: false, network: false, hashedSecrets: false,
    },
    rendered: false,
    actionable: false,
  };
}

// _presentMark(p) → a short status token for a present/missing/unknown flag. Pure.
function _presentMark(p) {
  if (p === true) return 'present';
  if (p === false) return 'MISSING';
  return 'unknown';
}

// _shaShort(h) → a short, display-friendly checksum (first 12 hex), or '—'. Pure.
function _shaShort(h) {
  const s = _sha(h);
  return s ? s.slice(0, 12) : '—';
}

// formatReleaseManifest(model) → a concise multi-line text block for the terminal. Pure; null-safe.
export function formatReleaseManifest(model) {
  const m = _obj(model);
  if (!m) return 'release-manifest: (no manifest)';
  const L = [];
  L.push(`${m.title}`);
  L.push('─'.repeat(60));
  L.push(`${m.badge}`);
  if (m.generatedAt) L.push(`generated: ${m.generatedAt}`);
  L.push(`status: ${m.status}`);
  L.push(`version: ${m.version ?? '(unknown)'}${sourceCommitInline(m.gitCommit)}`);
  if (m.liveUrl) L.push(`live (manual deploy): ${m.liveUrl}`);
  L.push(`required: ${m.counts.requiredPresent}/${m.counts.required} present · optional: ${m.counts.optionalPresent}/${m.counts.optional} present · ${m.counts.hashed} hashed`);
  L.push('');
  L.push('Required artifacts:');
  for (const e of m.required) {
    L.push(`  • ${e.file} — ${e.label} [${_presentMark(e.present)}] sha256:${_shaShort(e.sha256)}${e.bytes != null ? ` ${e.bytes}B` : ''}`);
  }
  L.push('');
  L.push('Optional artifacts:');
  for (const e of m.optional) {
    L.push(`  • ${e.file} — ${e.label} [${_presentMark(e.present)}] sha256:${_shaShort(e.sha256)}${e.bytes != null ? ` ${e.bytes}B` : ''}`);
  }
  if (m.missingRequired.length) {
    L.push('');
    L.push('MISSING required artifacts (would block a future release):');
    for (const f of m.missingRequired) L.push(`  • ${f}`);
  }
  L.push('');
  L.push('How this supports release integrity / self-update:');
  for (const n of m.notes) L.push(`  • ${n}`);
  if (Array.isArray(m.latestReports) && m.latestReports.length) {
    L.push('');
    L.push('Recent reports:');
    for (const r of m.latestReports) L.push(`  • ${r}`);
  }
  L.push('');
  L.push('MANIFEST ONLY — no GitHub release, no tag, no publish, no self-update, no network.');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatReleaseManifestMarkdown(model) → markdown suitable for RELEASE_ARTIFACT_MANIFEST.md. Pure; null-safe.
export function formatReleaseManifestMarkdown(model) {
  const m = _obj(model);
  if (!m) return '# Release artifact manifest\n\n_(no manifest)_\n';
  const L = [];
  L.push(`# ${m.title}`);
  L.push('');
  L.push(`> ${m.badge}`);
  if (m.generatedAt) L.push(`> generated: ${m.generatedAt}`);
  L.push('');
  L.push(`- **Status:** ${m.status}`);
  L.push(`- **Version:** ${m.version ?? '(unknown)'}${sourceCommitInline(m.gitCommit)}`);
  if (m.packageVersion) L.push(`- **Package version:** ${m.packageVersion}`);
  if (m.liveUrl) L.push(`- **Live (manual deploy):** ${m.liveUrl}`);
  L.push(`- **Coverage:** ${m.counts.requiredPresent}/${m.counts.required} required present · ${m.counts.optionalPresent}/${m.counts.optional} optional present · ${m.counts.hashed} hashed`);
  L.push('');
  L.push('## Required artifacts');
  L.push('');
  L.push('| Artifact | Label | Category | Present | sha256 | Bytes |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const e of m.required) {
    L.push(`| \`${e.file}\` | ${e.label} | ${e.category} | ${_presentMark(e.present)} | \`${_shaShort(e.sha256)}\` | ${e.bytes != null ? e.bytes : '—'} |`);
  }
  L.push('');
  L.push('## Optional artifacts');
  L.push('');
  L.push('| Artifact | Label | Category | Present | sha256 | Bytes |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const e of m.optional) {
    L.push(`| \`${e.file}\` | ${e.label} | ${e.category} | ${_presentMark(e.present)} | \`${_shaShort(e.sha256)}\` | ${e.bytes != null ? e.bytes : '—'} |`);
  }
  if (m.missingRequired.length) {
    L.push('');
    L.push('## Missing required artifacts');
    L.push('');
    L.push('_These would block a future GitHub release / VPS self-update until restored._');
    L.push('');
    for (const f of m.missingRequired) L.push(`- \`${f}\``);
  }
  L.push('');
  L.push('## How this supports release integrity / self-update');
  L.push('');
  for (const n of m.notes) L.push(`- ${n}`);
  if (Array.isArray(m.latestReports) && m.latestReports.length) {
    L.push('');
    L.push('## Recent reports');
    L.push('');
    for (const r of m.latestReports) L.push(`- \`${r}\``);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('_MANIFEST ONLY — this document creates no GitHub release, no git tag, no publish, no ' +
    'network self-update. Checksums cover in-repo text docs + small served build metadata only ' +
    '(no secrets, no large binaries). The parent agent owns security review, deploy, publish, ' +
    'push, and Space upload._');
  L.push('');
  return L.join('\n');
}
