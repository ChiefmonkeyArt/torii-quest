// tools/test-profile.mjs — thin CLI that runs a curated TEST PROFILE (v0.2.173) for fast
// inner AI/dev loops. Resolves a profile name to its explicit file list (tools/testProfiles.mjs),
// validates every file exists on disk, then spawns `vitest run <files…>` and prints a visible
// timing footer so the savings vs. the full suite are obvious in logs.
//
// Usage:
//   node tools/test-profile.mjs fast            # run the fast profile  (npm run test:fast)
//   node tools/test-profile.mjs foundation      # run the curated foundation list (npm run test:foundation:list)
//   node tools/test-profile.mjs fast --list      # print the resolved files, run nothing
//
// NOTE (E2, v0.2.265): `npm run test:foundation` no longer routes here — it now runs
// `vitest run --changed origin/main --passWithNoTests` (change-detection, no curated list).
// The curated foundation set is preserved as `npm run test:foundation:list` (this CLI).
//
// This only READS local files and spawns the local vitest binary — no network, no build, no
// secrets. It is a developer convenience, NOT the release gate: every public deploy/publish
// must still pass `npm run test:release` (full suite + check + build + bundle + handoff).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  PROFILE_NAMES, isKnownProfile, profileFiles, validateProfiles, formatTiming,
} from './testProfiles.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const name = args.find((a) => !a.startsWith('-'));

if (!isKnownProfile(name)) {
  console.error(`test-profile: unknown profile ${name ? `"${name}"` : '(none given)'}.`);
  console.error(`  known profiles: ${PROFILE_NAMES.join(', ')}`);
  process.exit(2);
}

// Validate the curated lists against what actually exists on disk — a renamed/deleted test
// must fail loudly here rather than silently shrinking a profile.
let existing = [];
try {
  existing = readdirSync(join(ROOT, 'tests'))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => `tests/${f}`);
} catch {
  console.error('test-profile: cannot read tests/ directory.');
  process.exit(2);
}
const { ok, errors } = validateProfiles(existing);
if (!ok) {
  console.error('test-profile: profile registry is out of sync with tests/:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(2);
}

const files = profileFiles(name);

if (listOnly) {
  console.log(`test:${name} (${files.length} file(s)):`);
  for (const f of files) console.log(`  ${f}`);
  process.exit(0);
}

console.log(`\n▶ test:${name} — ${files.length} curated file(s) (inner-loop profile, NOT the release gate)\n`);

const started = Date.now();
const res = spawnSync('npx', ['vitest', 'run', ...files], { cwd: ROOT, stdio: 'inherit' });
const elapsed = Date.now() - started;

console.log(`\n${formatTiming(name, files.length, elapsed)}`);
console.log('Reminder: run `npm run test:release` before any deploy/publish.\n');

process.exit(res.status == null ? 1 : res.status);
