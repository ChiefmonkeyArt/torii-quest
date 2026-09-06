// engine/character/glbInspect.js — pure GLB (glTF-binary) reader for the
// Character Forge "upload your own mesh" validator. No THREE/DOM; node-safe
// and allocation-disciplined (a single DataView over the input buffer, one
// JSON text decode).
//
// This is the CLIENT half of the validator-first pipeline: it reads the raw
// bytes of an uploaded .glb, walks its chunks to find the glTF JSON, and pulls
// out the node/bone structure (bone names from skins[].joints) so the caller
// can run assessRig() against the canonical skeleton contract (skeleton.js).
// It does NOT touch the mesh geometry — it only reasons about the skeleton.

export const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
export const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"
export const BIN_CHUNK_TYPE = 0x004e4942; // "BIN\0"
export const GLB_HEADER_BYTES = 12;
export const MAX_CHARACTER_GLB_BYTES = 50 * 1024 * 1024; // 50 MiB

function _fail(error) {
  return { ok: false, version: null, nodeCount: 0, meshCount: 0, boneCount: 0, boneNames: [], error };
}

function _decodeUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  // Node/browser ships TextDecoder as a global; this fallback is for exotic
  // runtimes only and stays Latin-1-safe (GLB JSON is UTF-8 but ASCII for the
  // structure we read: node names are decoded lossily here only as a last resort).
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

function _formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// inspectGlb(input, opts) → { ok, version, nodeCount, meshCount, boneCount, boneNames, error }
//   input — ArrayBuffer, Uint8Array, or any ArrayBuffer view (e.g. DataView).
//   opts.maxBytes — optional override of the size cap (bytes).
export function inspectGlb(input, opts = {}) {
  const maxBytes = (typeof opts.maxBytes === 'number' && opts.maxBytes > 0)
    ? opts.maxBytes : MAX_CHARACTER_GLB_BYTES;

  if (input == null) return _fail('No data provided.');
  let bytes;
  if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else return _fail('Unsupported data type — expected an ArrayBuffer or typed array.');

  if (bytes.byteLength < GLB_HEADER_BYTES) return _fail('File is too small to be a .glb.');
  if (bytes.byteLength > maxBytes) {
    return _fail(`File is ${_formatMb(bytes.byteLength)} — the limit is ${_formatMb(maxBytes)}.`);
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Header: magic (4) + version (4) + total length (4). Endianness is little.
  if (dv.getUint32(0, true) !== GLB_MAGIC) return _fail('Not a .glb file — bad glTF magic header.');
  const version = dv.getUint32(4, true);

  // Walk chunks to the JSON chunk (the first chunk per the glTF 2.0 spec).
  // chunkLength is the length of chunkData (NOT including the 8-byte header).
  let jsonText = null;
  let offset = GLB_HEADER_BYTES;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    if (chunkLen < 0 || offset + 8 + chunkLen > bytes.byteLength) break;
    if (chunkType === JSON_CHUNK_TYPE) {
      jsonText = _decodeUtf8(bytes.subarray(offset + 8, offset + 8 + chunkLen));
      break;
    }
    offset += 8 + chunkLen;
  }
  if (jsonText == null) return _fail('The .glb file has no JSON chunk.');

  let gltf;
  try {
    gltf = JSON.parse(jsonText);
  } catch {
    return _fail('The .glb JSON chunk is corrupt and could not be parsed.');
  }

  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const skins = Array.isArray(gltf.skins) ? gltf.skins : [];

  // Bone names = nodes referenced by any skin's joints. A node may be jointed
  // by multiple skins; the Set dedupes via integer index.
  const boneIndices = new Set();
  for (let s = 0; s < skins.length; s += 1) {
    const skin = skins[s];
    if (skin && Array.isArray(skin.joints)) {
      for (let j = 0; j < skin.joints.length; j += 1) boneIndices.add(skin.joints[j]);
    }
  }
  const boneNames = [];
  for (const idx of boneIndices) {
    const n = nodes[idx];
    boneNames.push((n && typeof n.name === 'string' && n.name) ? n.name : `node_${idx}`);
  }

  return {
    ok: true,
    version,
    nodeCount: nodes.length,
    meshCount: Array.isArray(gltf.meshes) ? gltf.meshes.length : 0,
    boneCount: boneNames.length,
    boneNames,
    error: null,
  };
}