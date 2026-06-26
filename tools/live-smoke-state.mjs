// tools/live-smoke-state.mjs — local LIVE SMOKE STATE CLI (v0.2.231).
// Run with: node tools/live-smoke-state.mjs  (or: npm run smoke:state).
// Reads / renders / validates the single auditable LIVE cloud-browser smoke record
// (LIVE_SMOKE_STATE.json) — the one posture local automated gates can NEVER prove, because it is
// an observation of the deployed production URL after a manual deploy. This is the ONE place the
// latest live smoke verdict + per-check evidence is recorded, so the dashboard/handoff surfaces
// read a single normalised source instead of scattered prose.
//
// The pure shaping/validation lives in liveSmokeState.mjs (unit-tested); this file only does the
// fs I/O and the (flag-gated, in-repo) WRITE. Unlike a blank template, --write RE-PERSISTS the
// NORMALISED committed record (so a hand-edit is canonicalised + revalidated, and the curated
// result is preserved) — it never fabricates a pass and never deploys/publishes anything.
//
// NO network, NO secrets, NO install, NO build. By DEFAULT it is READ-ONLY: it prints and
// validates. Always exits 0 — an advisory/visibility tool, not a gate.
//
// Modes:
//   (default)  human-readable text block + validation result on stdout
//   --json     machine-readable live-smoke-state object on stdout
//   --write    (re)write LIVE_SMOKE_STATE.json as the NORMALISED committed record (or an UNKNOWN
//              template for the current config version if the file is missing/garbled).
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLiveSmokeState, formatLiveSmokeState, validateLiveSmokeState,
  LIVE_SMOKE_FILE, LIVE_SMOKE_RESULTS,
} from './liveSmokeState.mjs';

const ROOT = process.cwd();

function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

function configVersion() {
  const m = (readSafe('src/config.js') || '').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// Load the committed live-smoke state if present (re-shaped through buildLiveSmokeState so a hand-
// edited file is normalised + safe to render); otherwise synthesise the default UNKNOWN record for
// the current version. Never throws.
function loadOrDefault() {
  const raw = readSafe(LIVE_SMOKE_FILE);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      return buildLiveSmokeState({
        result: p.result, version: p.version, commit: p.commit, liveUrl: p.liveUrl,
        smokedAt: p.smokedAt, smokedBy: p.smokedBy, checks: p.checks, notes: p.notes,
        generatedAt: p.generatedAt,
      });
    } catch { /* fall through to default */ }
  }
  return buildLiveSmokeState({ result: LIVE_SMOKE_RESULTS.UNKNOWN, version: configVersion() });
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const writing = args.includes('--write');
  const asJson = args.includes('--json');

  // --write re-persists the NORMALISED committed record (preserving the curated result), so a
  // hand-edit is canonicalised and revalidated. It cannot fabricate a pass: validateLiveSmokeState
  // still rejects an unsupported 'pass'. A missing/garbled file falls back to an UNKNOWN template.
  const state = loadOrDefault();
  const json = JSON.stringify(state, null, 2) + '\n';

  if (writing) {
    const outPath = join(ROOT, LIVE_SMOKE_FILE);
    writeFileSync(outPath, json);
    const { ok, errors } = validateLiveSmokeState(state);
    console.log('');
    console.log(`live-smoke-state: wrote ${LIVE_SMOKE_FILE} (result=${state.result})${ok ? ' (valid)' : ` (INVALID: ${errors.join('; ')})`}`);
    console.log('');
    process.exit(0);
  }

  if (asJson) {
    process.stdout.write(json);
    process.exit(0);
  }

  console.log('');
  console.log(formatLiveSmokeState(state));
  console.log('');
  process.exit(0);
}

export { loadOrDefault };
