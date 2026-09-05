// tools/write-server-runtime-manifest.mjs
//
// Emits dist/package.json — the "arena-ws runtime deps manifest" that
// torii-suite's install-quest.sh copies to /apps/quest/mp and against which it
// runs `npm install --omit=dev`. The esbuild `build:server` step EXTERNALIZES
// the modules below (native binaries and/or packages that read their own
// bundled files via __dirname — neither survives being inlined into the CJS
// bundle), so they must be installed as real runtime dependencies on the VPS.
//
// Invariant: SERVER_EXTERNALS here MUST match the `--external:*` flags on the
// `build:server` script in package.json. tests/server-bundle-external.test.js
// locks that agreement so the two cannot drift.
//
// Safety (no fs/network beyond writing one file): it only READS the root
// package.json version/dependency ranges and writes dist/package.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_EXTERNALS = ['ws', 'draco3d'];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const deps = pkg.dependencies || {};

const dependencies = {};
for (const name of SERVER_EXTERNALS) {
  const range = deps[name];
  if (typeof range !== 'string' || !range) {
    console.error(`write-server-runtime-manifest: "${name}" missing from package.json dependencies`);
    process.exit(1);
  }
  dependencies[name] = range;
}

const manifest = {
  name: 'torii-quest-arena-ws',
  private: true,
  description:
    'arena-ws runtime dependency manifest (generated at build time by tools/write-server-runtime-manifest.mjs)',
  version: pkg.version,
  main: 'server/arena-ws.cjs',
  dependencies,
};

const distDir = join(ROOT, 'dist');
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `[server-runtime-manifest] wrote dist/package.json (${SERVER_EXTERNALS.join(', ')})`
);