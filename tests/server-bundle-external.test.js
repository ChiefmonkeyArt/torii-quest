// tests/server-bundle-external.test.js — locks the server-bundle native/asset
// dependency fix (v0.2.769-alpha ++ v0.2.770-alpha).
//
// Two crash classes were introduced when the v0.2.767-alpha headless-GLB
// feature pulled @gltf-transform/functions → ndarray-pixels → sharp (native,
// ESM) and draco3d (reads its own draco_*.wasm via __dirname) into the esbuild
// server bundle:
//   * sharp — esbuild's CJS output rewrote sharp's top-level import.meta.url to
//     an empty object, so createRequire(import_meta.url) threw
//     ERR_INVALID_ARG_VALUE (undefined) and the server crashed at startup.
//   * sharp (again) + draco3d — being inlined means their runtime assets were
//     NOT installed: "Cannot find module 'sharp'", and draco3d would read
//     draco_*.wasm from the wrong __dirname at headless-authoring time.
//
// Fix: build:server externalizes ws/sharp/draco3d AND emits dist/package.json
// (the arena-ws runtime deps manifest torii-suite installs via
// `npm install --omit=dev`). This test freezes that invariant, including the
// agreement between the esbuild flags and the manifest's dependency list.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const LOCK = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const LOCK_PKGS = LOCK.packages || {};
const MANIFEST_TOOL = readFileSync(
  join(ROOT, 'tools/write-server-runtime-manifest.mjs'),
  'utf8'
);

const EXTERNALS = ['ws', 'sharp', 'draco3d'];

describe('server bundle keeps native/asset modules external', () => {
  it('build:server marks every externalized module external (CJS target)', () => {
    const cmd = PKG.scripts['build:server'] || '';
    expect(cmd).toMatch(/--format=cjs/);
    for (const name of EXTERNALS) {
      expect(cmd).toContain(`--external:${name}`);
    }
  });

  it('build:server writes the runtime manifest before bundling', () => {
    expect(PKG.scripts['build:server']).toContain(
      'node tools/write-server-runtime-manifest.mjs'
    );
  });

  it('the manifest tool externalizes the exact same modules', () => {
    // SERVER_EXTERNALS in the tool must agree with the --external flags above.
    const m = MANIFEST_TOOL.match(/SERVER_EXTERNALS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const declared = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(declared).toEqual(EXTERNALS);
  });

  it('every external module is a reachable production dependency', () => {
    // sharp and draco3d must be NON-dev deps present in the lock so
    // `npm install --omit=dev` against the generated manifest installs them
    // (sharp was previously only transitive via ndarray-pixels).
    for (const name of EXTERNALS) {
      const dep = LOCK_PKGS[`node_modules/${name}`];
      expect(dep, `${name} must be in the lockfile`).toBeDefined();
    }
    // sharp must be a DIRECT dependency (not just transitive) so the manifest
    // tool can read its version range from package.json.
    expect(PKG.dependencies?.sharp).toMatch(/^\^?0\.3[0-9]\./);
    expect(PKG.dependencies?.draco3d).toBeDefined();
    expect(PKG.dependencies?.ws).toBeDefined();
  });
});