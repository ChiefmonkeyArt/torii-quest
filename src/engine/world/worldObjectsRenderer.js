// engine/world/worldObjectsRenderer.js — the THREE adapter for data-driven
// world objects (Phase 0e, chiefmonkey-template data extraction). Given a
// validated `world` object (from worldSchema.validateWorld, whose `objects`
// array is now validated) + the shared { scene, THREE }, it places visual-only
// meshes into the scene: primitive shapes (box/cylinder/plane) are built
// inline, and GLB models (type:'gltf' / 'torii-gate') are loaded async via the
// injected `loadGltf(path) → Promise<gltfScene>`. GLB loads are NON-FATAL: a
// failed load logs a warning + leaves a small placeholder box so the scene
// isn't empty, and never throws into the game loop.
//
// THREE-DEPENDENT + browser-only: this module imports `three` directly (like
// worldRenderer.js). It is only ever imported by arenaRuntime.js (the lazy
// ENTER ARENA chunk), which is itself three-dependent and never run in
// node/vitest. No node-safe leaf imports it, so it does not trip the regression
// -check node-safety rules (those only `node --check` the file — which passes —
// and apply to foundation/test leaves). The GLTFLoader is NOT imported here:
// `loadGltf` is injected by the caller (arenaRuntime) so this module stays
// unit-testable with a fake `loadGltf` (returns a stub Group) + a fake THREE
// (like the existing worldRenderer.test.js THREE stub).
//
// ALLOCATION DISCIPLINE: every THREE object is created EXACTLY ONCE in
// buildWorldObjects() (scene-setup, not a hot path). The returned tick(dt)
// mutates ONLY existing scalars (a subtle spin on objects flagged `spin:true`
// via userData) — it allocates NO Vector3/Matrix4/geometry/material per frame.
//
// Objects are VISUAL-ONLY in v1: no per-object physics colliders. The platform
// collider (from Phase 0b) remains the only walkable surface; objects are
// placed meshes on top. Asset safety is enforced upstream in worldSchema.js
// (_safeModelPath: relative only, no `..`, no protocol, .glb/.gltf only,
// ≤128 chars). The array is hard-capped at 64 entries there too.

import * as THREE from 'three';

// The named alias for the chiefmonkey gate GLB. type:'torii-gate' resolves to
// this model path when the manifest doesn't override it. This is the SAME root
// asset buildArena() loads (assetUrl('/torii-gate.glb')), referenced here as a
// relative path the caller resolves through assetUrl().
const TORII_GATE_MODEL = 'torii-gate.glb';

// Placeholder colour for a failed GLB load — a small dark box so the scene
// isn't empty and the failure is visually obvious (not a silent hole).
const PLACEHOLDER_COLOR = 0x442222;

// buildWorldObjects(world, opts) → { ready, tick }
//   world  — a validated world object (worldSchema.validateWorld result .world).
//   opts   — { scene, THREE, assetUrl, loadGltf, now } where:
//     scene    — the shared THREE.Scene (from scene.js).
//     THREE    — optional; the three namespace (passed in so the caller's
//                single import is used). Defaults to this module's own import.
//     assetUrl — optional; the assetUrl helper (from assetUrl.js) used to
//                resolve a model path against the Vite deploy base. When
//                omitted, the model path is passed to loadGltf as-is (tests).
//     loadGltf — optional; (path) → Promise<gltfScene>. Injected so the module
//                is unit-testable with a fake. When omitted, GLB objects are
//                skipped (placeholder only) — the arena wires the real loader.
//     now      — optional; () → ms timestamp (for spin phase seeding). Defaults
//                to Date.now.
//
// Returns:
//   { ready, tick }
//     ready — a Promise.allSettled of all GLB load promises, or null when
//             there are no GLB objects. Never rejects (allSettled). A failed
//             load logs a warning + leaves a placeholder; it never throws.
//     tick  — per-frame: subtle spin on objects flagged `spin`. No-op-safe.
//
// Never throws on a well-formed world; missing optional fields fall back to
// defaults. If `world`/`scene`/`THREE` is missing or world.objects is empty,
// returns a no-op tick + null ready so the caller can guard without a try/catch.
export function buildWorldObjects(world, opts = {}) {
  const { scene } = opts;
  const T = opts.THREE || THREE;
  if (!world || !scene || !T || !Array.isArray(world.objects) || world.objects.length === 0) {
    return { ready: null, tick() {} };
  }

  const assetUrlFn = typeof opts.assetUrl === 'function' ? opts.assetUrl : null;
  const loadGltf = typeof opts.loadGltf === 'function' ? opts.loadGltf : null;
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();

  const created = []; // track for a future dispose() (not exposed yet)
  const spinners = []; // objects flagged `spin` — tick mutates rotation.y only
  const loadPromises = []; // GLB load promises → ready (allSettled)

  for (const obj of world.objects) {
    if (!obj || typeof obj !== 'object') continue;

    // coastline-wall — collision-only segment-set; no visual mesh. The collider
    // builder expands it from its baked `source` JSON.
    if (obj.type === 'coastline-wall') continue;

    // visible === false → collision-only: skip the visual mesh entirely. The
    // collider is still built by buildWorldObjectColliders (which checks
    // `collider`, not `visible`). Used for legacy collision-only scenery
    // (torii pillars, coastline wall).
    if (obj.visible === false) continue;

    // Resolve position/rotation/scale (already validated + coerced by the schema).
    const pos = Array.isArray(obj.position) ? obj.position : [0, 0, 0];
    const rot = Array.isArray(obj.rotation) ? obj.rotation : null;
    const scale = obj.scale;
    const color = obj.color;

    if (obj.type === 'gltf' || obj.type === 'torii-gate') {
      // GLB load. Resolve the model path: torii-gate uses the named alias unless
      // the manifest overrides it; gltf uses its required model field.
      const modelPath = obj.type === 'torii-gate'
        ? (obj.model || TORII_GATE_MODEL)
        : obj.model;
      // Build a placeholder immediately so the scene isn't empty while the GLB
      // loads (or if it fails). A small dark box at the target position.
      const ph = _makePlaceholder(pos, rot, scale, T);
      scene.add(ph);
      created.push(ph);

      if (loadGltf && modelPath) {
        // Resolve through assetUrl when available (base-aware); tests pass no
        // assetUrl so the raw path reaches the fake loadGltf unchanged.
        const url = assetUrlFn ? assetUrlFn(modelPath) : modelPath;
        // The success path swaps the placeholder for the loaded model. The
        // failure path logs + leaves the placeholder. The `.catch()` is on a
        // FORKED promise (separate from `p`) so `p` preserves its rejection
        // status → `ready` (Promise.allSettled) sees it as 'rejected', while
        // the fork swallows the unhandled-rejection warning. Non-fatal either
        // way: the placeholder stays, the game loop never sees a throw.
        const p = Promise.resolve()
          .then(() => loadGltf(url))
          .then((gltfScene) => {
            const model = gltfScene && gltfScene.scene ? gltfScene.scene : gltfScene;
            if (!model) throw new Error('empty gltf scene');
            // Apply position/rotation/scale.
            model.position.set(_n(pos[0], 0), _n(pos[1], 0), _n(pos[2], 0));
            if (rot) model.rotation.set(_n(rot[0], 0), _n(rot[1], 0), _n(rot[2], 0));
            _applyScale(model, scale);
            model.traverse((o) => {
              if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
            });
            // Replace the placeholder with the loaded model.
            scene.remove(ph);
            _disposeObject(ph, T);
            scene.add(model);
            created.push(model);
            if (obj.spin) spinners.push(model);
          });
        // Fork: log + leave placeholder on failure. Does NOT affect `p`'s status.
        p.catch((err) => {
          console.warn(`[worldObjects] GLB load failed for "${modelPath}":`, err && err.message ? err.message : err);
        });
        loadPromises.push(p);
      } else if (!loadGltf) {
        // No loader injected (shouldn't happen in the arena; tests inject one).
        // The placeholder stays; no promise.
      }
    } else if (obj.type === 'box') {
      const mesh = _makePrimitive('box', pos, rot, scale, color, T);
      scene.add(mesh);
      created.push(mesh);
      if (obj.spin) spinners.push(mesh);
    } else if (obj.type === 'cylinder') {
      const mesh = _makePrimitive('cylinder', pos, rot, scale, color, T);
      scene.add(mesh);
      created.push(mesh);
      if (obj.spin) spinners.push(mesh);
    } else if (obj.type === 'plane') {
      const mesh = _makePrimitive('plane', pos, rot, scale, color, T);
      scene.add(mesh);
      created.push(mesh);
      if (obj.spin) spinners.push(mesh);
    }
  }

  // ready — Promise.allSettled so a failed load never rejects. Null when no
  // GLB objects were queued (the caller omits ready from its return value).
  const ready = loadPromises.length > 0 ? Promise.allSettled(loadPromises) : null;

  // ── Per-frame tick ────────────────────────────────────────────────────────
  // Subtle spin on objects flagged `spin`. Allocation-free: only mutates
  // existing scalars (rotation.y). No-op-safe if dt is missing.
  const _seed = nowFn() * 0.001;
  function tick(dt) {
    const d = typeof dt === 'number' && Number.isFinite(dt) ? dt : 0;
    for (let i = 0; i < spinners.length; i++) {
      spinners[i].rotation.y += d * 0.5;
    }
  }

  return { ready, tick };
}

// ── Internal helpers ────────────────────────────────────────────────────────

// _n(v, fallback) — coerce to a finite number or fall back. Accepts a numeric
// string so hand-authored JSON written loosely still coerces.
function _n(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

// _applyScale(model, scale) — apply a uniform number or [x,y,z] scale.
function _applyScale(model, scale) {
  if (scale == null) return;
  if (Array.isArray(scale)) {
    model.scale.set(_n(scale[0], 1), _n(scale[1], 1), _n(scale[2], 1));
  } else {
    const s = _n(scale, 1);
    model.scale.setScalar(s);
  }
}

// _parseColor(v, fallbackHex, THREE) — parse a CSS hex string (#rgb / #rrggbb)
// into a THREE.Color-compatible numeric hex; fall back on any parse failure.
// Mirrors worldRenderer.js's _parseColor so both modules share the same rule.
function _parseColor(v, fallbackHex, T) {
  if (typeof v !== 'string' || v.trim() === '') return fallbackHex;
  const s = v.trim();
  const hex = s.startsWith('#') ? s.slice(1) : s;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = hex[0], g = hex[1], b = hex[2];
    return parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return parseInt(hex, 16);
  }
  return fallbackHex;
}

// _makePrimitive(kind, pos, rot, scale, color, THREE) → a THREE.Mesh. Builds a
// primitive shape with a standard material. Created ONCE (scene-setup).
function _makePrimitive(kind, pos, rot, scale, color, T) {
  let geo;
  if (kind === 'box') {
    geo = new T.BoxGeometry(1, 1, 1);
  } else if (kind === 'cylinder') {
    geo = new T.CylinderGeometry(0.5, 0.5, 1, 24);
  } else { // plane
    geo = new T.PlaneGeometry(1, 1);
  }
  const col = _parseColor(color, 0x888888, T);
  const mat = new T.MeshStandardMaterial({ color: col, roughness: 0.8, metalness: 0.0 });
  const mesh = new T.Mesh(geo, mat);
  mesh.position.set(_n(pos[0], 0), _n(pos[1], 0), _n(pos[2], 0));
  if (rot) mesh.rotation.set(_n(rot[0], 0), _n(rot[1], 0), _n(rot[2], 0));
  _applyScale(mesh, scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// _makePlaceholder(pos, rot, scale, THREE) → a small dark box shown while a GLB
// loads (or permanently if the load fails). Created ONCE per GLB object.
function _makePlaceholder(pos, rot, scale, T) {
  const geo = new T.BoxGeometry(0.5, 0.5, 0.5);
  const mat = new T.MeshStandardMaterial({
    color: PLACEHOLDER_COLOR,
    emissive: PLACEHOLDER_COLOR,
    emissiveIntensity: 0.2,
    roughness: 0.9,
    transparent: true,
    opacity: 0.7,
  });
  const mesh = new T.Mesh(geo, mat);
  mesh.position.set(_n(pos[0], 0), _n(pos[1], 0), _n(pos[2], 0));
  if (rot) mesh.rotation.set(_n(rot[0], 0), _n(rot[1], 0), _n(rot[2], 0));
  _applyScale(mesh, scale);
  return mesh;
}

// _disposeObject(obj, THREE) — dispose geometry + materials on a removed object
// (the placeholder is replaced by the loaded GLB). Traverses meshes.
function _disposeObject(obj, T) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m && m.dispose) m.dispose(); }
    }
  });
}
