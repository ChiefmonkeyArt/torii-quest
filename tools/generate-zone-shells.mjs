// tools/generate-zone-shells.mjs — emit static `/zone/<slug>/` SHELL files into dist/
// (v0.2.243). Run after `vite build` (wired into the npm `build` script; also runnable
// standalone as `npm run zones:shells`). For each slug in DEPLOYABLE_ZONE_SLUGS it writes
// a byte-identical copy of dist/index.html to the directory-index file
// dist/zone/<slug>/index.html, so the exact-path static host resolves the canonical
// trailing-slash `/zone/<slug>/` URL onto that nested `.html` file and serves it as
// renderable `text/html` (the v0.2.242 extensionless file served as octet-stream and made
// browsers DOWNLOAD it). dist/index.html uses root-absolute asset URLs (`/assets/...`), so
// the shell loads the same bundle regardless of its path depth.
//
// SAFE by construction: it only READS dist/index.html and WRITES under dist/zone/*. It
// touches no source file, no server, no network, no secrets — it is a pure build artifact
// step. The path planning lives in the pure tools/zoneShells.mjs (unit-tested); this file
// only does the fs work. Exits non-zero on a real failure (missing dist build, bad slug).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DEPLOYABLE_ZONE_SLUGS } from '../src/engine/gateway/zoneRoute.js';
import { planZoneShells } from './zoneShells.mjs';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const INDEX = join(DIST, 'index.html');

function main() {
  if (!existsSync(INDEX)) {
    console.error('[zone-shells] dist/index.html not found — run `vite build` first.');
    process.exit(1);
  }
  const plan = planZoneShells(DEPLOYABLE_ZONE_SLUGS);
  if (!plan.ok) {
    for (const e of plan.errors) console.error(`[zone-shells] ${e}`);
    process.exit(1);
  }
  const shell = readFileSync(INDEX, 'utf8');
  let written = 0;
  for (const { slug, path } of plan.shells) {
    const out = join(DIST, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, shell);
    console.log(`[zone-shells] wrote ${path} (shell for /zone/${slug})`);
    written += 1;
  }
  console.log(`[zone-shells] ${written} zone shell(s) generated from dist/index.html`);
}

main();
