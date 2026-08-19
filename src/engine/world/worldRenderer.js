// engine/world/worldRenderer.js — the THREE adapter for a data-driven minimal
// world manifest (Phase 0b, the 3D homepage). Given a validated `world` object
// (from worldSchema.validateWorld) + the shared { scene, sun, THREE }, it builds
// a small 3D scene — a space sky + starfield, a cloud platform to stand on, a
// gateway marker (the "walk through the gateway to visit another node" visual),
// and lights — and returns a { tick(dt) } for subtle per-frame animation.
//
// THREE-DEPENDENT + browser-only: this module imports `three` directly. It is
// only ever imported by arenaRuntime.js (the lazy ENTER ARENA chunk), which is
// itself three-dependent and never run in node/vitest. No node-safe leaf imports
// it, so it does not trip the regression-check node-safety rules (those only
// `node --check` the file — which passes — and apply to foundation/test leaves).
//
// ALLOCATION DISCIPLINE: every THREE object is created EXACTLY ONCE in
// buildMinimalWorld() (scene-setup, not a hot path). The returned tick(dt)
// mutates ONLY existing scalars (rotation.y on the gateway ring, a drift phase
// on the cloud platform) — it allocates NO Vector3/Matrix4/geometry/material per
// frame. The platform Y is also exposed via `.platformY` so boot can place a
// Rapier collider whose top sits at the platform surface.
//
// The gateway marker here is a simple emissive torus/ring — NOT the arena's
// buildPortalMesh (engine/gateway/portalMesh.js). That builder is a module-scope
// singleton (_built guard) already consumed by the arena's Plebeian Market
// portal; reusing it would conflict, so the minimal world builds its own
// standalone marker. It is display-only: no collider, no raycast, no input.

import * as THREE from 'three';
import { buildWorldObjects } from './worldObjectsRenderer.js';

// Defaults for a space scene when the manifest omits a field. Tuned so the
// homepage reads as "sat on a cloud in space" — dark void, soft stars, a pale
// luminous platform, and a glowing torii-ring gateway.
const DEFAULT_SKY_COLOR = 0x05060a;
const DEFAULT_PLATFORM_COLOR = 0xc4b5fd; // soft lavender (gateway-blank manifest)
const DEFAULT_PLATFORM_RADIUS = 12;
const DEFAULT_GATEWAY_COLOR = 0xffd27a; // warm gold ring
const STAR_COUNT = 600;
const STAR_RADIUS = 400; // large sphere — camera sits inside it

// buildMinimalWorld(world, opts) → { tick(dt), platformY, spawn, ready? }
//   world  — a validated world object (worldSchema.validateWorld result .world).
//   opts   — { scene, sun, THREE?, assetUrl?, loadGltf? } where:
//     scene    — the shared THREE.Scene (from scene.js).
//     sun    — the shared THREE.DirectionalLight (from scene.js); position/intensity
//              are adjusted when the manifest carries a directional light.
//     THREE  — optional; the three namespace (passed in so the caller's single
//              import is used). Defaults to this module's own `three` import.
//     assetUrl — optional; the assetUrl helper (from assetUrl.js), forwarded to
//              buildWorldObjects so GLB model paths resolve against the deploy base.
//     loadGltf — optional; (path) → Promise<gltfScene>, forwarded to buildWorldObjects
//              so GLB objects load via the real GLTFLoader (arenaRuntime wires it).
//
// Returns:
//   { tick(dt), platformY, spawn, ready? }
//     tick(dt)     — per-frame: subtle cloud drift + gateway ring spin + object
//                    spins. No-op-safe.
//     platformY    — the world-Y of the platform's TOP surface (for the collider).
//     spawn        — { x, z, yaw } from world.spawn (for setNextSpawn); or null.
//     ready        — optional Promise (allSettled) for async GLB loads; omitted
//                    when world has no objects. Never rejects (best-effort).
//
// Never throws on a well-formed world; missing optional fields fall back to
// defaults. If `world` is null/missing, returns a no-op tick + zero platformY so
// the caller can guard without a try/catch.
export function buildMinimalWorld(world, opts = {}) {
  const { scene, sun } = opts;
  // The caller may pass its own THREE namespace (so the single import is used);
  // otherwise fall back to this module's direct import.
  const T = opts.THREE || THREE;
  if (!world || !scene || !T) {
    return { tick() {}, platformY: 0, spawn: null };
  }

  const created = []; // track for a future dispose() (not exposed yet)

  // ── Sky ──────────────────────────────────────────────────────────────────
  // A dark space background + a real 3D starfield (THREE.Points on a large
  // sphere). The arena's Sky.js (Preetham atmospheric scattering) stays for the
  // legacy path; the minimal world overrides scene.background with a flat dark
  // colour so the "floating in space" read is immediate. The starfield is a
  // simple additive-blended Points — a few hundred points distributed uniformly
  // on a sphere shell so camera rotation shows real perspective (not painted-on).
  if (world.sky && world.sky.type === 'space') {
    const skyColor = _parseColor(world.sky.color, DEFAULT_SKY_COLOR, T);
    scene.background = new T.Color(skyColor);
    // Override the arena's warm fog — a space scene has no atmospheric haze.
    if (scene.fog) scene.fog = null;

    if (world.sky.stars) {
      const starGeo = new T.BufferGeometry();
      const positions = new Float32Array(STAR_COUNT * 3);
      let seed = 7; // deterministic PRNG so stars are stable across reloads
      const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < STAR_COUNT; i++) {
        // Uniform distribution on a sphere (no pole clustering).
        const u = rand();
        const v = rand();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const r = STAR_RADIUS;
        positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      }
      starGeo.setAttribute('position', new T.BufferAttribute(positions, 3));
      const starMat = new T.PointsMaterial({
        color: 0xffffff,
        size: 1.2,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: T.AdditiveBlending,
        fog: false,
      });
      const stars = new T.Points(starGeo, starMat);
      stars.renderOrder = -1;
      stars.frustumCulled = false; // huge sphere, camera is inside
      scene.add(stars);
      created.push(starGeo, starMat, stars);
    }
  }

  // ── Platform ─────────────────────────────────────────────────────────────
  // A flattened cylinder — large enough to stand on (radius ~12, or scaled by
  // the manifest's platform.size). Soft white/grey MeshStandardMaterial with a
  // subtle emissive rim so the cloud reads as luminous against the dark sky.
  // The platform sits at world.platform.position (or [0,0,0]); its TOP surface
  // Y is exposed as platformY so boot can place a Rapier collider + spawn the
  // player eye ~1.7m above it.
  const pPos = (world.platform && Array.isArray(world.platform.position))
    ? world.platform.position
    : [0, 0, 0];
  const platformY = _numOr(pPos[1], 0);
  const size = (world.platform && _numOr(world.platform.size, 0)) || DEFAULT_PLATFORM_RADIUS;
  // Map the manifest's "size" (a footprint hint, e.g. 40) to a standable radius.
  // The manifest size is a diameter-ish scene footprint; use a fraction so the
  // platform is generous but not absurd. Clamp to a sensible [6, 24] range.
  const radius = T.MathUtils.clamp(size * 0.35, 6, 24) || DEFAULT_PLATFORM_RADIUS;
  const platformColor = _parseColor(
    world.platform && world.platform.color, DEFAULT_PLATFORM_COLOR, T
  );
  // Phase 0k.5: when the world declares a `terrain` (heightfield collider +
  // displaced mesh, built by buildWorldTerrain in arenaRuntime), the terrain IS the
  // ground — skip the cloud platform + its glow rim so there aren't two surfaces.
  // platformY stays 0 (the spawn eye-Y is SPAWN_Y from player.js; the player falls
  // onto the terrain heightfield). The gateway still uses platformY as a Y fallback.
  if (!world.terrain) {
    const platGeo = new T.CylinderGeometry(radius, radius, 1.2, 48);
    const platMat = new T.MeshStandardMaterial({
      color: platformColor,
      emissive: platformColor,
      emissiveIntensity: 0.18,
      roughness: 0.85,
      metalness: 0.0,
    });
    const platform = new T.Mesh(platGeo, platMat);
    // Cylinder is centred on its origin; shift so the TOP face is at platformY.
    platform.position.set(_numOr(pPos[0], 0), platformY - 0.6, _numOr(pPos[2], 0));
    platform.receiveShadow = true;
    scene.add(platform);
    created.push(platGeo, platMat, platform);

    // Subtle glow rim — a slightly larger, thin disc just below the platform edge
    // so the cloud appears to emit a soft halo into the void.
    const rimGeo = new T.RingGeometry(radius * 0.98, radius * 1.25, 48);
    const rimMat = new T.MeshBasicMaterial({
      color: platformColor,
      transparent: true,
      opacity: 0.12,
      side: T.DoubleSide,
      depthWrite: false,
      blending: T.AdditiveBlending,
      fog: false,
    });
    const rim = new T.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2; // lay flat
    rim.position.set(platform.position.x, platformY - 0.59, platform.position.z);
    scene.add(rim);
    created.push(rimGeo, rimMat, rim);
  }

  // ── Gateway marker ────────────────────────────────────────────────────────
  // A simple emissive torus (portal ring) at world.gateway.position — the
  // "walk through the gateway to visit another node" visual. Display-only: no
  // collider, no raycast, no input. The ring slowly spins (see tick) so it
  // reads as an active portal. Sized to be walkable-through (inner radius ~1.6m).
  let gateway = null;
  let gatewayMat = null;
  if (world.gateway && Array.isArray(world.gateway.position)) {
    const gPos = world.gateway.position;
    const gColor = _parseColor(world.gateway.color, DEFAULT_GATEWAY_COLOR, T);
    const gGeo = new T.TorusGeometry(1.6, 0.18, 16, 48);
    gatewayMat = new T.MeshStandardMaterial({
      color: gColor,
      emissive: gColor,
      emissiveIntensity: 0.7,
      roughness: 0.4,
      metalness: 0.3,
    });
    gateway = new T.Mesh(gGeo, gatewayMat);
    gateway.position.set(_numOr(gPos[0], 0), _numOr(gPos[1], platformY) + 1.6, _numOr(gPos[2], 0));
    // Stand the torus upright (faces +Z by default; rotate so the ring opening
    // faces the player walking toward it from spawn).
    gateway.rotation.y = 0;
    scene.add(gateway);
    created.push(gGeo, gatewayMat, gateway);
  }

  // ── Lights ───────────────────────────────────────────────────────────────
  // From world.lights — ambient + directional. The shared `sun` (the scene's
  // DirectionalLight from scene.js) is repositioned if the manifest specifies a
  // directional light; otherwise a sensible space-scene default is used. Ambient
  // is added fresh (the arena's warm ambient stays for legacy; the minimal world
  // adds its own so the platform/gateway read correctly under a space sky).
  if (Array.isArray(world.lights)) {
    for (const light of world.lights) {
      if (!light || typeof light !== 'object') continue;
      const intensity = _numOr(light.intensity, 0.5);
      const color = _parseColor(light.color, 0xffffff, T);
      if (light.kind === 'ambient') {
        const amb = new T.AmbientLight(color, intensity);
        scene.add(amb);
        created.push(amb);
      } else if (light.kind === 'directional') {
        // Reposition the shared sun if a position is given; otherwise just set
        // intensity/color. The sun already casts shadows; keep that on.
        if (sun) {
          sun.color = new T.Color(color);
          sun.intensity = intensity;
          if (Array.isArray(light.position)) {
            sun.position.set(
              _numOr(light.position[0], 8),
              _numOr(light.position[1], 12),
              _numOr(light.position[2], 6),
            );
          }
        } else {
          // No shared sun (shouldn't happen — scene.js always exports one); add
          // a fresh directional as a fallback so the platform isn't unlit.
          const dir = new T.DirectionalLight(color, intensity);
          if (Array.isArray(light.position)) {
            dir.position.set(
              _numOr(light.position[0], 8),
              _numOr(light.position[1], 12),
              _numOr(light.position[2], 6),
            );
          }
          scene.add(dir);
          created.push(dir);
        }
      } else if (light.kind === 'point') {
        const pt = new T.PointLight(color, intensity, 30);
        if (Array.isArray(light.position)) {
          pt.position.set(
            _numOr(light.position[0], 0),
            _numOr(light.position[1], 5),
            _numOr(light.position[2], 0),
          );
        }
        scene.add(pt);
        created.push(pt);
      }
    }
  }

  // ── Spawn ────────────────────────────────────────────────────────────────
  // Exposed so boot can setNextSpawn(world.spawn.position[0], .position[2], yaw).
  // The spawn Y is NOT used here — player.js sets the eye at SPAWN_Y (the
  // canonical eye height); the platform collider + gravity drops the body onto
  // the platform surface. The manifest's spawn XZ/yaw is what matters.
  let spawn = null;
  if (world.spawn && Array.isArray(world.spawn.position)) {
    spawn = {
      x: _numOr(world.spawn.position[0], 0),
      z: _numOr(world.spawn.position[2], 0),
      yaw: _numOr(world.spawn.yaw, 0),
    };
  }

  // ── Objects (Phase 0e) ───────────────────────────────────────────────────
  // Place visual-only meshes (primitives + GLB models) from world.objects.
  // GLB loads are async + non-fatal; the returned `ready` is a Promise.allSettled
  // the caller MAY await (best-effort — objects pop in async). The objects tick
  // (subtle spin on flagged objects) is merged into the main tick below.
  let _objRt = null;
  if (Array.isArray(world.objects) && world.objects.length > 0) {
    _objRt = buildWorldObjects(world, {
      scene,
      THREE: T,
      assetUrl: opts.assetUrl,
      loadGltf: opts.loadGltf,
    });
  }

  // ── Per-frame tick ───────────────────────────────────────────────────────
  // Subtle cloud drift (a slow vertical bob) + gateway ring spin + object
  // spins. Allocation-free: only mutates existing scalars. No-op-safe if dt is
  // missing.
  let _driftPhase = 0;
  function tick(dt) {
    const d = typeof dt === 'number' && Number.isFinite(dt) ? dt : 0;
    _driftPhase += d * 0.3;
    // Gentle bob on the platform + rim (a cloud drifting in space).
    const bob = Math.sin(_driftPhase) * 0.04;
    platform.position.y = (platformY - 0.6) + bob;
    rim.position.y = (platformY - 0.59) + bob;
    if (gateway) gateway.rotation.z += d * 0.4;
    // Objects tick (subtle spin on flagged objects). No-op when no objects.
    if (_objRt) _objRt.tick(d);
  }

  // `ready` is optional: omitted when there are no GLB objects (buildWorldObjects
  // returns null). The caller may `await result.ready` best-effort (non-blocking).
  const result = { tick, platformY, spawn };
  if (_objRt && _objRt.ready) result.ready = _objRt.ready;
  return result;
}

// ── Internal helpers ────────────────────────────────────────────────────────

// _numOr(v, fallback) — coerce to a finite number or fall back. Accepts a
// numeric string so hand-authored JSON written loosely still coerces.
function _numOr(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

// _parseColor(v, fallbackHex, THREE) — parse a CSS hex string (#rgb / #rrggbb)
// into a THREE.Color-compatible numeric hex; fall back to fallbackHex on any
// parse failure. Never throws. Returns a number (0xRRGGBB), not a THREE.Color,
// so the caller can pass it to material constructors directly.
function _parseColor(v, fallbackHex, T) {
  if (typeof v !== 'string' || v.trim() === '') return fallbackHex;
  const s = v.trim();
  // Accept #rgb, #rrggbb, or bare rrggbb.
  const hex = s.startsWith('#') ? s.slice(1) : s;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    // Expand #rgb → #rrggbb.
    const r = hex[0], g = hex[1], b = hex[2];
    return parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return parseInt(hex, 16);
  }
  return fallbackHex;
}
