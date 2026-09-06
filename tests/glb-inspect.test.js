// tests/glb-inspect.test.js — locks the Character Forge client-side GLB reader
// (src/engine/character/glbInspect.js): header/chunk parsing, bone extraction,
// and its integration with assessRig (the validator-first pipeline).
import { describe, it, expect } from 'vitest';
import { inspectGlb, GLB_MAGIC, JSON_CHUNK_TYPE } from '../src/engine/character/glbInspect.js';
import { assessRig } from '../src/engine/character/rigAssessment.js';

// _buildGlb(gltf, version) → an in-memory .glb byte buffer with a single JSON
// chunk (chunkLength == chunkData length, per the glTF 2.0 spec, with the JSON
// padded to a 4-byte boundary using trailing spaces).
function buildGlb(gltf, version = 2) {
  const json = JSON.stringify(gltf);
  const enc = new TextEncoder().encode(json);
  const paddedLen = (enc.length + 3) & ~3;
  const padded = new Uint8Array(paddedLen);
  padded.set(enc);
  for (let i = enc.length; i < paddedLen; i += 1) padded[i] = 0x20; // space
  const total = 12 + 8 + paddedLen;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, version, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, paddedLen, true); // chunk length = chunkData length
  dv.setUint32(16, JSON_CHUNK_TYPE, true);
  buf.set(padded, 20);
  return buf;
}

// A full Mixamo-convention humanoid skeleton (every required role mapped).
function humanoidNodes() {
  const names = [
    'mixamorigHips', 'mixamorigSpine', 'mixamorigNeck', 'mixamorigHead',
    'mixamorigLeftShoulder', 'mixamorigRightShoulder',
    'mixamorigLeftArm', 'mixamorigRightArm', 'mixamorigLeftForeArm', 'mixamorigRightForeArm',
    'mixamorigLeftHand', 'mixamorigRightHand',
    'mixamorigLeftUpLeg', 'mixamorigRightUpLeg', 'mixamorigLeftLeg', 'mixamorigRightLeg',
    'mixamorigLeftFoot', 'mixamorigRightFoot',
  ];
  return names.map((name) => ({ name }));
}

function humanoidGltf() {
  const nodes = humanoidNodes();
  return {
    asset: { version: '2.0' },
    nodes,
    meshes: [{ name: 'body' }],
    skins: [{ joints: nodes.map((_, i) => i) }],
  };
}

describe('inspectGlb', () => {
  it('parses a valid GLB and extracts jointed bone names', () => {
    const out = inspectGlb(buildGlb(humanoidGltf()));
    expect(out.ok).toBe(true);
    expect(out.version).toBe(2);
    expect(out.nodeCount).toBe(18);
    expect(out.meshCount).toBe(1);
    expect(out.boneCount).toBe(18);
    expect(out.boneNames).toContain('mixamorigHips');
    expect(out.boneNames).toContain('mixamorigRightFoot');
  });

  it('accepts an ArrayBuffer and a Uint8Array interchangeably', () => {
    const bytes = buildGlb(humanoidGltf());
    const fromArray = inspectGlb(bytes.buffer.slice(0));
    const fromView = inspectGlb(bytes);
    expect(fromArray.boneCount).toBe(18);
    expect(fromView.boneCount).toBe(18);
  });

  it('rejects a bad magic header', () => {
    const bytes = buildGlb(humanoidGltf());
    bytes[0] = 0x00; // break the "glTF" magic
    const out = inspectGlb(bytes);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/magic/i);
  });

  it('rejects an undersized buffer', () => {
    const out = inspectGlb(new Uint8Array(4));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/too small/i);
  });

  it('rejects a file over the size cap', () => {
    const out = inspectGlb(buildGlb(humanoidGltf()), { maxBytes: 64 });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/limit/i);
  });

  it('rejects null input', () => {
    expect(inspectGlb(null).ok).toBe(false);
    expect(inspectGlb(undefined).ok).toBe(false);
  });

  it('reports no JSON chunk when absent', () => {
    // Craft a header-only buffer with a non-JSON chunk payload.
    const total = 12 + 8 + 4;
    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, GLB_MAGIC, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, 4, true);
    dv.setUint32(16, 0x004e4942, true); // "BIN\0" — wrong chunk type
    const out = inspectGlb(buf);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no JSON chunk/i);
  });

  it('reports a corrupt JSON chunk', () => {
    const total = 12 + 8 + 8;
    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, GLB_MAGIC, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, 8, true);
    dv.setUint32(16, JSON_CHUNK_TYPE, true);
    new TextEncoder().encodeInto('{not json', buf.subarray(20));
    const out = inspectGlb(buf);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/corrupt|parsed/i);
  });

  it('reports zero bones for an unrigged (skinless) GLB', () => {
    const gltf = { asset: { version: '2.0' }, nodes: [{ name: 'meshOnly' }], meshes: [{}] };
    const out = inspectGlb(buildGlb(gltf));
    expect(out.ok).toBe(true);
    expect(out.boneCount).toBe(0);
    expect(out.boneNames).toEqual([]);
  });
});

describe('glbInspect → assessRig integration (validator-first)', () => {
  it('a full humanoid GLB resolves as riggable', () => {
    const parsed = inspectGlb(buildGlb(humanoidGltf()));
    const rig = assessRig(parsed.boneNames);
    expect(rig.verdict).toBe('riggable');
  });

  it('an unrigged GLB resolves as no-bones', () => {
    const parsed = inspectGlb(buildGlb({ asset: { version: '2.0' }, nodes: [], meshes: [{}] }));
    const rig = assessRig(parsed.boneNames);
    expect(rig.verdict).toBe('no-bones');
  });
});