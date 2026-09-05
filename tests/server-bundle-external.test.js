// tests/server-bundle-external.test.js — locks the server-bundle native/asset
// dependency fix (v0.2.769-alpha ++ v0.2.770-alpha ++ v0.2.771-alpha).
//
// The v0.2.767-alpha headless-GLB feature pulled @gltf-transform/functions →
// ndarray-pixels → sharp (native, ESM) and draco3d (reads its own draco_*.wasm
// via __dirname) into the esbuild server bundle:
//   * sharp — esbuild's CJS output rewrote sharp's top-level import.meta.url to
//     an empty object, so createRequire(import_meta.url) threw
//     ERR_INVALID_ARG_VALUE (undefined) and the server crashed at startup.
//   * draco3d — being inlined means its draco_*.wasm files are read from the
//     wrong __dirname at headless-authoring time.
//
// v0.2.769 externalized sharp; v0.2.770 added the runtime-deps manifest +
// externalized draco3d. v0.2.771 REMOVED sharp entirely: sharp's native binary
// + platform-specific optional deps were a fragile VPS install (version drift
// to 0.35.4 broke @img/sharp-linux-x64 exports → "No exports main defined"),
// so the optional WebP texture-compression pass was dropped in favour of a
// dependable server. Draco geometry compression remains.
//
// Invariant frozen here: build:server externalizes exactly ws + draco3d, the
// manifest declares the same set, sharp is absent, and draco3d stays a
// reachable production dependency.
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
const HEADLESS = readFileSync(
  join(ROOT, 'server/character/headlessGlb.js'),
  'utf8'
);

const EXTERNALS = ['ws', 'draco3d'];

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
    const m = MANIFEST_TOOL.match(/SERVER_EXTERNALS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const declared = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(declared).toEqual(EXTERNALS);
  });

  it('every external module is a reachable production dependency', () => {
    for (const name of EXTERNALS) {
      const dep = LOCK_PKGS[`node_modules/${name}`];
      expect(dep, `${name} must be in the lockfile`).toBeDefined();
      expect(PKG.dependencies?.[name], `${name} must be a direct dep`).toBeDefined();
    }
  });

  it('sharp is gone from the server headless path (no fragile native dep)', () => {
    // v0.2.771: the optional WebP (sharp) pass was removed — the only texture
    // consumer. headlessGlb must no longer import textureCompress, and sharp
    // must not be externalized nor a direct dependency, so a broken sharp
    // install can never keep arena-ws from starting again.
    expect(HEADLESS).not.toMatch(/textureCompress/);
    expect(PKG.scripts['build:server']).not.toContain('--external:sharp');
    expect(PKG.dependencies?.sharp).toBeUndefined();
  });
});