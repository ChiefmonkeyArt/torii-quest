// tests/server-bundle-external.test.js — locks the v0.2.769-alpha server-bundle
// fix. The v0.2.767-alpha headless-GLB feature pulled `sharp` (a native, ESM
// module) into the esbuild server bundle via @gltf-transform/functions →
// ndarray-pixels → sharp. esbuild's CJS output rewrote sharp's top-level
// `import.meta.url` to an empty object, so `createRequire(import_meta.url)`
// threw `ERR_INVALID_ARG_VALUE (Received undefined)` at startup and
// torii-arena-ws crashed in a restart loop (down since v0.2.767).
//
// Fix: mark `sharp` external in build:server so the native module is resolved
// at runtime by Node (sharp is dual CJS/ESM) instead of being (incorrectly)
// inlined. This static-contract test freezes that invariant.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const LOCK = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const LOCK_PKGS = LOCK.packages || {};

describe('v0.2.769 — server bundle keeps native `sharp` external', () => {
  it('build:server marks ws and sharp external', () => {
    const cmd = PKG.scripts['build:server'] || '';
    // `--format=cjs` is required here: native modules must resolve via
    // require() at runtime, never be inlined by esbuild.
    expect(cmd).toMatch(/--format=cjs/);
    expect(cmd).toMatch(/--external:ws/);
    expect(cmd).toMatch(/--external:sharp/);
  });

  it('sharp remains a reachable production dependency (installed by npm --omit=dev)', () => {
    // sharp is pulled transitively via ndarray-pixels (itself a dep of
    // @gltf-transform/functions). It must be present in the lockfile and NOT
    // a devDependency, or the VPS `npm install --omit=dev` would skip it and
    // require("sharp") would fail at runtime.
    const dep = LOCK_PKGS['node_modules/sharp'];
    expect(dep).toBeDefined();
    expect(dep.version).toMatch(/^0\.3[0-9]\./);
    // ndarray-pixels → sharp pins the runtime chain so --omit=dev installs it.
    const chain = LOCK_PKGS['node_modules/ndarray-pixels'];
    expect(chain).toBeDefined();
    expect(chain.dependencies?.sharp).toBeDefined();
  });
});