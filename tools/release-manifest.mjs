// tools/release-manifest.mjs — local, read-only RELEASE ARTIFACT MANIFEST CLI (v0.2.212).
// Run with: node tools/release-manifest.mjs  (or: npm run release:manifest).
// Records the RC package artifacts a future GitHub release / VPS self-update flow would need to
// verify: it reads each REQUIRED + OPTIONAL in-repo text doc / served build-metadata file, computes
// a sha256 checksum + byte size via node:crypto, and hands a plain { key: { present, sha256, bytes } }
// map to buildReleaseManifestModel (the pure assembly/formatting lives in releaseManifest.mjs and is
// unit-tested). This file only does the fs/git I/O and re-derives nothing.
//
// Modes:
//   (default)        human-readable text block on stdout
//   --json           machine-readable JSON envelope on stdout
//   --markdown/--md  markdown manifest on stdout
//   --write[=path]   ALSO write the markdown manifest to a file (default RELEASE_ARTIFACT_MANIFEST.md).
//                    This is the ONLY thing that writes — without --write the tool is read-only.
//                    The path is CONFINED inside the repo (resolveHandoffWritePath): an absolute
//                    path or a `..` escape is rejected.
//
// MANIFEST ONLY: NO GitHub release, NO git tag, NO push, NO deploy, NO publish, NO self-update, NO
// network, NO server, NO secrets, NO install, NO build, and NO writes unless --write is given. git is
// best-effort and READ-ONLY (rev-parse; falls back to null). Checksums cover in-repo text docs + small
// served build-metadata JSON only — never large dist/ bundles or secrets. Always exits 0 — this is a
// VISIBILITY manifest, not a gate. The authority stays `npm run test:release`.
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHandoffWritePath, HANDOFF_SUMMARY_LIVE_URL } from './handoffSummary.mjs';
import {
  buildReleaseManifestModel, formatReleaseManifest, formatReleaseManifestMarkdown,
  selectRecentReports,
  RELEASE_MANIFEST_REQUIRED, RELEASE_MANIFEST_OPTIONAL, RELEASE_MANIFEST_WRITE_FILENAME,
} from './releaseManifest.mjs';

const ROOT = process.cwd();

function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

function configVersion() {
  const m = (readSafe('src/config.js') || '').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function packageVersion() {
  try { return JSON.parse(readSafe('package.json') || '{}').version || null; } catch { return null; }
}

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || null;
  } catch { return null; }
}

// artifactRecord(rel) → { present, sha256, bytes } for an in-repo file (read + hashed). A missing or
// unreadable file degrades to { present:false, sha256:null, bytes:null }. Never throws.
function artifactRecord(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return { present: false, sha256: null, bytes: null };
  try {
    const buf = readFileSync(abs);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    let bytes = buf.length;
    try { bytes = statSync(abs).size; } catch { /* keep buffer length */ }
    return { present: true, sha256, bytes };
  } catch {
    // F16: an existing-but-unreadable file is NOT a verified artifact. Presence
    // with no readable hash must not count toward a COMPLETE verdict, so degrade
    // to present:null (unknown) rather than present:true with a null hash.
    return { present: null, sha256: null, bytes: null };
  }
}

// artifactMap() → { key: { present, sha256, bytes } } for every REQUIRED + OPTIONAL ref.
function artifactMap() {
  const out = {};
  for (const d of RELEASE_MANIFEST_REQUIRED) out[d.key] = artifactRecord(d.file);
  for (const d of RELEASE_MANIFEST_OPTIONAL) out[d.key] = artifactRecord(d.file);
  return out;
}

// recentReports() → recent torii-v*-report.md filenames (best-effort, newest-ish last), capped.
// Reads the repo root with fs.readdirSync and filters/sorts in JS (pure selectRecentReports) — no
// shell glob, no child_process.
function recentReports() {
  try {
    return selectRecentReports(readdirSync(ROOT));
  } catch { return []; }
}

// Parse --write / --write=path → { write, path?, error? }. Default file RELEASE_ARTIFACT_MANIFEST.md.
// The target is CONFINED inside the repo via the shared, pure resolveHandoffWritePath: an absolute
// path or a `..` escape is REJECTED. Without --write the tool stays read-only.
function writeTarget(argv) {
  const arg = argv.find((a) => a === '--write' || a.startsWith('--write='));
  if (!arg) return { write: false, path: null };
  const eq = arg.indexOf('=');
  const raw = eq >= 0 ? arg.slice(eq + 1) : RELEASE_MANIFEST_WRITE_FILENAME;
  const resolved = resolveHandoffWritePath(raw, ROOT);
  if (!resolved.ok) return { write: true, path: null, error: resolved.error };
  return { write: true, path: resolved.path };
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);

  const model = buildReleaseManifestModel({
    version: configVersion(),
    packageVersion: packageVersion(),
    gitCommit: gitCommit(),
    liveUrl: HANDOFF_SUMMARY_LIVE_URL,
    artifacts: artifactMap(),
    reports: recentReports(),
    generatedAt: new Date().toISOString(),
  });

  const { write, path, error } = writeTarget(argv);
  if (write && !path) {
    process.stderr.write(`release-manifest: refusing --write (${error}); the target must be inside the repo (no absolute path, no '..').\n`);
    process.exit(2);
  }
  if (write) {
    writeFileSync(path, formatReleaseManifestMarkdown(model), 'utf8');
    process.stderr.write(`release-manifest: wrote ${path}\n`);
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(model, null, 2) + '\n');
  } else if (argv.includes('--markdown') || argv.includes('--md')) {
    process.stdout.write(formatReleaseManifestMarkdown(model));
  } else {
    console.log('');
    console.log(formatReleaseManifest(model));
    console.log('');
  }
  process.exit(0);
}
