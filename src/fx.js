// fx.js — bullet-impact particle bursts + ricochet tracer lines.
// Pooled, zero-alloc in the hot path. Used by weapons.js on every wall/crate
// impact (player AND bot bullets — same path). Particles are physics-aware:
// they fall under gravity and collide with the floor, arena walls, and the
// CRATES AABBs from config.js, so the feedback matches the actual collision
// volumes the bullet just hit.
import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA_HALF, CRATES, EAST_GAP_HALF, GRAVITY } from './config.js';

// ── Burst tuning ─────────────────────────────────────────────────────────────
const PARTICLES_PER_BURST = 8;
const PARTICLE_TTL        = 0.55;          // seconds — fade over this window
const PARTICLE_SPEED_MIN  = 2.5;
const PARTICLE_SPEED_MAX  = 6.0;
const PARTICLE_GRAVITY    = GRAVITY * 0.4; // lighter than player gravity
const PARTICLE_BOUNCE     = 0.45;          // restitution on collision
const PARTICLE_DRAG       = 0.92;          // per-second velocity falloff
const PARTICLE_SIZE       = 0.10;
// Hemisphere cone half-angle around the surface normal — bigger = wider spray
const SPRAY_CONE_DEG      = 55;

// Shared Points geometry — every burst owns its own positions buffer so they
// can be ticked independently.
const _PARTICLE_GEO_STRIDE = PARTICLES_PER_BURST * 3;
const _pointsMat = new THREE.PointsMaterial({
  color: 0xffb347,
  size: PARTICLE_SIZE,
  sizeAttenuation: true,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

// Pool of burst objects — each is { points, positions[], vel[], life }
const _burstPool   = [];
const _burstActive = [];

function _newBurst() {
  const positions = new Float32Array(_PARTICLE_GEO_STRIDE);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Bounding sphere kept huge so frustum culling never hides a live burst.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 9999);
  const points = new THREE.Points(g, _pointsMat.clone());
  points.frustumCulled = false;
  return {
    points,
    positions,
    // velocity for each particle — 3 floats interleaved like positions
    vel: new Float32Array(_PARTICLE_GEO_STRIDE),
    // per-particle life so they can die individually
    life: new Float32Array(PARTICLES_PER_BURST),
    maxLife: PARTICLE_TTL,
  };
}

function _getBurst() {
  return _burstPool.pop() || _newBurst();
}

// Hemisphere-biased random direction around `n`. Builds an orthonormal basis
// (n, t1, t2) once per call, then samples a cone whose axis is n. Stays
// allocation-free by writing into the supplied 3-float `out`.
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _nv = new THREE.Vector3();

function _sampleConeDir(nx, ny, nz, out, outOff) {
  _nv.set(nx, ny, nz);
  // Pick any axis not parallel to n
  if (Math.abs(_nv.y) < 0.95) _t1.set(0, 1, 0); else _t1.set(1, 0, 0);
  _t1.crossVectors(_nv, _t1).normalize();
  _t2.crossVectors(_nv, _t1).normalize();
  const coneRad = (SPRAY_CONE_DEG * Math.PI) / 180;
  const cosTheta = Math.cos(coneRad) + (1 - Math.cos(coneRad)) * Math.random();
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  const phi = Math.random() * Math.PI * 2;
  const cx = Math.cos(phi) * sinTheta;
  const cy = Math.sin(phi) * sinTheta;
  out[outOff    ] = _nv.x * cosTheta + _t1.x * cx + _t2.x * cy;
  out[outOff + 1] = _nv.y * cosTheta + _t1.y * cx + _t2.y * cy;
  out[outOff + 2] = _nv.z * cosTheta + _t1.z * cx + _t2.z * cy;
}

// Public API. `normal` is the surface normal at the impact (optional — we
// default to straight-up so legacy single-arg callers still work).
const _defaultNormal = new THREE.Vector3(0, 1, 0);

export function spawnSpark(pos, normal) {
  const n = normal || _defaultNormal;
  const burst = _getBurst();
  const { positions, vel, life } = burst;
  for (let i = 0; i < PARTICLES_PER_BURST; i++) {
    const o = i * 3;
    positions[o    ] = pos.x;
    positions[o + 1] = pos.y;
    positions[o + 2] = pos.z;
    _sampleConeDir(n.x, n.y, n.z, vel, o);
    const speed = PARTICLE_SPEED_MIN + Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
    vel[o    ] *= speed;
    vel[o + 1] *= speed;
    vel[o + 2] *= speed;
    life[i] = PARTICLE_TTL * (0.7 + Math.random() * 0.3);
  }
  burst.points.geometry.attributes.position.needsUpdate = true;
  burst.points.material.opacity = 1.0;
  scene.add(burst.points);
  _burstActive.push(burst);
}

// ── Physics-aware particle tick ──────────────────────────────────────────────
// Floor at y=0. Walls at ±ARENA_HALF (east plane suppressed inside the torii
// gap so debris can escape through the opening, matching bullet behaviour).
// CRATES use AABBs from config.js — single source of truth.
function _collideParticle(positions, vel, o) {
  const px = positions[o    ];
  const py = positions[o + 1];
  const pz = positions[o + 2];
  // Floor
  if (py < 0) {
    positions[o + 1] = 0;
    if (vel[o + 1] < 0) vel[o + 1] = -vel[o + 1] * PARTICLE_BOUNCE;
    vel[o    ] *= 0.7;
    vel[o + 2] *= 0.7;
  }
  // Arena walls (east plane skipped inside the torii gap)
  if (px >  ARENA_HALF) { positions[o    ] =  ARENA_HALF; if (vel[o    ] > 0) {
    if (!(Math.abs(pz) < EAST_GAP_HALF)) vel[o    ] = -vel[o    ] * PARTICLE_BOUNCE;
  } }
  if (px < -ARENA_HALF) { positions[o    ] = -ARENA_HALF; if (vel[o    ] < 0) vel[o    ] = -vel[o    ] * PARTICLE_BOUNCE; }
  if (pz >  ARENA_HALF) { positions[o + 2] =  ARENA_HALF; if (vel[o + 2] > 0) vel[o + 2] = -vel[o + 2] * PARTICLE_BOUNCE; }
  if (pz < -ARENA_HALF) { positions[o + 2] = -ARENA_HALF; if (vel[o + 2] < 0) vel[o + 2] = -vel[o + 2] * PARTICLE_BOUNCE; }
  // Crates — single deepest-axis pushout per particle per frame is enough
  // because PARTICLE_SPEED is modest and dt is small.
  for (let c = 0; c < CRATES.length; c++) {
    const cx = CRATES[c][0], cz = CRATES[c][1], hw = CRATES[c][2], hd = CRATES[c][3], fh = CRATES[c][4];
    const qx = positions[o    ], qy = positions[o + 1], qz = positions[o + 2];
    if (qx < cx - hw || qx > cx + hw) continue;
    if (qz < cz - hd || qz > cz + hd) continue;
    if (qy < 0      || qy > fh)       continue;
    const dxPos = (cx + hw) - qx, dxNeg = qx - (cx - hw);
    const dzPos = (cz + hd) - qz, dzNeg = qz - (cz - hd);
    const dyPos = fh - qy;
    let m = dxPos, axis = 0, sign = 1;
    if (dxNeg < m) { m = dxNeg; axis = 0; sign = -1; }
    if (dzPos < m) { m = dzPos; axis = 2; sign = 1;  }
    if (dzNeg < m) { m = dzNeg; axis = 2; sign = -1; }
    if (dyPos < m) { m = dyPos; axis = 1; sign = 1;  }
    if (axis === 0) { positions[o    ] = sign > 0 ? cx + hw : cx - hw; vel[o    ] = -vel[o    ] * PARTICLE_BOUNCE; }
    else if (axis === 2) { positions[o + 2] = sign > 0 ? cz + hd : cz - hd; vel[o + 2] = -vel[o + 2] * PARTICLE_BOUNCE; }
    else { positions[o + 1] = fh; if (vel[o + 1] < 0) vel[o + 1] = -vel[o + 1] * PARTICLE_BOUNCE; }
    break;
  }
}

function _tickBursts(dt) {
  const drag = Math.pow(PARTICLE_DRAG, dt * 60);
  for (let i = _burstActive.length - 1; i >= 0; i--) {
    const burst = _burstActive[i];
    const { positions, vel, life, points } = burst;
    let anyAlive = false;
    for (let p = 0; p < PARTICLES_PER_BURST; p++) {
      if (life[p] <= 0) continue;
      const o = p * 3;
      vel[o + 1] += PARTICLE_GRAVITY * dt;
      vel[o    ] *= drag;
      vel[o + 1] *= drag;
      vel[o + 2] *= drag;
      positions[o    ] += vel[o    ] * dt;
      positions[o + 1] += vel[o + 1] * dt;
      positions[o + 2] += vel[o + 2] * dt;
      _collideParticle(positions, vel, o);
      life[p] -= dt;
      if (life[p] > 0) anyAlive = true;
    }
    points.geometry.attributes.position.needsUpdate = true;
    points.material.opacity = Math.max(0, anyAlive ? Math.min(1, (life[0] + life[1]) / PARTICLE_TTL) : 0);
    if (!anyAlive) {
      scene.remove(points);
      _burstPool.push(burst);
      _burstActive[i] = _burstActive[_burstActive.length - 1];
      _burstActive.pop();
    }
  }
}

// ── Ricochet tracer — short line along a jittered reflected direction ───────
const _RIC_TTL = 0.18;
const _RIC_JITTER_DEG = 12; // organic deflection cone
const _ricMat  = new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true });
const _ricPool = [];
const _ricActive = [];
const _ricScratchA = new THREE.Vector3();
const _ricScratchB = new THREE.Vector3();
const _ricJitterDir = new THREE.Vector3();

function _getRicLine() {
  if (_ricPool.length) return _ricPool.pop();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  return new THREE.Line(g, _ricMat.clone());
}

// Apply a small random angular offset to the reflected direction.
function _jitterDirection(dir, out) {
  // Build a basis so we can rotate within the cone around `dir`
  if (Math.abs(dir.y) < 0.95) _t1.set(0, 1, 0); else _t1.set(1, 0, 0);
  _t1.crossVectors(dir, _t1).normalize();
  _t2.crossVectors(dir, _t1).normalize();
  const jitterRad = (_RIC_JITTER_DEG * Math.PI) / 180;
  const cosTheta = Math.cos(jitterRad) + (1 - Math.cos(jitterRad)) * Math.random();
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  const phi = Math.random() * Math.PI * 2;
  const cx = Math.cos(phi) * sinTheta;
  const cy = Math.sin(phi) * sinTheta;
  out.set(
    dir.x * cosTheta + _t1.x * cx + _t2.x * cy,
    dir.y * cosTheta + _t1.y * cx + _t2.y * cy,
    dir.z * cosTheta + _t1.z * cx + _t2.z * cy,
  );
}

export function spawnRicochet(pos, dir) {
  const line = _getRicLine();
  _jitterDirection(dir, _ricJitterDir);
  const pa = line.geometry.attributes.position;
  _ricScratchA.copy(pos);
  _ricScratchB.copy(pos).addScaledVector(_ricJitterDir, 0.7);
  pa.array[0] = _ricScratchA.x; pa.array[1] = _ricScratchA.y; pa.array[2] = _ricScratchA.z;
  pa.array[3] = _ricScratchB.x; pa.array[4] = _ricScratchB.y; pa.array[5] = _ricScratchB.z;
  pa.needsUpdate = true;
  line.material.opacity = 1.0;
  scene.add(line);
  _ricActive.push({ line, life: _RIC_TTL });
}

function _tickRicochets(dt) {
  for (let i = _ricActive.length - 1; i >= 0; i--) {
    const r = _ricActive[i];
    r.life -= dt;
    r.line.material.opacity = Math.max(0, r.life / _RIC_TTL);
    if (r.life <= 0) {
      scene.remove(r.line);
      _ricPool.push(r.line);
      _ricActive[i] = _ricActive[_ricActive.length - 1];
      _ricActive.pop();
    }
  }
}

export function tickFx(dt) {
  _tickBursts(dt);
  _tickRicochets(dt);
}
