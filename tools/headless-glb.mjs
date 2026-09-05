// tools/headless-glb.mjs — CLI for the reusable server/character/headlessGlb.js
// authoring core. Reads an input GLB, calls authorHeadlessGlb(), and writes the
// result. See server/character/headlessGlb.js for the full behaviour + error
// shape. Used to author public/{guest,nostrich,chiefmonkey}-headless.glb.
//
// Usage: node tools/headless-glb.mjs --in public/models/guest-master.glb \
//        --out public/guest-headless.glb --keep-anims Idle_02,Stylish_Walk_inplace,Running \
//        [--no-compress-textures]

import { readFile, writeFile } from 'node:fs/promises';
import { authorHeadlessGlb, DEFAULT_KEEP_ANIMS } from '../server/character/headlessGlb.js';

function parseArgs(argv) {
  const a = { in: null, out: null, keepAnims: [], compressTextures: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') a.in = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--keep-anims') a.keepAnims = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--no-compress-textures') a.compressTextures = false;
    // Back-compat with the old flag name so existing scripts / CI keep working.
    else if (argv[i] === '--compress-textures') a.compressTextures = true;
  }
  if (!a.in || !a.out) {
    throw new Error('usage: --in <glb> --out <glb> [--keep-anims a,b,c] [--no-compress-textures]');
  }
  if (a.keepAnims.length === 0) a.keepAnims = DEFAULT_KEEP_ANIMS.slice();
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const buf = await readFile(args.in);
  const res = await authorHeadlessGlb(buf, {
    keepAnims: args.keepAnims,
    compressTextures: args.compressTextures,
  });
  if (!res.ok) {
    console.error(`headless-glb failed: ${res.error}${res.detail ? ` (${res.detail})` : ''}`);
    process.exit(2);
  }
  await writeFile(args.out, res.buffer);
  const s = res.stats;
  console.error(
    `wrote ${args.out} — removed ${s.removedVerts}/${s.totalVerts} verts, ` +
    `kept ${s.keptClips}/${s.totalAnims} clips, ` +
    `${s.bytesIn} → ${s.bytesOut} bytes`,
  );
}

main().catch(err => { console.error(err); process.exit(1); });
