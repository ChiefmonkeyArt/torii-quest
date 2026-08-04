// engine/gateway/portalMesh.js — the browser-only THREE adapter for the dedicated
// in-world GATEWAY PORTAL marker (v0.2.183, LEAN-2). It consumes the PURE render plan
// (`portalMeshPlan.js`) and, only when the plan is ok and a scene is given, creates a
// small set of inert marker meshes ONCE at the portal trigger position.
//
// DISPLAY-ONLY and INERT: no collider, no raycast/click handler, no input, no
// navigation, no payments, no Nostr/relay/signing, and no live data. The only asset
// request is the bundled sats-symbol GLB. The marker is a visual landmark only; the
// safety model (proximity arms, KeyF confirms, same-origin /zone/ only) is unchanged
// — this module adds NO capability.
//
// ALLOCATION DISCIPLINE: every THREE object is created EXACTLY ONCE in
// `buildPortalMesh()` (scene-setup, not a hot path). `tickPortalMesh(dt)` mutates ONLY
// existing scalars (rotation.y, material.emissiveIntensity) — it allocates NO Vector3/
// Matrix4/geometry/material per frame, so the no-alloc hot-path rule is preserved. A
// `_built` guard makes re-entry a no-op; `disposePortalMesh()` frees the geometries +
// materials and detaches the group for a clean teardown.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { assetUrl } from '../../assetUrl.js';
import { buildPortalMeshPlan, PORTAL_MESH_BADGE, PORTAL_MESH_GROUP } from './portalMeshPlan.js';

// Module-scope handles, all created once. Refs kept so the tick can mutate scalars and
// dispose can free GPU resources without re-querying the scene graph.
let _built = false;
let _glbLoaded = false;
let _buildId = 0;        // invalidates an in-flight GLB load on dispose/rebuild
let _group = null;
let _scene = null;
let _spinMeshes = [];   // meshes/groups whose rotation.y advances each tick
let _pulseMats = [];     // materials whose emissiveIntensity breathes each tick
let _approachMats = [];  // marker materials the host brightens on approach
let _approachBase = [];  // each approach material's emissiveIntensity baseline
let _geometries = [];    // every geometry created, for dispose
let _materials = [];     // every material created, for dispose
let _t = 0;              // accumulator for the pulse phase (seconds)

// Render state mirrored for the debug surface. Frozen so a reader can never mutate it.
let _state = Object.freeze({ rendered: false, count: 0, ok: false, badge: PORTAL_MESH_BADGE, reasons: ['not-built'] });

// portalMeshRenderState() → the last build result (read-only). Surfaced at
// ToriiDebug.shells.portalMesh() so a reviewer can confirm the inert marker rendered.
export function portalMeshRenderState() { return _state; }

// _geometryFor(part) → a THREE primitive from the plan's param-only geometry spec.
// One-time creation; unknown types fall back to a tiny box so a build never throws.
function _geometryFor(g) {
  switch (g && g.type) {
    case 'torus':
      return new THREE.TorusGeometry(g.radius, g.tube, g.radialSegments, g.tubularSegments);
    case 'cylinder':
      return new THREE.CylinderGeometry(g.radiusTop, g.radiusBottom, g.height, g.radialSegments);
    case 'box':
      return new THREE.BoxGeometry(g.width, g.height, g.depth);
    default:
      return new THREE.BoxGeometry(0.2, 0.2, 0.2);
  }
}

// _materialFor(part) → the shared glowing material for one plan part.
function _materialFor(part) {
  return new THREE.MeshStandardMaterial({
    color: part.color,
    emissive: part.color,
    emissiveIntensity: part.emissiveIntensity,
    roughness: 0.5,
    metalness: 0.0,
    transparent: !!part.transparent,
    opacity: typeof part.opacity === 'number' ? part.opacity : 1,
  });
}

function _disposeLoaded(geometries, materials) {
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

// _loadSatsSymbol(part, group, buildId) → loads the bundled Draco GLB in the
// background. A wrapper remains at the exact plan position while the model is
// uniformly centred/scaled inside it to the old core's approximate 0.7-unit height.
async function _loadSatsSymbol(part, group, buildId) {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(assetUrl('/draco/'));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);

  try {
    const gltf = await loader.loadAsync(part.geometry.src);
    const model = gltf && gltf.scene;
    if (!model) return;

    const geometries = new Set();
    const materials = new Set();
    const approachBases = new Map();
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (!material || materials.has(material)) continue;

        // Preserve all PBR textures from the GLB. Override metalness/roughness
        // because the scene has no environment map - fully metallic surfaces (the
        // GLB default) render black without one. Low metalness lets the base
        // color texture dominate; roughness gives specular response to scene lights.
        material.metalness = 0.15;
        material.roughness = 0.65;

        // Subtle emissive baseline for the approach-glow mechanism (won't wash
        // out the base color at this intensity).
        const baseEmissiveIntensity = 0.02;
        if (material.emissive) {
          if (material.emissive.getHex() === 0) material.emissive.setHex(part.color);
          material.emissiveIntensity = baseEmissiveIntensity;
        }
        material.needsUpdate = true;
        materials.add(material);
        approachBases.set(material, baseEmissiveIntensity);
      }
    });

    // A disposed/rebuilt marker must never receive a stale asynchronous result.
    if (!_built || buildId !== _buildId || group !== _group) {
      _disposeLoaded(geometries, materials);
      return;
    }

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = 0.7 / (size.y || 1);
    model.scale.multiplyScalar(scale);
    box.setFromObject(model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    model.position.sub(center);

    const wrapper = new THREE.Group();
    wrapper.position.set(part.position.x, part.position.y, part.position.z);
    wrapper.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
    wrapper.add(model);
    group.add(wrapper);

    geometries.forEach((geometry) => _geometries.push(geometry));
    materials.forEach((material) => {
      _materials.push(material);
      if (part.pulse) _pulseMats.push(material);
      if (part.approach) {
        _approachMats.push(material);
        _approachBase.push(approachBases.get(material));
      }
    });
    if (part.spin) _spinMeshes.push(wrapper);
    _glbLoaded = true;
  } catch {
    // The outer ring remains usable if the optional visual asset cannot load.
  } finally {
    dracoLoader.dispose();
  }
}

// buildPortalMesh(scene, opts?) → builds the inert portal marker in `scene` IF the
// plan is ok, else builds NOTHING. `opts` is forwarded to the plan (position/range/
// title — typically the live trigger's portalPos()/range()). Idempotent: only the
// first successful build renders; later calls are no-ops. Returns the render state.
export function buildPortalMesh(scene, opts = {}) {
  if (_built) return _state;

  const plan = buildPortalMeshPlan(opts);
  if (!plan.ok || !scene) {
    const reasons = plan.reasons.length ? plan.reasons.slice() : [];
    if (!scene) reasons.push('no-scene');
    _state = Object.freeze({ rendered: false, count: 0, ok: false, badge: plan.badge, reasons });
    return _state;
  }

  const group = new THREE.Group();
  group.name = PORTAL_MESH_GROUP;
  group.position.set(plan.anchor.x, plan.anchor.y, plan.anchor.z);

  const glbParts = [];
  for (const part of plan.parts) {
    if (part.geometry && part.geometry.type === 'sats-symbol-glb') {
      glbParts.push(part);
      continue;
    }
    // A glowing emissive standard material — the same family the proof-surface boards
    // and arena floor use, so no new shader/asset is introduced.
    const mat = _materialFor(part);
    const geom = _geometryFor(part.geometry);
    const object = new THREE.Mesh(geom, mat);
    object.castShadow = false;
    object.receiveShadow = false;
    _geometries.push(geom);
    object.position.set(part.position.x, part.position.y, part.position.z);
    object.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
    // INERT: no collider, no userData behaviour, no raycast layer change. It is a
    // pure visual; nothing reads input or ticks it except the scalar spin/pulse below.
    group.add(object);

    _materials.push(mat);
    if (part.spin) _spinMeshes.push(object);
    if (part.pulse) _pulseMats.push(mat);
    if (part.approach) { _approachMats.push(mat); _approachBase.push(mat.emissiveIntensity); }
  }

  scene.add(group);
  _group = group;
  _scene = scene;
  _built = true;
  _glbLoaded = false;
  const buildId = ++_buildId;
  for (const part of glbParts) void _loadSatsSymbol(part, group, buildId);
  _state = Object.freeze({ rendered: true, count: plan.parts.length, ok: true, badge: plan.badge, reasons: [], anchor: Object.freeze({ ...plan.anchor }), ringRadius: plan.ringRadius });
  return _state;
}

// tickPortalMesh(dt) → advance the marker's idle animation. Allocation-free: it only
// mutates existing scalars (rotation.y on the spin meshes, emissiveIntensity on the
// pulse materials). No Vector3/Matrix4/geometry/material is created. Safe to call
// every frame; a no-op until the marker is built.
export function tickPortalMesh(dt) {
  if (!_built) return;
  const d = typeof dt === 'number' && Number.isFinite(dt) ? dt : 0;
  _t += d;
  if (_glbLoaded) {
    for (let i = 0; i < _spinMeshes.length; i++) {
      _spinMeshes[i].rotation.y += d * 0.8; // slow idle spin
    }
  }
  if (_pulseMats.length) {
    // Gentle breathing in [0.4, 0.7]; a scalar sin, no allocation.
    const e = 0.55 + Math.sin(_t * 1.6) * 0.15;
    for (let i = 0; i < _pulseMats.length; i++) {
      _pulseMats[i].emissiveIntensity = e;
    }
  }
}

// setPortalApproach(intensity) → drive the marker glow as the player approaches.
// `intensity` is a host-computed scalar (typically from the PURE `portalApproach.js`
// view-model). Allocation-free: it scales each approach material's emissiveIntensity
// around its plan baseline, so a near player makes the gate visibly "wake". A no-op
// until the marker is built or when given a non-finite value. Adds NO capability —
// the marker stays inert; only a display scalar changes.
export function setPortalApproach(intensity) {
  if (!_built || !_glbLoaded || !_approachMats.length) return;
  if (typeof intensity !== 'number' || !Number.isFinite(intensity)) return;
  const k = intensity < 0 ? 0 : intensity > 1.5 ? 1.5 : intensity;
  for (let i = 0; i < _approachMats.length; i++) {
    // Blend the baseline with the approach scalar so each part keeps its relative
    // brightness while the marker lifts as one. Pure scalar write, no allocation.
    _approachMats[i].emissiveIntensity = _approachBase[i] * 0.5 + k;
  }
}

// disposePortalMesh() → detach the group and free every geometry + material. Resets
// the build guard so a later build can re-create the marker. For a clean teardown
// (e.g. a future scene reset); the live app builds once and never disposes.
export function disposePortalMesh() {
  _buildId += 1;
  if (_group && _scene) _scene.remove(_group);
  for (let i = 0; i < _geometries.length; i++) _geometries[i].dispose();
  for (let i = 0; i < _materials.length; i++) _materials[i].dispose();
  _group = null;
  _scene = null;
  _spinMeshes = [];
  _pulseMats = [];
  _approachMats = [];
  _approachBase = [];
  _geometries = [];
  _materials = [];
  _t = 0;
  _built = false;
  _glbLoaded = false;
  _state = Object.freeze({ rendered: false, count: 0, ok: false, badge: PORTAL_MESH_BADGE, reasons: ['disposed'] });
}
