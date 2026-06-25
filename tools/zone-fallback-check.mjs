// tools/zone-fallback-check.mjs — local, read-only SPA `/zone/*` fallback readiness CLI
// (v0.2.185). Run with: node tools/zone-fallback-check.mjs  (or: npm run zones:check).
//
// Verifies that the outstanding torii.quest/VPS static-host requirement — serve index.html
// for any `/zone/<slug>` path (HANDOFF.md §7, GATEWAY_PROTOCOL.md; needed for hard-refresh /
// deep-link of the v0.2.182 route parser) — is DOCUMENTED with a concrete host-config
// example, and that a built dist/ (if present) has the route shape that relies on the
// fallback (an index.html entry, and NO static file published under /zone/* that would
// shadow it). The pure logic lives in zoneFallbackReadiness.mjs (unit-tested); this file
// only does the fs reads + printing.
//
// NO network, NO server, NO SSH, NO deploy, NO secrets — it only READS local files. Exits
// non-zero iff a HARD requirement is unmet (a required doc is missing the fallback, or a
// built bundle's route shape is inconsistent with relying on it).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  REQUIRED_FALLBACK_DOCS, ZONE_FALLBACK_BADGE, checkZoneFallbackReadiness,
} from './zoneFallbackReadiness.mjs';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

// Gather the required doc bodies as a plain { name → contents } map (missing → omitted).
function readDocs() {
  const out = {};
  for (const name of REQUIRED_FALLBACK_DOCS) {
    const text = readSafe(name);
    if (typeof text === 'string') out[name] = text;
  }
  return out;
}

// Recursively list dist/ file paths relative to dist/ (forward slashes). [] when no build.
function distPaths() {
  if (!existsSync(DIST)) return null; // null → dist check is SKIPPED (no build yet)
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(relative(DIST, p).replace(/\\/g, '/'));
    }
  };
  walk(DIST);
  return out;
}

const docs = readDocs();
const paths = distPaths();
const result = checkZoneFallbackReadiness({ docs, dist: paths ? { paths } : {} });

console.log(`\n${ZONE_FALLBACK_BADGE}`);
console.log(`zone route prefix: /zone/  ·  required docs: ${REQUIRED_FALLBACK_DOCS.join(', ')}`);

// Docs
console.log('\n[docs] SPA /zone/* fallback documented');
if (result.docs.ok) console.log(`  ✓ ${result.docs.checked.join(', ')} describe the index.html fallback`);
for (const e of result.docs.errors) console.error(`  ✗ ${e}`);

// Dist
console.log('\n[dist] built route shape relies on the fallback');
if (result.dist.skipped) console.log('  · no dist/ — skipped (run npm run build for the route-shape check)');
else if (result.dist.ok) console.log(`  ✓ index.html present; no static file published under /zone/*`);
for (const e of result.dist.errors) console.error(`  ✗ ${e}`);

for (const w of result.warnings) console.log(`  · advisory: ${w}`);

console.log(result.ok ? '\nZONE FALLBACK READY' : `\n${result.errors.length} FAILURE(S)`);
process.exit(result.ok ? 0 : 1);
