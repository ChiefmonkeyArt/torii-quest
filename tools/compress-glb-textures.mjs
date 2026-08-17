// Compress textures inside GLB files + Draco compress meshes.
// Usage: node tools/compress-glb-textures.mjs
import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, quantize, draco, textureCompress } from '@gltf-transform/functions';
import { createEncoderModule, createDecoderModule } from 'draco3d';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const TARGETS = [
  'augustink4.glb',
  'models/chiefmonkey7.glb',
  'chiefmonkey-npc-animations.glb',
  'models/animation-library.glb',
];

const encoder = await createEncoderModule();
const decoder = await createDecoderModule();

function fmt(bytes) {
  return bytes > 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + 'MB'
    : (bytes / 1024).toFixed(0) + 'KB';
}

let totalBefore = 0, totalAfter = 0;

for (const rel of TARGETS) {
  const path = join(publicDir, rel);
  const beforeBytes = statSync(path).size;
  totalBefore += beforeBytes;
  console.log(`\nProcessing: ${rel} (${fmt(beforeBytes)})`);

  const io = new NodeIO()
    .setLogger(new Logger(Logger.WARN))
    .registerExtensions([KHRDracoMeshCompression, EXTTextureWebP])
    .registerDependencies({ 'draco3d.encoder': encoder, 'draco3d.decoder': decoder });

  const doc = await io.read(path);
  const root = doc.getRoot();

  // Log texture info
  const textures = root.listTextures();
  if (textures.length > 0) {
    textures.forEach((t, i) => {
      const img = t.getImage();
      console.log(`  Texture[${i}]: ${t.getMimeType()} ${img ? fmt(img.byteLength) : 'no data'}`);
    });
  }

  // Optimize
  await prune(doc);
  await dedup(doc);
  await quantize(doc);

  // Compress textures to WebP (lossless quality)
  if (textures.length > 0) {
    try {
      await doc.transform(
        textureCompress({
          targetFormat: 'webp',
          quality: 85,
        }),
      );
      console.log('  Textures compressed to WebP');
    } catch (e) {
      console.log('  Texture compression failed:', e.message);
    }
  }

  // Draco compress meshes
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
