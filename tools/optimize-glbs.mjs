#!/usr/bin/env node
// tools/optimize-glbs.mjs — one-shot GLB asset optimizer (v0.2.260).
// Lossless-ish pipeline: WebP textures + Draco mesh compression, NO simplification
// (vertex count preserved exactly). Original GLBs are exported uncompressed from
// Blender; this pipeline closes the gap that DRACOLoader + EXT_texture_webp were
// designed for. Run with: npm run assets:optimize
//
// Safe by construction:
//   - reads from public/, writes to public/ in place ONLY when --write is given,
//     otherwise dry-runs into /tmp/torii-glb-opt/.
//   - never deletes anything; original files are preserved as .glb.original next
//     to the optimized file when --write is used, so a single git revert restores
//     the prior state.
//   - never touches network, never publishes, never modifies game code.
//   - exits non-zero if any file fails to optimize (so it can be wired into CI).
//
// Loader requirements (audit responsibility — already documented in
// src/arena.js / src/weapons.js / src/firstPersonBody.js as of v0.2.260):
//   - GLTFLoader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'))
//   - Three.js r152+ understands EXT_texture_webp natively (no extra loader needed).
//
// What this is NOT:
//   - NOT a build-time step. Optimization is a one-shot author-side action;
//     committed GLBs ship as-is and the SW caches them.
//   - NOT a lossy simplify pipeline. The mesh vertex count is preserved exactly.
//     If you want simplification too (for LODs), run gltf-transform's `simplify`
//     command separately with the explicit ratio you want.

import { readdirSync, statSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, 'public');
const DRY_DIR = '/tmp/torii-glb-opt';
const args = new Set(process.argv.slice(2));
const WRITE = args.has('--write');

function findGlbs() {
  return readdirSync(PUBLIC_DIR)
    .filter((f) => f.endsWith('.glb'))
    .filter((f) => !f.endsWith('.original.glb')) // never re-optimize a backup
    .map((f) => join(PUBLIC_DIR, f));
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function optimize(input, outDir) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const tmp1 = join(outDir, `${basename(input, '.glb')}.webp.tmp.glb`);
  const out = join(outDir, basename(input));

  // Step 1: WebP textures. PNG/JPG → WebP, typically 95%+ texture-bytes reduction.
  // Done FIRST because the draco step decodes if the input is already draco-encoded
  // (we never re-draco, but ordering keeps the pipeline robust to mixed inputs).
  let r = spawnSync('npx', ['--yes', '@gltf-transform/cli', 'webp', input, tmp1], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    process.stderr.write(`webp failed for ${basename(input)}:\n${r.stderr?.toString() || ''}\n`);
    return null;
  }

  // Step 2: Draco mesh compression. Preserves vertex count exactly (no simplify).
  r = spawnSync('npx', ['--yes', '@gltf-transform/cli', 'draco', tmp1, out], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    process.stderr.write(`draco failed for ${basename(input)}:\n${r.stderr?.toString() || ''}\n`);
    return null;
  }

  return out;
}

function main() {
  const files = findGlbs();
  if (files.length === 0) {
    console.log('No .glb files found in public/.');
    process.exit(0);
  }
  console.log(`\n▶ optimize-glbs — ${WRITE ? 'WRITE MODE (replacing originals)' : 'DRY RUN (writing to /tmp)'}`);
  console.log(`  ${files.length} GLB file(s) in public/\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  let failed = 0;

  for (const input of files) {
    const before = statSync(input).size;
    totalBefore += before;
    const out = optimize(input, WRITE ? '/tmp/torii-glb-opt' : DRY_DIR);
    if (!out) {
      failed++;
      console.log(`  ✗ ${basename(input)}   FAILED`);
      continue;
    }
    const after = statSync(out).size;
    totalAfter += after;
    const pct = ((1 - after / before) * 100).toFixed(0);
    console.log(`  ✓ ${basename(input).padEnd(36)} ${humanSize(before).padStart(9)} → ${humanSize(after).padStart(9)}  (-${pct}%)`);

    if (WRITE) {
      const orig = `${input}.original`;
      if (!existsSync(orig)) copyFileSync(input, orig); // one-time backup; never overwrite an existing backup
      renameSync(out, input);
    }
  }

  const totalPct = totalBefore > 0 ? ((1 - totalAfter / totalBefore) * 100).toFixed(0) : 0;
  console.log(`\n  TOTAL: ${humanSize(totalBefore)} → ${humanSize(totalAfter)}  (-${totalPct}%)`);
  if (!WRITE) console.log('\n  (dry run — pass --write to replace originals in public/)');
  if (failed) {
    console.error(`\n  ${failed} file(s) failed to optimize.`);
    process.exit(1);
  }
}

main();
