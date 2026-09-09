// engine/character/characterPortraitRenderer.js — render a character GLB to a
// PNG portrait offscreen. Browser-only (needs a canvas + WebGL); the pure
// manifest/URL seams this feeds are tested in node.
//
// A character's "portrait" is a small, transparent-background snapshot of the
// uploader's mesh, used as their avatar image across the UI (settings panel,
// in-world player lists, listings) instead of a bare initial. This module owns
// the render half: load a GLB, stand it upright (same Z-up fix as playerModel),
// frame it in a lens, light it with a neutral studio setup, and rasterise to a
// PNG blob. The caller uploads that blob to Blossom and stores its sha256 in
// the manifest's portrait.hash.
//
// renderCharacterPortrait(sourceUrl, opts) → Promise<{ ok, blob, error }>
//   sourceUrl — a fetchable URL (local object URL or Blossom) for a GLB.
//   opts.size  — square output size in px (default 512).
//   opts.limit — max GLB bytes to load (default 64 MiB; rejects oversized).
// Never throws; a WebGL-less environment / load failure resolves { ok:false }.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { assetUrl } from '../../assetUrl.js';

export const PORTRAIT_SIZE = 256;
const MAX_MESH_BYTES = 64 * 1024 * 1024;

function _safeSourceUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return null;
  // local blob: / data: URLs feed an in-memory upload; https feeds Blossom.
  if (/^(blob:|data:|https:)/i.test(url)) return url;
  return null;
}

// _standUpright(root) — orient the loaded scene so it faces the camera standing
// on its feet. Mirrors the playerModel Z-up fix: when the geometry's Z extent
// dominates its Y extent, the GLB is Z-up (authored lying along Z), so rotate
// +90° about X and yaw 180° to face +Z.
function _standUpright(root) {
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      if (!b) return;
      minY = Math.min(minY, b.min.y); maxY = Math.max(maxY, b.max.y);
      minZ = Math.min(minZ, b.min.z); maxZ = Math.max(maxZ, b.max.z);
    }
  });
  const isZUp = (maxZ - minZ) > (maxY - minY) * 1.2;
  if (isZUp) {
    const standUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const faceCamera = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    root.quaternion.copy(faceCamera).multiply(standUp);
  } else {
    root.rotation.y = Math.PI; // face +Z
  }
  return isZUp;
}

export async function renderCharacterPortrait(sourceUrl, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const size = Number.isFinite(o.size) && o.size > 0 ? Math.floor(o.size) : PORTRAIT_SIZE;
  const limit = Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : MAX_MESH_BYTES;

  const url = _safeSourceUrl(sourceUrl);
  if (!url) return { ok: false, blob: null, error: 'bad-url' };
  if (typeof document === 'undefined') return { ok: false, blob: null, error: 'no-document' };

  let canvas = null;
  let renderer = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, preserveDrawingBuffer: true,
    });
  } catch {
    return { ok: false, blob: null, error: 'no-webgl' };
  }
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0); // transparent background

  const scene = new THREE.Scene();
  // Neutral studio lighting: soft ambient + a key + a cool fill, no harsh rim.
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
  fill.position.set(-4, 2, 2);
  scene.add(fill);

  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl('/draco/'));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  let gltf;
  try {
    // Enforce the size cap by pre-fetching headers where possible; the loader
    // itself then proceeds. A resource that reports no length still loads, but
    // the cap is a best-effort guard against a pathological response.
    if (!/^(blob:|data:)/i.test(url) && typeof fetch === 'function') {
      const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
      const len = head && Number(head.headers.get('content-length'));
      if (Number.isFinite(len) && len > limit) {
        return { ok: false, blob: null, error: 'mesh-too-large' };
      }
    }
    gltf = await loader.loadAsync(url);
  } catch (err) {
    return { ok: false, blob: null, error: 'load-failed: ' + ((err && err.message) || err) };
  }
  const root = gltf.scene;
  scene.add(root);

  // Patch materials for a clean opaque render (GLB exports with alphaMode BLEND
  // otherwise split apart / show through), then orient upright.
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (o.geometry && !o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.transparent = false;
        m.depthWrite = true;
        m.alphaTest = 0;
        if (m.flatShading) m.flatShading = false;
        m.needsUpdate = true;
      }
    }
  });
  _standUpright(root);
  root.updateMatrixWorld(true);

  // Frame the geometry (post-orient) with breathing room.
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const dims = box.getSize(new THREE.Vector3());
  const radius = Math.max(dims.x, dims.y, dims.z) / 2 || 1;
  const fov = THREE.MathUtils.degToRad(35);
  const dist = (radius / Math.tan(fov / 2)) * 1.35; // padding so it never clips edges
  const camera = new THREE.PerspectiveCamera(35, 1, Math.max(0.01, dist / 100), dist * 4);
  // The model's forward is -Z after _standUpright (same convention as
  // playerModel), so place the lens on the -Z side to photograph the face, not
  // the back.
  camera.position.set(center.x, center.y, center.z - dist);
  camera.lookAt(center);

  renderer.render(scene, camera);

  const blob = await new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b || null), 'image/png'); }
    catch { resolve(null); }
  });

  // Release the WebGL context + decode resources promptly.
  try { draco.dispose(); } catch { /* no-op */ }
  try { renderer.dispose(); } catch { /* no-op */ }
  try { if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch { /* no-op */ }

  if (!blob) return { ok: false, blob: null, error: 'encode-failed' };
  return { ok: true, blob, error: null };
}