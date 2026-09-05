// tools/server-stubs/native-stub.js — empty stand-in for native/image modules
// (sharp, ndarray-pixels) that the server bundle no longer needs.
//
// v0.2.771-alpha removed the WebP texture-compression pass from the headless-GLB
// endpoint (its only server consumer of sharp/ndarray-pixels), but
// @gltf-transform/functions still has a TOP-LEVEL `import { getPixels, savePixels }
// from "ndarray-pixels"` (which imports sharp). esbuild does not tree-shake that
// chain because sharp/ndarray-pixels ship no `sideEffects: false`, so it inlines
// sharp.mjs — whose `import.meta.url` becomes undefined in the CJS output and
// crashes the server with `createRequire(undefined)`.
//
// Aliasing these two names to this empty module removes them from the bundle
// entirely (the textureCompress code path that used them is already dead). See
// the `--alias:*` flags on the `build:server` script in package.json.
//
// The named exports exist only so esbuild's export-matching passes BEFORE
// tree-shaking drops the dead textureCompress body; nothing at runtime ever
// calls them.
export const getPixels = undefined;
export const savePixels = undefined;
export default undefined;