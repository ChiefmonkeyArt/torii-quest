// tools/mvp-rc-gate.mjs — local, read-only MVP RELEASE-CANDIDATE GATE CLI (v0.2.201).
// Run with: node tools/mvp-rc-gate.mjs  (or: npm run rc:gate).
// Answers ONE question: is this build ready to be called an MVP proof-of-concept RELEASE
// CANDIDATE? It COMPOSES the existing local readiness verdicts — runMvpReadiness() (9 live +
// injected signals) + gatherReleaseReadiness() (version sync, test profiles, regression gate,
// bundle advisory, /zone/* fallback, docs consistency) + buildHandoffSummary() (next-task
// fallback) — into one concise READY / NEAR / BLOCKED verdict with a percentage, the blocking
// reasons, and the next one or two safe tasks. The pure assembly/banding/formatting lives in
// mvpRcGate.mjs (unit-tested); this file only does the fs/git I/O and re-derives nothing.
//
// Modes:
//   (default)        human-readable text block on stdout
//   --json           machine-readable JSON envelope on stdout (scripted consumers use
//                    `npm run --silent rc:gate -- --json`)
//   --markdown/--md  markdown export on stdout
//
// NO network, NO secrets, NO install, NO build, NO writes. It CREATES NO RELEASE: no git tag,
// no GitHub release, no deploy, no publish, no upload — it only READS local verdicts. git is
// best-effort (falls back to null). Always exits 0 — this is a VISIBILITY snapshot, not the gate.
// The authoritative gate stays `npm run check` / `npm run test:release`.
import { readFileSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatherReleaseReadiness } from './release-readiness.mjs';
import { buildHandoffSummary, HANDOFF_SUMMARY_LIVE_URL } from './handoffSummary.mjs';
import { buildMvpRcGate, formatMvpRcGate, formatMvpRcGateMarkdown } from './mvpRcGate.mjs';
import { runMvpReadiness } from '../src/engine/status/mvpReadiness.js';

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

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const release = gatherReleaseReadiness(ROOT);
  let mvp = null;
  try { mvp = runMvpReadiness(); } catch { mvp = null; }
  const handoff = buildHandoffSummary({
    version: configVersion(),
    packageVersion: packageVersion(),
    gitCommit: gitCommit(),
    liveUrl: HANDOFF_SUMMARY_LIVE_URL,
    release,
    generatedAt: null,
  });

  const gate = buildMvpRcGate({
    mvpReadiness: mvp,
    releaseReadiness: release,
    handoff,
    generatedAt: new Date().toISOString(),
  });

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(gate, null, 2) + '\n');
  } else if (argv.includes('--markdown') || argv.includes('--md')) {
    process.stdout.write(formatMvpRcGateMarkdown(gate));
  } else {
    console.log('');
    console.log(formatMvpRcGate(gate));
    console.log('');
  }
  process.exit(0);
}
