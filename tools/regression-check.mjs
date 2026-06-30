// tools/regression-check.mjs — static smoke/regression guardrails (v0.2.189).
// No external deps. Run with: node tools/regression-check.mjs  (or: npm run check)
//
// Catches the regressions the Strategy doc calls out, without needing a browser:
//   1. syntax — `node --check` every src/**/*.js
//   2. godMode must never be committed as true
//   3. setTimeout only in the two approved files (nostr.js WS close, hud.js feed)
//   4. no `new THREE.Vector3` / `new THREE.Matrix4` in foundation/new modules
//   5. version markers agree on EXPECTED_VERSION (config.js + index.html +
//      package.json — semver-stripped, no leading 'v'); package.json stays
//      `"private": true` (v0.2.218 — no accidental npm publish of this static app);
//      public/sw.js CACHE_VERSION embeds EXPECTED_VERSION (v0.2.219 — every version
//      bump busts the service-worker cache, so no stale assets after a deploy)
//   6. dist marker check (only if dist/ exists) — key behaviours present
//   7. state.phase writes confined to state.js (FSM seam, v0.2.115)
//   8. every EV.<NAME> reference is defined in the events.js registry (v0.2.116)
//   9. no internal call to window._onBotHit() — use the bus event instead (v0.2.117)
//  10. no internal READ of window._grassMat/_flowerMat (v0.2.118) or
//      window._mirrorMesh (v0.2.119) — use the foliage registry
//      (tickFoliage/getGrassMat/getFlowerMat) / mirror getMirror() instead
//  11. unit-test scaffold present (v0.2.120) — `test` script + tests/*.test.js
//      exist (static only; run the suite with `npm test`)
//  12. proof-surface promotion gate (v0.2.152) — imports the pure proofSurfaceGate()
//      and fails if the in-world proof boards' spec-check, render plan, or scene-graph
//      parent binding is broken/unsafe (fail-fast before a browser/promotion)
//  13. bundle size advisory (v0.2.153) — ADVISORY ONLY (never fails): reports built
//      chunk sizes (app/three/rapier/total JS, raw+gzip) so the Vite large-chunk
//      warning becomes a tracked baseline. Full table: `npm run bundle:report`
//  14. docs/status consistency guard (v0.2.154; v0.2.155 quiets quoted/changelog prose) —
//      FAILS on clear current-version drift in
//      the core continuity docs (todo.md/progress.md/HANDOFF.md) or a missing core doc;
//      ADVISORY warnings (never fail) for advisory-doc lag (SDK_DEBUG_INDEX/CODE_INDEX) and
//      stale "live/published version: vX" contradiction lines. Pure helpers in
//      tools/docConsistency.mjs (unit-tested); this block only reads the files.
//  15. SPA /zone/* fallback readiness (v0.2.185) — FAILS if the required docs
//      (VPS_INSTALL.md/HANDOFF.md) don't document the index.html SPA fallback for
//      /zone/* deep-links, or (when dist/ exists) if the built route shape can't rely on
//      it (no index.html, or a static file published under /zone/* that would shadow it).
//      Pure helpers in tools/zoneFallbackReadiness.mjs (unit-tested); this block reads files.
//
// Exit code 0 = all green; non-zero = at least one FAIL.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const EXPECTED_VERSION = 'v0.2.262-alpha';
const SETTIMEOUT_ALLOWED = new Set(['src/nostr.js', 'src/hud.js']);
// Files where a per-frame hot path must stay allocation-free.
const NO_ALLOC_FILES = [
  'src/dynamicCrates.js',
  'src/engine/physics/bodies.js',
  'src/engine/physics/raycast.js',
  'src/engine/debug/toriiDebug.js',
  'src/world/napZone.js',
  'src/world/handoff.js',
  'src/identity/presence.js',
  'src/engine/entities/player.js',
];

let fails = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); fails++; };
const pass = (m) => console.log(`  ✓ ${m}`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.js') out.push(p);
  }
  return out;
}

const srcFiles = walk(join(ROOT, 'src')).map((p) => p.slice(ROOT.length + 1));

// 1. syntax
console.log('[1] syntax (node --check)');
for (const f of srcFiles) {
  try { execSync(`node --check ${f}`, { stdio: 'pipe' }); }
  catch (e) { fail(`syntax error in ${f}: ${e.message}`); }
}
if (!fails) pass(`${srcFiles.length} files parse clean`);

// 2. godMode
console.log('[2] godMode never true');
{
  let bad = false;
  for (const f of srcFiles) {
    const txt = readFileSync(join(ROOT, f), 'utf8');
    if (/godMode\s*=\s*true/.test(txt)) { fail(`godMode=true in ${f}`); bad = true; }
  }
  const cfg = readFileSync(join(ROOT, 'src/config.js'), 'utf8');
  if (!/godMode\s*=\s*false/.test(cfg)) { fail('config.js godMode is not = false'); bad = true; }
  if (!bad) pass('godMode = false, no godMode=true anywhere');
}

// 3. setTimeout allowlist
console.log('[3] setTimeout allowlist');
{
  let bad = false;
  for (const f of srcFiles) {
    const txt = readFileSync(join(ROOT, f), 'utf8');
    const n = (txt.match(/setTimeout\s*\(/g) || []).length;
    if (n > 0 && !SETTIMEOUT_ALLOWED.has(f)) { fail(`${n} setTimeout in non-allowed ${f}`); bad = true; }
  }
  if (!bad) pass('setTimeout only in nostr.js + hud.js');
}

// 4. no hot-path allocations in new/foundation modules
console.log('[4] no new Vector3/Matrix4 in foundation modules');
{
  let bad = false;
  for (const f of NO_ALLOC_FILES) {
    if (!existsSync(join(ROOT, f))) continue;
    const txt = readFileSync(join(ROOT, f), 'utf8');
    if (/new\s+THREE\.(Vector3|Matrix4)\s*\(/.test(txt)) { fail(`allocation in ${f}`); bad = true; }
  }
  if (!bad) pass('foundation modules allocation-free');
}

// 5. version markers
console.log(`[5] version markers == ${EXPECTED_VERSION}`);
{
  const cfg = readFileSync(join(ROOT, 'src/config.js'), 'utf8');
  if (!cfg.includes(`'${EXPECTED_VERSION}'`)) fail(`config.js VERSION != ${EXPECTED_VERSION}`);
  else pass('config.js VERSION matches');
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const count = (html.match(new RegExp(EXPECTED_VERSION.replace(/\./g, '\\.'), 'g')) || []).length;
  if (count < 2) fail(`index.html has ${count} ${EXPECTED_VERSION} markers (expected >=2)`);
  else pass(`index.html has ${count} version markers`);
  if (/v0\.2\.231-alpha/.test(html)) fail('index.html still references v0.2.231-alpha');
  // package.json `version` must be valid semver (no leading 'v'), so it carries
  // the EXPECTED_VERSION with the 'v' stripped. Ties package metadata to the
  // runtime VERSION so the two can't drift (security-review finding, v0.2.137).
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const pkgVer = pkg.version;
  const expectedPkgVer = EXPECTED_VERSION.replace(/^v/, '');
  if (pkgVer !== expectedPkgVer) fail(`package.json version "${pkgVer}" != "${expectedPkgVer}"`);
  else pass(`package.json version matches (${pkgVer})`);
  // package.json must stay `"private": true` so this static web-app/game can never be
  // accidentally `npm publish`-ed (security-review finding, v0.2.218).
  if (pkg.private !== true) fail('package.json "private" must be true (prevents accidental npm publish)');
  else pass('package.json is private (no accidental publish)');
  // public/sw.js CACHE_VERSION must EMBED the EXPECTED_VERSION so every shipped version
  // bump mints a fresh service-worker cache and the activate handler purges the prior
  // version's assets — no stale cache after an asset-changing deploy. Fails if the
  // literal rots back to a static value like 'tq-v1' (security-review advisory, v0.2.219).
  const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
  const swMatch = sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/);
  if (!swMatch) fail('public/sw.js: no CACHE_VERSION literal found');
  else if (!swMatch[1].includes(EXPECTED_VERSION)) fail(`public/sw.js CACHE_VERSION "${swMatch[1]}" does not embed ${EXPECTED_VERSION} (stale-cache risk)`);
  else pass(`public/sw.js CACHE_VERSION tracks ${EXPECTED_VERSION} (${swMatch[1]})`);
}

// 6. dist markers (only if built)
console.log('[6] dist markers (skipped if no dist/)');
{
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir)) { pass('no dist/ — skipped'); }
  else {
    const assets = existsSync(join(distDir, 'assets')) ? readdirSync(join(distDir, 'assets')) : [];
    // The app entry chunk is content-hashed by Vite/rolldown; its exact filename
    // (separator, hash, even the `index` stem) is not guaranteed across builds.
    // Rather than pin one filename, scan ALL emitted .js assets for the behaviour
    // markers — robust to any hashing/chunk-naming scheme.
    const jsFiles = assets.filter((a) => a.endsWith('.js'));
    if (jsFiles.length === 0) fail('no .js assets in dist/assets/');
    else {
      const js = jsFiles.map((a) => readFileSync(join(distDir, 'assets', a), 'utf8')).join('\n');
      const markers = ['chiefmonkey-headless.glb', 'triangle', 'Idle_11', 'Stylish_Walk_inplace', 'ToriiDebug', 'aim-head', 'applyImpulseAtPoint'];
      for (const m of markers) {
        if (js.includes(m)) pass(`dist marker present: ${m}`);
        else fail(`dist marker MISSING: ${m}`);
      }
    }
    const distHtml = join(distDir, 'index.html');
    if (existsSync(distHtml) && readFileSync(distHtml, 'utf8').includes(EXPECTED_VERSION)) pass('dist index.html version ok');
    else if (existsSync(distHtml)) fail('dist index.html missing version');
  }
}

// 7. state-machine encapsulation — phase writes only via transition() in state.js
console.log('[7] state.phase writes confined to state.js');
{
  let bad = false;
  for (const f of srcFiles) {
    if (f === 'src/state.js') continue;
    const txt = readFileSync(join(ROOT, f), 'utf8');
    if (/state\.phase\s*=/.test(txt)) { fail(`direct state.phase write in ${f} (use transition())`); bad = true; }
  }
  if (!bad) pass('no direct state.phase writes outside state.js');
}

// 8. event-bus registry — every EV.<NAME> used in src/ is defined in events.js
console.log('[8] EV.<NAME> references defined in events.js registry');
{
  const evSrc = readFileSync(join(ROOT, 'src/events.js'), 'utf8');
  const block = evSrc.match(/EV\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  const defined = new Set(
    [...(block ? block[1] : '').matchAll(/^\s*([A-Z0-9_]+)\s*:/gm)].map((m) => m[1]),
  );
  let bad = false;
  for (const f of srcFiles) {
    if (f === 'src/events.js') continue;
    const txt = readFileSync(join(ROOT, f), 'utf8');
    for (const m of txt.matchAll(/\bEV\.([A-Z0-9_]+)\b/g)) {
      if (!defined.has(m[1])) { fail(`unknown event EV.${m[1]} in ${f}`); bad = true; }
    }
  }
  if (!bad) pass(`${defined.size} events defined; all EV.* references valid`);
}

// 9. no internal window._onBotHit() CALL — the bot-hit bridge runs over the bus
// (EV.BOT_HIT_BY_PLAYER) since v0.2.117. The deprecated global may still be
// DEFINED in main.js as a debug-tap alias (`window._onBotHit = ...`), but nothing
// in src/ should CALL it (`window._onBotHit(...)`).
console.log('[9] no internal window._onBotHit() call');
{
  let bad = false;
  for (const f of srcFiles) {
    // Strip comments first — a CALL lives in code, not in prose that merely
    // mentions `window._onBotHit()`. The alias definition (`window._onBotHit =`)
    // is not a call and never matches.
    const code = readFileSync(join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    if (/window\._onBotHit\s*\(/.test(code)) { fail(`internal window._onBotHit() call in ${f} (use EV.BOT_HIT_BY_PLAYER)`); bad = true; }
  }
  if (!bad) pass('bot-hit bridge runs over the event bus, not the global');
}

// 10. no internal READ of window._grassMat/_flowerMat (v0.2.118) or
// window._mirrorMesh (v0.2.119) — these handles live in their owning module's
// scope now (arena-foliage.js registry via tickFoliage/getGrassMat/getFlowerMat;
// mirror.js via getMirror()). The globals are still DEFINED as deprecated debug
// aliases (`window._grassMat = mat`, `window._mirrorMesh = mirror`), so an
// ASSIGNMENT is allowed; any READ (`window._mirrorMesh.onBeforeRender`, passing
// it as a value, etc.) is forbidden. Strip comments, then match the global NOT
// immediately followed by `=` (the assignment form is the only legal use).
console.log('[10] no internal window._grassMat/_flowerMat/_mirrorMesh read');
{
  let bad = false;
  for (const f of srcFiles) {
    const code = readFileSync(join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    if (/window\._(?:grassMat|flowerMat|mirrorMesh)\b(?!\s*=[^=])/.test(code)) {
      fail(`internal window._grassMat/_flowerMat/_mirrorMesh read in ${f} (use the owning module's accessor)`); bad = true;
    }
  }
  if (!bad) pass('foliage + mirror handles read via accessors, not the globals');
}

// 11. unit-test scaffold present (v0.2.120) — guards against the Vitest
// foundation silently rotting away. Static only: confirms the `test` script and
// at least one tests/**/*.test.js exist; it does NOT run the suite (kept fast).
// Run the tests themselves with `npm test`.
console.log('[11] unit-test scaffold present (npm test)');
{
  let bad = false;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (!pkg.scripts || !pkg.scripts.test) { fail('package.json has no "test" script'); bad = true; }
  const testsDir = join(ROOT, 'tests');
  const testFiles = existsSync(testsDir)
    ? walk(testsDir).filter((p) => p.endsWith('.test.js'))
    : [];
  if (testFiles.length === 0) { fail('no tests/**/*.test.js found'); bad = true; }
  if (!bad) pass(`${testFiles.length} test file(s) + npm test script present`);
}

// 12. proof-surface promotion gate (v0.2.152) — RUN the pure gate that folds the
// spec cross-check, render plan, and scene-graph parent binding for the display-only
// proof boards. Fails fast (with the gate's own `reasons`) if any layer is broken or
// unsafe, so a regression can't slip through to the browser or a preview→live promotion.
// The gate chain is pure/node-safe (no THREE/DOM), so it imports cleanly here.
console.log('[12] proof-surface promotion gate (proofSurfaceGate)');
{
  try {
    const { proofSurfaceGate } = await import('../src/engine/debug/proofSurfaceGate.js');
    const g = proofSurfaceGate();
    if (g && g.ok === true) {
      pass(`gate ok — specCheck/renderPlan/parentBinding all pass (${g.counts.bound} bound, ${g.counts.groups} group(s))`);
    } else {
      const reasons = g && Array.isArray(g.reasons) ? g.reasons.join('; ') : 'unknown';
      fail(`proof-surface gate NOT ok: ${reasons}`);
    }
  } catch (e) {
    fail(`proof-surface gate threw: ${e.message}`);
  }
}

// 13. bundle size advisory (v0.2.153) — ADVISORY ONLY, never fails. Reports the built
// chunk sizes (app / three-vendor / rapier / total JS, raw + gzip) so the recurring
// Vite "large chunk" warning becomes a tracked baseline. Skipped when no dist/. Full
// breakdown: `npm run bundle:report`. This block must never touch `fails`.
console.log('[13] bundle size advisory (npm run bundle:report)');
{
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir)) {
    console.log('  · no dist/ — skipped (run npm run build for sizes)');
  } else {
    try {
      const { gzipSync } = await import('node:zlib');
      const { summarizeBundle, formatBytes } = await import('./bundleSizes.mjs');
      const assetsDir = join(distDir, 'assets');
      const entries = [];
      if (existsSync(assetsDir)) {
        for (const name of readdirSync(assetsDir)) {
          if (!name.endsWith('.js')) continue;
          const buf = readFileSync(join(assetsDir, name));
          let gzip = null; try { gzip = gzipSync(buf).length; } catch { /* ignore */ }
          entries.push({ name, bytes: buf.length, gzip });
        }
      }
      const htmlP = join(distDir, 'index.html');
      if (existsSync(htmlP)) { const b = readFileSync(htmlP); entries.push({ name: 'index.html', bytes: b.length, gzip: gzipSync(b).length }); }
      const r = summarizeBundle(entries);
      const c = r.categories;
      console.log(`  · total JS ${formatBytes(r.totals.jsBytes)} raw / ${formatBytes(r.totals.jsGzip)} gzip` +
        `  (app ${formatBytes(c.app)}, three ${formatBytes(c.three)}, rapier ${formatBytes(c.rapier)})`);
      if (r.warnings.length > 0) {
        console.log(`  · advisory: ${r.warnings.length} chunk(s) over ${formatBytes(r.warnLimit)}: ${r.warnings.join(', ')} (tracked, not gated)`);
      }
    } catch (e) {
      console.log(`  · bundle advisory unavailable: ${e.message}`);
    }
  }
}

// 14. docs/status consistency guard (v0.2.154) — keep the cross-model handoff docs from
// drifting away from the live runtime VERSION. HARD FAIL on clear current-version drift in
// the core continuity docs (todo.md/progress.md/HANDOFF.md) or a missing core doc; ADVISORY
// warnings (never fail) for advisory-doc lag + stale live/published version lines. The pure
// logic lives in docConsistency.mjs (node-safe, unit-tested); this block only does fs reads.
console.log('[14] docs/status consistency guard (docConsistency)');
{
  try {
    const { checkDocConsistency, CONTINUITY_DOCS, ADVISORY_DOCS } = await import('./docConsistency.mjs');
    const files = {};
    for (const name of [...CONTINUITY_DOCS, ...ADVISORY_DOCS]) {
      const p = join(ROOT, name);
      if (existsSync(p)) files[name] = readFileSync(p, 'utf8');
    }
    const r = checkDocConsistency({ version: EXPECTED_VERSION, files });
    for (const w of r.warnings) console.log(`  · advisory: ${w}`);
    if (r.ok) pass(`continuity docs reference ${EXPECTED_VERSION} (${r.checked.length} doc(s) checked${r.warnings.length ? `, ${r.warnings.length} advisory` : ''})`);
    else for (const e of r.errors) fail(e);
  } catch (e) {
    fail(`doc-consistency guard threw: ${e.message}`);
  }
}

// 15. SPA /zone/* fallback readiness guard (v0.2.185) — keep the outstanding torii.quest/VPS
// static-host requirement (serve index.html for /zone/* deep-links) DOCUMENTED + checkable.
// HARD FAIL if a required doc (VPS_INSTALL.md/HANDOFF.md) doesn't describe the index.html
// fallback, or (only when dist/ exists) if the built route shape can't rely on it. The pure
// logic lives in zoneFallbackReadiness.mjs (node-safe, unit-tested); this block does fs reads.
console.log('[15] SPA /zone/* fallback readiness (zoneFallbackReadiness)');
{
  try {
    const { REQUIRED_FALLBACK_DOCS, checkZoneFallbackReadiness } = await import('./zoneFallbackReadiness.mjs');
    const docs = {};
    for (const name of REQUIRED_FALLBACK_DOCS) {
      const p = join(ROOT, name);
      if (existsSync(p)) docs[name] = readFileSync(p, 'utf8');
    }
    let dist = {};
    const distDir = join(ROOT, 'dist');
    if (existsSync(distDir)) {
      const paths = [];
      const walkDist = (dir) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walkDist(p);
          else paths.push(p.slice(distDir.length + 1).replace(/\\/g, '/'));
        }
      };
      walkDist(distDir);
      // Gather index.html + /zone/<slug>/index.html directory-index shell bodies so the
      // guard can recognise intentional byte-identical shells (v0.2.243) instead of flagging.
      const contents = {};
      for (const rel of paths) {
        if (rel === 'index.html' || /^zone\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.html$/.test(rel)) {
          try { contents[`/${rel}`] = readFileSync(join(distDir, rel), 'utf8'); } catch { /* skip */ }
        }
      }
      dist = { paths, contents };
    }
    const r = checkZoneFallbackReadiness({ docs, dist });
    for (const w of r.warnings) console.log(`  · advisory: ${w}`);
    if (r.ok) {
      pass(`docs document the /zone/* index.html fallback${r.dist.skipped ? ' (dist route-shape check skipped — no build)' : '; dist route shape relies on it'}`);
    } else {
      for (const e of r.errors) fail(e);
    }
  } catch (e) {
    fail(`zone-fallback guard threw: ${e.message}`);
  }
}

console.log(fails === 0 ? '\nALL GREEN' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
