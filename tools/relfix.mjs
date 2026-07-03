// Post-build: rewrite absolute /assets/ and runtime /foo.ext asset refs to
// relative paths so the dist works under a subpath deploy (e.g. sites.pplx.app
// proxy or any non-root hosting).
//
// Depth-aware: a file in dist/assets/ referencing /assets/X must resolve to
// ./X (peer in the same dir), NOT ./assets/X (which would point to
// dist/assets/assets/X and 404). Only dist/index.html (depth 0) keeps the
// ./assets/ prefix. Other root-level targets (/draco/, /sounds/, root GLBs)
// climb back up to the dist root with ../ when referenced from a sub-dir.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const dir = join(process.cwd(), 'dist');
const indexP = join(dir, 'index.html');

// Match "/path.ext" or '/path.ext' or `/path.ext` where path starts with a
// lowercase letter and ends in a known asset ext, or is /draco/ or /sounds/...
const ABS_RE = /(['"`])\/(assets\/|draco\/|sounds\/|banker-rigged\.glb|bitcoin-b\.png|chiefmonkey-headless\.glb|chiefmonkey6\.glb|gun-steampunk\.glb|nostrich3\.glb|torii-gate\.glb|torii-gateway-experience\.glb|torii-gate\.png|wall-texture\.jpg|wall-texture\.webp|sw\.js|continuum-data\.json)/g;

// Depth of the file's directory below dist/ (0 = dist root, 1 = dist/assets/).
function depthOf(filePath) {
  const fileDir = dirname(filePath);
  if (fileDir === dir) return 0;
  // relative segments from dist root to the file's dir, e.g. "assets" → 1
  const rel = fileDir.slice(dir.length).replace(/^\//, '');
  return rel ? rel.split('/').filter(Boolean).length : 0;
}

// Rewrite absolute "/<rest>" references for a file at filePath.
function fixFor(src, filePath) {
  const depth = depthOf(filePath);
  return src.replace(ABS_RE, (_m, q, rest) => {
    if (rest.startsWith('assets/')) {
      // Target lives in dist/assets/.
      if (depth === 0) return `${q}./${rest}`;          // index.html → ./assets/X
      return `${q}./${rest.slice('assets/'.length)}`;   // assets/foo.js → ./X (peer)
    }
    // draco/, sounds/, root GLBs: climb to dist root then descend.
    if (depth === 0) return `${q}./${rest}`;
    return `${q}${'../'.repeat(depth)}${rest}`;
  });
}

// Bare "assets/..." specifiers (no leading / or ./) are invalid module
// specifiers; normalise them relative to the file's location too.
function fixBareFor(src, filePath) {
  const depth = depthOf(filePath);
  return src.replace(/(['"`])assets\//g, (_m, q) => {
    // bare "assets/X" — for depth 0 keep ./assets/, for depth 1 use ./
    return depth === 0 ? `${q}./assets/` : `${q}./`;
  });
}

function processFile(filePath) {
  let src = readFileSync(filePath, 'utf8');
  let out = fixFor(src, filePath);
  out = fixBareFor(out, filePath);
  if (out !== src) writeFileSync(filePath, out);
}

// index.html (depth 0)
processFile(indexP);

// chunks in dist/assets/ (depth 1)
const assetsDir = join(dir, 'assets');
if (existsSync(assetsDir)) {
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith('.js')) continue;
    processFile(join(assetsDir, f));
  }
}
console.log('relfix: rewrote absolute asset paths to relative (depth-aware)');
