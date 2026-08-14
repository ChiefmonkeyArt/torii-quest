import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GAME_STATE_TO_CLIP } from '../../src/engine/animationLibrary.js';

const glbUrl = new URL('../../public/models/animation-library.glb', import.meta.url);

async function readAndParseLibrary() {
  const file = await readFile(fileURLToPath(glbUrl));
  const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  globalThis.self ??= globalThis;
  globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  return { file, gltf };
}

describe('shared animation library GLB', () => {
  it('exists and starts with the binary glTF magic', async () => {
    const file = await readFile(fileURLToPath(glbUrl));
    expect(file.subarray(0, 4).toString('ascii')).toBe('glTF');
  });

  it('contains the expected named clips and channel counts', async () => {
    const { gltf } = await readAndParseLibrary();
    const clipNames = gltf.animations.map((clip) => clip.name);

    expect(gltf.animations).toHaveLength(18);
    expect(clipNames.some((name) => name.startsWith('019'))).toBe(false);

    for (const mappedName of Object.values(GAME_STATE_TO_CLIP)) {
      expect(clipNames).toContain(mappedName);
    }

    for (const clip of gltf.animations) {
      expect(clip.tracks).toHaveLength(72);
      const rotationOnly = clip.tracks.filter((track) =>
        track.name.endsWith('.quaternion'),
      );
      expect(rotationOnly).toHaveLength(24);
      expect(rotationOnly.every((t) => t instanceof THREE.QuaternionKeyframeTrack)).toBe(true);
    }
  });
});
