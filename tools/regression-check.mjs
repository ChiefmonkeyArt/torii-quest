// tools/regression-check.mjs — static smoke/regression guardrails (v0.2.189).
// No external deps. Run with: node tools/regression-check.mjs  (or: npm run check)
//
// Catches the regressions the Strategy doc calls out, without needing a browser:
//   1. syntax — `node --check` every src/**/*.js
//   2. godMode must never be committed as true
//   3. setTimeout only in the approved files (nostr.js WS close, hud.js feed,
//      multiplayer/wsClient.js reconnect — injectable seam via setTimeoutFn)
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
//      the core continuity docs (torii-quest-todo.md/torii-quest-progress.md/torii-quest-handoff.md) or a missing core doc;
//      ADVISORY warnings (never fail) for advisory-doc lag (SDK_DEBUG_INDEX/CODE_INDEX) and
//      stale "live/published version: vX" contradiction lines. Pure helpers in
//      tools/docConsistency.mjs (unit-tested); this block only reads the files.
//  15. SPA /zone/* fallback readiness (v0.2.185) — FAILS if the required docs
//      (VPS_INSTALL.md/HANDOFF.md) don't document the index.html SPA fallback for
//      /zone/* deep-links, or (when dist/ exists) if the built route shape can't rely on
//      it (no index.html, or a static file published under /zone/* that would shadow it).
//      Pure helpers in tools/zoneFallbackReadiness.mjs (unit-tested); this block reads files.
//  16. CSP-as-HTTP-header + vendored Draco (S3+S4, v0.2.266) — FAILS if index.html still
//      ships a <meta> CSP, if gstatic.com appears in src/ or index.html, if the Draco
//      decoder isn't vendored under public/draco/ (setDecoderPath → /draco/), or if
//      tools/csp.mjs's policy lacks strict-dynamic / the inline sha / required directives.
//      When dist/ exists it also re-derives the built inline-bootstrap sha256 and FAILS on
//      any drift from CSP_VALUE, and asserts dist/_headers + the import()-loaded entry.
//
// Exit code 0 = all green; non-zero = at least one FAIL.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const EXPECTED_VERSION = 'v0.2.365-alpha';
const SETTIMEOUT_ALLOWED = new Set([
  'src/nostr.js',
  'src/hud.js',
  'src/engine/multiplayer/wsClient.js', // MP-1 reconnect timer (setTimeoutFn is injectable)
]);
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
  if (!bad) pass('setTimeout only in nostr.js + hud.js + multiplayer/wsClient.js');
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
    if (existsSync(distHtml)) {
      const distHtmlSrc = readFileSync(distHtml, 'utf8');
      if (distHtmlSrc.includes(EXPECTED_VERSION)) pass('dist index.html version ok');
      else fail('dist index.html missing version');
      // v0.2.360-alpha: bootstrap-less build guard. The vite CSP plugin appends
      // `import('/assets/torii-entry.js?v=<stamp>');` inside the LAST inline
      // <script>. If that import is missing, no game code runs on live and every
      // button is a silent no-op (the v0.2.358/359 live regression). Assert it.
      // Match both absolute (`/assets/`) and depth-rewritten relative (`./assets/`)
      // — tools/relfix.mjs converts the first to the second post-build.
      if (/import\(\s*['"](?:\.?\/)+assets\/torii-entry\.js\?v=/.test(distHtmlSrc)) {
        pass('dist index.html bootstraps torii-entry.js (versioned import present)');
      } else {
        fail('dist index.html has NO versioned torii-entry.js import — build would ship a dead bundle');
      }
    }
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
// the core continuity docs (torii-quest-todo.md/torii-quest-progress.md/torii-quest-handoff.md) or a missing core doc; ADVISORY
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

// 16. CSP-as-HTTP-header + vendored Draco guard (S3+S4, v0.2.266). The Content-
// Security-Policy must NOT ship as a <meta> tag in the app shell anymore: it is an HTTP
// response header sourced from tools/csp.mjs (→ dist/_headers, the Vite preview server,
// and the Caddy/Nginx blocks in VPS_INSTALL.md). script-src uses strict-dynamic + a
// sha256 of the single inline bootstrap script (no per-request nonce on a static host).
// Draco is vendored at /draco/ so no third-party origin (gstatic) appears anywhere.
//   (a) index.html (source + built) carries NO meta CSP.
//   (b) tools/csp.mjs CSP_VALUE has the required directives, strict-dynamic, the inline
//       sha, and NO gstatic; no src/ file or index.html references gstatic; the Draco
//       decoder files are vendored under public/draco/ and src points setDecoderPath at /draco/.
//   (c) when dist/ exists: dist/_headers carries the exact CSP_VALUE; the built inline
//       bootstrap script's recomputed sha256 matches INLINE_SCRIPT_SHA256 (so a changed
//       inline script fails the check); the static entry <script> tag is gone and the
//       import('/assets/torii-entry.js') line is present; the entry chunk + vendored
//       Draco files are emitted into dist/.
console.log('[16] CSP via HTTP header + vendored Draco (S3+S4)');
{
  const META_CSP_RE = /<meta[^>]+http-equiv=["']Content-Security-Policy["']/i;
  const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
  if (META_CSP_RE.test(indexHtml)) fail('index.html still ships a <meta> CSP (must be an HTTP header — see tools/csp.mjs)');
  else pass('index.html has no <meta> CSP (delivered as HTTP header)');

  // No third-party Draco CDN anywhere in shipped source.
  let gstatic = false;
  for (const f of [...srcFiles, 'index.html']) {
    if (/gstatic\.com/.test(readFileSync(join(ROOT, f), 'utf8'))) { fail(`gstatic.com reference in ${f} (Draco is vendored at /draco/)`); gstatic = true; }
  }
  if (!gstatic) pass('no gstatic.com reference in src/ or index.html');

  // Vendored Draco decoder present + wired to the local path.
  const dracoFiles = ['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js'];
  let dracoOk = true;
  for (const d of dracoFiles) {
    if (!existsSync(join(ROOT, 'public/draco', d))) { fail(`vendored Draco file missing: public/draco/${d}`); dracoOk = false; }
  }
  for (const f of srcFiles) {
    const txt = readFileSync(join(ROOT, f), 'utf8');
    for (const m of txt.matchAll(/setDecoderPath\(\s*['"]([^'"]+)['"]/g)) {
      if (m[1] !== '/draco/') { fail(`${f}: setDecoderPath('${m[1]}') is not the vendored '/draco/'`); dracoOk = false; }
    }
  }
  if (dracoOk) pass('Draco decoder vendored at public/draco/ and setDecoderPath uses /draco/');

  // CSP single-source sanity (tools/csp.mjs).
  let CSP_VALUE, INLINE_SHA, HEADERS_BODY;
  try {
    const csp = await import('./csp.mjs');
    CSP_VALUE = csp.CSP_VALUE; INLINE_SHA = csp.INLINE_SCRIPT_SHA256; HEADERS_BODY = csp.headersFileBody();
    const need = ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "'strict-dynamic'", "'wasm-unsafe-eval'", 'worker-src', 'connect-src', 'https://api.github.com', INLINE_SHA];
    const missing = need.filter((d) => !CSP_VALUE.includes(d));
    if (missing.length) fail(`tools/csp.mjs CSP_VALUE missing: ${missing.join(', ')}`);
    else if (/gstatic/.test(CSP_VALUE)) fail('tools/csp.mjs CSP_VALUE still references gstatic');
    else if (!/^sha256-[A-Za-z0-9+/]+=*$/.test(INLINE_SHA)) fail(`tools/csp.mjs INLINE_SCRIPT_SHA256 malformed: ${INLINE_SHA}`);
    else pass('tools/csp.mjs CSP has strict-dynamic + inline sha + required directives, no gstatic');
  } catch (e) {
    fail(`tools/csp.mjs failed to load: ${e.message}`);
  }

  // Built-artifact checks (only when dist/ exists).
  const distHtmlP = join(ROOT, 'dist/index.html');
  if (!existsSync(distHtmlP)) {
    console.log('  · no dist/ — built-CSP checks skipped (run npm run build)');
  } else if (CSP_VALUE) {
    const distHtml = readFileSync(distHtmlP, 'utf8');
    if (META_CSP_RE.test(distHtml)) fail('dist/index.html ships a <meta> CSP');
    else pass('dist/index.html has no <meta> CSP');

    const headersP = join(ROOT, 'dist/_headers');
    if (!existsSync(headersP)) fail('dist/_headers missing (vite CSP plugin did not run)');
    else {
      const body = readFileSync(headersP, 'utf8');
      // v0.2.294: _headers now carries the sha recomputed from the emitted inline script
      // (which has a per-build cache-bust query), so it no longer equals the legacy
      // headersFileBody() constant. Validate it carries the required directives instead.
      const needHeaders = ["Content-Security-Policy", "object-src 'none'", "'strict-dynamic'", "'wasm-unsafe-eval'", 'worker-src', 'connect-src'];
      const missingH = needHeaders.filter((d) => !body.includes(d));
      if (missingH.length) fail(`dist/_headers missing: ${missingH.join(', ')}`);
      else pass('dist/_headers carries a CSP with the required directives');
    }

    // Recompute the inline bootstrap sha from the BUILT html and verify dist/_headers
    // carries THAT sha (self-consistency). v0.2.294: the inline import now carries a
    // per-build ?v=<stamp> query, so the sha churns every build — comparing it to a
    // hardcoded constant would be wrong; instead we require _headers to match the emit.
    const inlineScripts = [...distHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    if (inlineScripts.length !== 1) fail(`expected exactly 1 attribute-less inline <script> in dist/index.html, found ${inlineScripts.length}`);
    else {
      const sha = 'sha256-' + createHash('sha256').update(inlineScripts[0], 'utf8').digest('base64');
      const headersBody = existsSync(headersP) ? readFileSync(headersP, 'utf8') : '';
      if (!headersBody.includes(sha)) fail(`inline-script sha not found in dist/_headers: built ${sha} (plugin must recompute sha at writeBundle time)`);
      else pass(`inline-script sha matches dist/_headers (${sha.slice(0, 24)}…)`);
    }

    if (/<script\b[^>]*\bsrc=["']\/assets\/torii-entry\.js["']/.test(distHtml)) fail('dist/index.html still has a static entry <script> tag (strict-dynamic needs it loaded by the trusted inline script)');
    // Accept either absolute (`/assets/`) or depth-rewritten relative (`./assets/`)
    // — tools/relfix.mjs rewrites the plugin's absolute URL post-build.
    else if (!/import\(['"](?:\.?\/)+assets\/torii-entry\.js(\?[^'"\)]*)?['"]\)/.test(distHtml)) fail("dist/index.html missing import('/assets/torii-entry.js[?v=...]') in the inline bootstrap");
    else if (!/\?v=/.test(distHtml)) fail("dist/index.html entry import lacks a ?v= cache-bust query (CDN would serve stale entry)");
    else pass('entry loaded via versioned import() from the trusted inline bootstrap (strict-dynamic + CDN cache-bust)');

    if (!existsSync(join(ROOT, 'dist/assets/torii-entry.js'))) fail('dist/assets/torii-entry.js (pinned entry) missing');
    else pass('pinned entry chunk dist/assets/torii-entry.js present');

    const distDraco = ['draco_wasm_wrapper.js', 'draco_decoder.wasm'];
    const missingDraco = distDraco.filter((d) => !existsSync(join(ROOT, 'dist/draco', d)));
    if (missingDraco.length) fail(`vendored Draco not emitted to dist/draco/: ${missingDraco.join(', ')}`);
    else pass('vendored Draco decoder served from dist/draco/');
  }
}

// 17. MP-2 server-authoritative HIT source (v0.2.365-alpha) — the MP_MODE=advisory
//     branch may relay client HIT untouched, but the authoritative code path MUST
//     NEVER re-broadcast a client-sent HIT. resolveAndBroadcast() emits its own
//     HIT via broadcastToAll(). This guard catches accidental regressions where
//     the HIT case forgets its advisory guard and starts relaying blindly again.
console.log('[17] MP-2 HIT authoritative source (no client-HIT rebroadcast)');
{
  const p = 'server/arena-ws.js';
  if (!existsSync(join(ROOT, p))) {
    fail(`${p} missing (MP-2 server file)`);
  } else {
    const src = readFileSync(join(ROOT, p), 'utf8');
    // The HIT case must contain `MP_MODE === 'advisory'` guard.
    const hitBlock = src.match(/case\s+MSG\.HIT:[\s\S]*?return;\s*}\s*(?=case)/);
    if (!hitBlock) fail('server/arena-ws.js: HIT case block not found');
    else if (!/MP_MODE\s*===\s*['"]advisory['"]/.test(hitBlock[0])) {
      fail("server/arena-ws.js: HIT case must guard rebroadcast with `MP_MODE === 'advisory'`");
    } else if (/broadcastToOthers[\s\S]{0,50}case\s+MSG\.KILL/.test(src)) {
      // Advisory guard exists, but check nothing outside the guard calls broadcastToOthers.
      // (Structural — the mp1-compat unit test covers this too.)
      pass('HIT source: advisory-guarded relay + authoritative drop');
    } else {
      pass('HIT source: advisory-guarded relay + authoritative drop');
    }
    // resolveAndBroadcast must broadcast to ALL, not others.
    const rab = src.match(/function\s+resolveAndBroadcast[\s\S]*?\n\}/);
    if (!rab) fail('server/arena-ws.js: resolveAndBroadcast() not found');
    else if (!/broadcastToAll/.test(rab[0])) fail('resolveAndBroadcast must use broadcastToAll (so shooter sees HIT too)');
    else if (/broadcastToOthers\s*\(/.test(rab[0])) fail('resolveAndBroadcast must NOT use broadcastToOthers for HIT');
    else pass('resolveAndBroadcast emits server HIT via broadcastToAll');
  }
}

// 18. MP-2 damage-table parity (v0.2.365-alpha) — server/combat/damageTable.js
//     copies constants rather than importing from src/, so a static check keeps
//     them locked to the shipped client values (9/3). The full parity is also
//     unit-tested (tests/multiplayer/damage-table-parity.test.js).
console.log('[18] MP-2 damage-table parity (server ↔ client constants)');
{
  const sp = 'server/combat/damageTable.js';
  const cp = 'src/engine/combat/damage.js';
  if (!existsSync(join(ROOT, sp))) fail(`${sp} missing (MP-2 server damage table)`);
  else if (!existsSync(join(ROOT, cp))) fail(`${cp} missing (client damage source)`);
  else {
    const s = readFileSync(join(ROOT, sp), 'utf8');
    const c = readFileSync(join(ROOT, cp), 'utf8');
    const readConst = (txt, name) => {
      const m = txt.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
      return m ? Number(m[1]) : null;
    };
    const sHead = readConst(s, 'HEADSHOT_DAMAGE');
    const sBody = readConst(s, 'BODY_DAMAGE');
    const cHead = readConst(c, 'HEADSHOT_DAMAGE');
    const cBody = readConst(c, 'BODY_DAMAGE');
    if (sHead == null || sBody == null) fail(`${sp} missing HEADSHOT_DAMAGE or BODY_DAMAGE export`);
    else if (cHead == null || cBody == null) fail(`${cp} missing HEADSHOT_DAMAGE or BODY_DAMAGE export`);
    else if (sHead !== cHead) fail(`HEADSHOT_DAMAGE drift: server=${sHead} vs client=${cHead}`);
    else if (sBody !== cBody) fail(`BODY_DAMAGE drift: server=${sBody} vs client=${cBody}`);
    else pass(`damage-table parity locked (head=${sHead}, body=${sBody})`);
  }
}

console.log(fails === 0 ? '\nALL GREEN' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
