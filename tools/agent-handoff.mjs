// tools/agent-handoff.mjs — local, read-only AGENT HANDOFF READINESS export CLI (v0.2.199).
// Run with: node tools/agent-handoff.mjs  (or: npm run handoff:agent).
// Produces the agent-friendly handoff a NEXT agent/model — including non-Perplexity tools
// (DeepSeek / Perplexica / Routstr-style handoffs) — needs to continue the safe MVP pipeline
// WITHOUT reading the whole repo: version, live URL, gate verdict, test counts, latest reports,
// the standing hard constraints, the next SAFE task, the pure smoke-harness inventory, and the
// v0.2.198 MVP-readiness rollup (pct + status). The pure assembly/formatting lives in
// agentHandoff.mjs (unit-tested); this file only does the fs/git I/O and COMPOSES the existing
// gatherReleaseReadiness() + buildHandoffSummary() + runMvpReadiness() — it re-derives nothing.
//
// Modes:
//   (default)        human-readable text block on stdout
//   --json           machine-readable JSON envelope on stdout (canonical: pipe this; scripted
//                    npm consumers use `npm run --silent handoff:agent -- --json`)
//   --markdown/--md  markdown export on stdout
//   --write[=path]   ALSO write the markdown export to a file (default HANDOFF.generated.md).
//                    This is the ONLY thing that writes — without --write the tool is read-only.
//                    The path is CONFINED inside the repo (resolveHandoffWritePath): an absolute
//                    path or a `..` escape is rejected. The curated HANDOFF.md is NEVER touched.
//
// NO network, NO secrets, NO install, NO build, and NO writes unless --write is given. git is
// best-effort (falls back to null). Always exits 0 — this is a VISIBILITY snapshot, not a gate.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatherReleaseReadiness } from './release-readiness.mjs';
import {
  buildHandoffSummary, resolveHandoffWritePath, HANDOFF_SUMMARY_LIVE_URL,
} from './handoffSummary.mjs';
import {
  buildAgentHandoff, formatAgentHandoff, formatAgentHandoffMarkdown,
  AGENT_HANDOFF_WRITE_FILENAME,
} from './agentHandoff.mjs';
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

// Parse --write / --write=path → { write, path?, error? }. Default file is HANDOFF.generated.md.
// The target is CONFINED inside the repo via the pure resolveHandoffWritePath (shared with
// handoff-summary): an absolute path or a `..` escape is REJECTED so a developer-tool write
// can't clobber an arbitrary path outside the repo. Without --write the tool stays read-only.
function writeTarget(argv) {
  const arg = argv.find((a) => a === '--write' || a.startsWith('--write='));
  if (!arg) return { write: false, path: null };
  const eq = arg.indexOf('=');
  const raw = eq >= 0 ? arg.slice(eq + 1) : AGENT_HANDOFF_WRITE_FILENAME;
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
  const release = gatherReleaseReadiness(ROOT);
  const summary = buildHandoffSummary({
    version: configVersion(),
    packageVersion: packageVersion(),
    gitCommit: gitCommit(),
    liveUrl: HANDOFF_SUMMARY_LIVE_URL,
    release,
    generatedAt: null,
  });
  let mvp = null;
  try { mvp = runMvpReadiness(); } catch { mvp = null; }

  const handoff = buildAgentHandoff({
    handoffSummary: summary,
    mvpReadiness: mvp,
    generatedAt: new Date().toISOString(),
  });

  const { write, path, error } = writeTarget(argv);
  if (write && !path) {
    process.stderr.write(`agent-handoff: refusing --write (${error}); the target must be inside the repo (no absolute path, no '..').\n`);
    process.exit(2);
  }
  if (write) {
    writeFileSync(path, formatAgentHandoffMarkdown(handoff), 'utf8');
    process.stderr.write(`agent-handoff: wrote ${path}\n`);
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(handoff, null, 2) + '\n');
  } else if (argv.includes('--markdown') || argv.includes('--md')) {
    process.stdout.write(formatAgentHandoffMarkdown(handoff));
  } else {
    console.log('');
    console.log(formatAgentHandoff(handoff));
    console.log('');
  }
  process.exit(0);
}
