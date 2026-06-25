// tools/build-continuum.mjs — generate the static Torii Continuum oversight page
// (v0.2.171). Imports the pure, node-safe data module, renders the page + a packaged
// JSON snapshot, and writes both into public/ so Vite copies them verbatim into dist/.
// Run with: node tools/build-continuum.mjs  (or: npm run build:continuum).
//
// Safe by construction: it only READS the curated data module + progress.md/todo.md and
// WRITES two static files under public/. No network, no install, no external writes, no
// game code. As of v0.2.174 it DERIVES the dashboard's list sections from the project
// docs via the pure tools/continuumParse.mjs and merges them over the curated fallback.
import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContinuumModel,
  buildHealthModel,
  buildReadinessModel,
  buildShipModel,
  HEALTH_LASTKNOWN,
  renderContinuumPage,
  continuumDataJSON,
} from '../src/engine/dashboard/continuumData.js';
import { deriveContinuumData } from './continuumParse.mjs';
import { REQUIRED_FALLBACK_DOCS, checkZoneFallbackReadiness } from './zoneFallbackReadiness.mjs';
import { gatherReleaseReadiness } from './release-readiness.mjs';
import { PROFILES } from './testProfiles.mjs';
import { VERSION } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const HTML_OUT = join(PUBLIC, 'continuum.html');
const JSON_OUT = join(PUBLIC, 'continuum-data.json');

// Read the doc sources safely — a missing/unreadable doc degrades to '' and the parser
// records the gap, so the build never fails on a doc hiccup (curated defaults survive).
function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); }
  catch { return ''; }
}

const SOURCES = ['progress.md', 'todo.md'];
const progressMd = readSafe('progress.md');
const todoMd = readSafe('todo.md');
const { overrides, taskTotals, parsed, gaps } = deriveContinuumData({ progressMd, todoMd });

// Engineering-health: GENERATE the deterministic fields at build time (profile file
// counts from the test-profile registry, the full test-file count on disk, the parser-gap
// count from this run, and a real version/doc-sync check), then let buildHealthModel layer
// the LAST-KNOWN values (total tests, timings, bundle baseline, last green gate) under
// clear provenance chips. Falls back to the curated CONTINUUM.health if anything is absent.
function countTestFiles() {
  try { return readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js')).length; }
  catch { return null; }
}
const docsInSync = [progressMd, todoMd].every((d) => d.includes(VERSION));
const health = buildHealthModel({
  version: VERSION,
  profiles: { fast: PROFILES.fast.length, foundation: PROFILES.foundation.length },
  fullFileCount: countTestFiles(),
  parserGaps: gaps.length,
  docsInSync,
  lastKnown: HEALTH_LASTKNOWN,
});

// Deployment readiness (v0.2.186) — run the v0.2.185 read-only zone-fallback guard over the
// required docs + the dist/ present AT PACKAGING TIME (build:continuum runs before vite
// build, so dist/ may be the previous build or absent — the verdict is honest either way:
// no dist → "build check pending"). The authoritative dist check is regression-check [15].
function readDocSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}
function distPathsAtPackaging() {
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir)) return null; // null → dist check SKIPPED (no build yet)
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(distDir, p).replace(/\\/g, '/'));
    }
  };
  walk(distDir);
  return out;
}
const readinessDocs = {};
for (const name of REQUIRED_FALLBACK_DOCS) {
  const text = readDocSafe(name);
  if (typeof text === 'string') readinessDocs[name] = text;
}
const distPaths = distPathsAtPackaging();
const zoneFallback = checkZoneFallbackReadiness({
  docs: readinessDocs,
  dist: distPaths ? { paths: distPaths } : {},
});
const readiness = buildReadinessModel({ zoneFallback });

// Ship readiness (v0.2.188) — fold the LIVE release-readiness verdict (the same signals
// `npm run release:status` shows: version sync, test profiles, the regression gate, advisory
// bundle, /zone/* fallback, docs consistency) into the dashboard's ship-readiness section so
// project oversight shows the last gate posture + the next safe task at a glance. The gather
// is read-only/network-free (git is best-effort); on any failure we degrade to the curated
// LAST-KNOWN snapshot rather than break the build.
let ship;
try {
  ship = buildShipModel({ readiness: gatherReleaseReadiness(ROOT) });
} catch (e) {
  ship = buildShipModel(); // honest LAST-KNOWN fallback
  console.log(`[continuum] ship readiness: live gather unavailable (${e.message}) — using last-known`);
}

// Stamp the packaged build time so the page can show when the data was packaged.
const generatedAt = new Date().toISOString();
const model = {
  ...buildContinuumModel({ ...overrides, health, readiness, ship, taskTotals, derived: { parsed, gaps, sources: SOURCES } }),
  generatedAt,
};

mkdirSync(PUBLIC, { recursive: true });
writeFileSync(HTML_OUT, renderContinuumPage(model), 'utf8');
writeFileSync(JSON_OUT, JSON.stringify(continuumDataJSON(model), null, 2) + '\n', 'utf8');

console.log(`[continuum] wrote ${HTML_OUT}`);
console.log(`[continuum] wrote ${JSON_OUT}`);
console.log(`[continuum] version ${model.version} · packaged ${generatedAt}`);
console.log(`[continuum] derived from ${SOURCES.join(' + ')}: ${parsed.length ? parsed.join(', ') : 'nothing'}`);
console.log(`[continuum] parser gaps (kept curated): ${gaps.length ? gaps.length : 'none'}`);
for (const g of gaps) console.log(`[continuum]   gap: ${g}`);
console.log(`[continuum] health: profiles fast ${PROFILES.fast.length}/foundation ${PROFILES.foundation.length}, full ${countTestFiles()} files, docs ${docsInSync ? 'in sync' : 'DRIFT'}`);
console.log(`[continuum] readiness: ${readiness.statusLabel} (zone-fallback ${zoneFallback.ok ? 'ok' : 'FAIL'}; dist ${distPaths ? 'checked' : 'skipped — no build yet'})`);
console.log(`[continuum] ship readiness: ${ship.statusLabel} (${ship.kind})${ship.blockers && ship.blockers.length ? ` blockers: ${ship.blockers.join(', ')}` : ''}`);
