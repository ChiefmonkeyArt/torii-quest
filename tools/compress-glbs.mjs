// Draco-compress GLB files using gltf-transform.
// Usage: node tools/compress-glbs.mjs
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { prune, dedup, quantize, draco } from '@gltf-transform/functions';
import { createEncoderModule } from 'draco3d';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const TARGETS = [
  'models/chiefmonkey7.glb',
  'chiefmonkey-npc-animations.glb',
  'augustink4.glb',
  'models/animation-library.glb',
];

const encoderModule = await createEncoderModule();

function fmt(bytes) {
  return bytes > 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + 'MB'
    : (bytes / 1024).toFixed(0) + 'KB';
}

let totalBefore = 0, totalAfter = 0;

for (const rel of TARGETS) {
  const path = join(publicDir, rel);
  if (!existsSync(path)) {
    console.log(`SKIP (not found): ${rel}`);
    continue;
  }

  const beforeBytes = statSync(path).size;
  totalBefore += beforeBytes;
  console.log(`\nProcessing: ${rel} (${fmt(beforeBytes)})`);

  // Read GLB
  const io = new NodeIO()
    .setLogger(new Logger(Logger.WARN))
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.encoder': encoderModule,
    });

  const doc = await io.read(path);

  // Optimize: remove unused, dedup, quantize
  await prune(doc);
  await dedup(doc);
  await quantize(doc);

  // Draco compress
  await doc.transform(
    draco({
      method: 'edgebreaker',
      encodeSpeed: 5,
      decodeSpeed: 5,
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeColor: 8,
      quantizeTexcoord: 12,
      quantizeGeneric: 12,
    }),
  );

  // Write compressed output
  await io.write(path, doc);
  const afterBytes = statSync(path).size;
  totalAfter += afterBytes;

  console.log(`  Before: ${fmt(beforeBytes)}`);
  console.log(`  After:  ${fmt(afterBytes)}`);
  console.log(`  Saved:  ${((1 - afterBytes / beforeBytes) * 100).toFixed(0)}% (${fmt(beforeBytes - afterBytes)})`);
}

console.log(`\n=== TOTAL ===`);
console.log(`Before: ${fmt(totalBefore)}`);
console.log(`After:  ${fmt(totalAfter)}`);
console.log(`Saved:  ${((1 - totalAfter / totalBefore) * 100).toFixed(0)}% (${fmt(totalBefore - totalAfter)})`);
