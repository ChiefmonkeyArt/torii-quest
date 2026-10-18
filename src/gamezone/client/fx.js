// src/gamezone/client/fx.js — tracers + impact sparks for the Game Zone (ADR-0130).
//
// Two draw calls total, whatever is happening: every tracer lives in ONE
// LineSegments buffer and every spark in ONE Points buffer. Additive blending
// with vertex colours, so fading = scaling the colour toward black (no
// transparency sorting, no per-effect material). Ring-buffer allocation: when
// the pool is full the oldest effect is recycled. Zero allocation per shot.

// src/gamezone/client/fx.js — tracers + impact sparks for the Game Zone (ADR-0130).
//
// Two draw calls total, whatever is happening: every tracer lives in ONE ribbon
// mesh and every spark in ONE Points buffer. Ring-buffer allocation: when the
// pool is full the oldest effect is recycled. Zero allocation per shot.
//
// ADR-0136: tracers are camera-facing ribbons, not 1-px GL lines. A short
// glowing streak (hot core + soft coloured glow) travels from the muzzle to the
// impact at bullet speed, then fades. Your rounds are an orange core with a
// purple glow; bot rounds are a black core with a red glow (slower and wider so
// incoming fire is obvious). Width never drops below ~1.5 px at range.

import * as THREE from 'three';

const MAX_TRACERS = 48;
const MAX_SPARKS = 192;
const SPARKS_PER_HIT = 8;
const SPARK_TTL = 0.45;
const SPARK_G = -9;
const MIN_PX_W = 0.0026; // min ribbon width per metre of camera distance
const NEAR_CAM_M = 1.5;  // incoming streaks end this far from the camera

// core/glow: LINEAR RGB (converted to the output colour space in the shader); speed m/s; len streak m; w ribbon width m; fade s; a alpha.
export const TRACER_PLAYER = Object.freeze({ core: [1.0, 0.3, 0.02], glow: [0.38, 0.06, 1.0], speed: 240, len: 2.4, w: 0.055, fade: 0.07, a: 1 });
export const TRACER_PEER = Object.freeze({ core: [1.0, 0.3, 0.02], glow: [0.38, 0.06, 1.0], speed: 240, len: 2.4, w: 0.05, fade: 0.07, a: 0.8 });
export const TRACER_BOT = Object.freeze({ core: [0.0, 0.0, 0.0], glow: [1.0, 0.015, 0.008], speed: 110, len: 1.8, w: 0.09, fade: 0.1, a: 1 });
const SPARK_WALL = Object.freeze({ r: 1.0, g: 0.7, b: 0.28 });
const SPARK_FLESH = Object.freeze({ r: 1.0, g: 0.18, b: 0.1 });

const VS = `attribute vec3 aCore; attribute vec3 aGlow; attribute vec3 aUv;
varying vec3 vCore; varying vec3 vGlow; varying vec3 vUv;
void main() { vCore = aCore; vGlow = aGlow; vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// vUv.x: -1..1 across, vUv.y: 0 tail .. 1 head, vUv.z: alpha.
const FS = `varying vec3 vCore; varying vec3 vGlow; varying vec3 vUv;
void main() { float a = abs(vUv.x);
  float core = 1.0 - smoothstep(0.2, 0.46, a);
  float glow = (1.0 - a) * (1.0 - a);
  float along = mix(0.1, 1.0, vUv.y * vUv.y);
  float al = vUv.z * along * max(core, glow * 0.9);
  if (al < 0.004) discard;
  gl_FragColor = vec4(mix(vGlow, vCore, core), al);
  #include <colorspace_fragment>
}`;

export function createGzFx(parent, camera = null) {
  // ── tracers (ribbons) ──
  const V = MAX_TRACERS * 4;
  const tPos = new Float32Array(V * 3);
  const tCore = new Float32Array(V * 3);
  const tGlow = new Float32Array(V * 3);
  const tUv = new Float32Array(V * 3);
  const idx = new Uint16Array(MAX_TRACERS * 6);
  for (let i = 0; i < MAX_TRACERS; i++) {
    const v = i * 4, o = i * 6;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 2; idx[o + 4] = v + 1; idx[o + 5] = v + 3;
    tUv[v * 3] = -1; tUv[(v + 1) * 3] = 1; tUv[(v + 2) * 3] = -1; tUv[(v + 3) * 3] = 1;
    tUv[(v + 2) * 3 + 1] = tUv[(v + 3) * 3 + 1] = 1; // head verts
  }
  // Per tracer: from (3), unit dir (3), total dist, travelled head, style ref.
  const tFrom = new Float32Array(MAX_TRACERS * 3);
  const tDir = new Float32Array(MAX_TRACERS * 3);
  const tDist = new Float32Array(MAX_TRACERS);
  const tHead = new Float32Array(MAX_TRACERS);
  const tFade = new Float32Array(MAX_TRACERS); // >0 once the head has landed
  const tStyle = new Array(MAX_TRACERS).fill(null);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('aCore', new THREE.BufferAttribute(tCore, 3));
  tGeo.setAttribute('aGlow', new THREE.BufferAttribute(tGlow, 3));
  tGeo.setAttribute('aUv', new THREE.BufferAttribute(tUv, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const tMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const tracers = new THREE.Mesh(tGeo, tMat);
  tracers.name = 'gz-tracers';
  tracers.frustumCulled = false;
  tracers.renderOrder = 10;
  tracers.raycast = () => {};
  parent.add(tracers);
  let tNext = 0, tAlive = 0;
  const _cam = new THREE.Vector3();

  function tracer(ax, ay, az, bx, by, bz, style = TRACER_PLAYER) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    let L = Math.hypot(dx, dy, dz);
    if (!(L > 0.05)) return;
    // Rounds aimed at YOU stop short of the lens: a streak, not a smear.
    if (camera) {
      camera.getWorldPosition(_cam);
      const ex = bx - _cam.x, ey = by - _cam.y, ez = bz - _cam.z;
      if (ex * ex + ey * ey + ez * ez < NEAR_CAM_M * NEAR_CAM_M) {
        const along = ((_cam.x - ax) * dx + (_cam.y - ay) * dy + (_cam.z - az) * dz) / L;
        L = Math.min(L, Math.max(0, along - NEAR_CAM_M));
        if (!(L > 0.05)) return;
      }
    }
    const i = tNext; tNext = (tNext + 1) % MAX_TRACERS;
    if (!tStyle[i]) tAlive++;
    tStyle[i] = style;
    const o = i * 3;
    tFrom[o] = ax; tFrom[o + 1] = ay; tFrom[o + 2] = az;
    const D = Math.hypot(dx, dy, dz);
    tDir[o] = dx / D; tDir[o + 1] = dy / D; tDir[o + 2] = dz / D;
    tDist[i] = L; tHead[i] = 0; tFade[i] = 0;
    for (let k = 0; k < 4; k++) {
      const v = (i * 4 + k) * 3;
      tCore[v] = style.core[0]; tCore[v + 1] = style.core[1]; tCore[v + 2] = style.core[2];
      tGlow[v] = style.glow[0]; tGlow[v + 1] = style.glow[1]; tGlow[v + 2] = style.glow[2];
    }
    tGeo.attributes.aCore.needsUpdate = true;
    tGeo.attributes.aGlow.needsUpdate = true;
  }

  // Lay out tracer i as a camera-facing quad from distance t0 to t1 along its ray.
  function _quad(i, t0, t1, alpha) {
    const o = i * 3, st = tStyle[i];
    const fx = tFrom[o], fy = tFrom[o + 1], fz = tFrom[o + 2];
    const ux = tDir[o], uy = tDir[o + 1], uz = tDir[o + 2];
    const tm = (t0 + t1) * 0.5;
    const mx = fx + ux * tm, my = fy + uy * tm, mz = fz + uz * tm;
    let cx = _cam.x - mx, cy = _cam.y - my, cz = _cam.z - mz;
    const cd = Math.hypot(cx, cy, cz) || 1;
    // side = dir × toCamera
    let sx = uy * cz - uz * cy, sy = uz * cx - ux * cz, sz = ux * cy - uy * cx;
    const sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-6) { sx = 0; sy = 1; sz = 0; } else { sx /= sl; sy /= sl; sz /= sl; }
    const w = Math.max(st.w, cd * MIN_PX_W) * 0.5;
    sx *= w; sy *= w; sz *= w;
    const ax = fx + ux * t0, ay = fy + uy * t0, az = fz + uz * t0;
    const bx = fx + ux * t1, by = fy + uy * t1, bz = fz + uz * t1;
    const v = i * 12;
    tPos[v] = ax - sx; tPos[v + 1] = ay - sy; tPos[v + 2] = az - sz;
    tPos[v + 3] = ax + sx; tPos[v + 4] = ay + sy; tPos[v + 5] = az + sz;
    tPos[v + 6] = bx - sx; tPos[v + 7] = by - sy; tPos[v + 8] = bz - sz;
    tPos[v + 9] = bx + sx; tPos[v + 10] = by + sy; tPos[v + 11] = bz + sz;
    const a = alpha * st.a;
    tUv[v + 2] = tUv[v + 5] = tUv[v + 8] = tUv[v + 11] = a;
  }

  function _hide(i) {
    const v = i * 12;
    tUv[v + 2] = tUv[v + 5] = tUv[v + 8] = tUv[v + 11] = 0;
    for (let k = 0; k < 12; k++) tPos[v + k] = 0;
  }

  function _tickTracers(dt) {
    if (camera) camera.getWorldPosition(_cam);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const st = tStyle[i];
      if (!st) continue;
      let alpha = 1;
      if (tFade[i] > 0) {
        tFade[i] -= dt;
        if (tFade[i] <= 0) { tStyle[i] = null; tAlive--; _hide(i); continue; }
        alpha = tFade[i] / st.fade;
      } else {
        tHead[i] += st.speed * dt;
        if (tHead[i] >= tDist[i]) { tHead[i] = tDist[i]; tFade[i] = st.fade; }
      }
      const head = tHead[i];
      // While landed, the tail keeps closing in so the streak "lands".
      const len = tFade[i] > 0 ? st.len * alpha : st.len;
      _quad(i, Math.max(0, head - len), head, alpha);
    }
    tGeo.attributes.position.needsUpdate = true;
    tGeo.attributes.aUv.needsUpdate = true;
  }

  // ── sparks ──
  const sPos = new Float32Array(MAX_SPARKS * 3);
  const sCol = new Float32Array(MAX_SPARKS * 3);
  const sVel = new Float32Array(MAX_SPARKS * 3);
  const sBase = new Float32Array(MAX_SPARKS * 3);
  const sLife = new Float32Array(MAX_SPARKS);
  const sFloor = new Float32Array(MAX_SPARKS);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3).setUsage(THREE.DynamicDrawUsage));
  sGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const sMat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparks = new THREE.Points(sGeo, sMat);
  sparks.frustumCulled = false;
  sparks.raycast = () => {};
  parent.add(sparks);
  let sNext = 0, sAlive = 0;

  function impact(x, y, z, flesh = false) {
    const c = flesh ? SPARK_FLESH : SPARK_WALL;
    for (let k = 0; k < SPARKS_PER_HIT; k++) {
      const i = sNext; sNext = (sNext + 1) % MAX_SPARKS;
      if (sLife[i] <= 0) sAlive++;
      const o = i * 3;
      sPos[o] = x; sPos[o + 1] = y; sPos[o + 2] = z;
      const a = Math.random() * Math.PI * 2, u = Math.random();
      const sp = 2 + Math.random() * 3;
      sVel[o] = Math.cos(a) * sp * 0.7; sVel[o + 1] = (0.4 + u) * sp * 0.6; sVel[o + 2] = Math.sin(a) * sp * 0.7;
      sBase[o] = c.r; sBase[o + 1] = c.g; sBase[o + 2] = c.b;
      sLife[i] = SPARK_TTL * (0.6 + 0.4 * Math.random());
      sFloor[i] = y - 2;
    }
  }

  function tick(dt) {
    if (tAlive) _tickTracers(dt);
    if (sAlive) {
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (sLife[i] <= 0) continue;
        sLife[i] -= dt;
        const o = i * 3;
        if (sLife[i] <= 0) { sAlive--; sCol[o] = sCol[o + 1] = sCol[o + 2] = 0; continue; }
        sVel[o + 1] += SPARK_G * dt;
        sPos[o] += sVel[o] * dt; sPos[o + 1] += sVel[o + 1] * dt; sPos[o + 2] += sVel[o + 2] * dt;
        if (sPos[o + 1] < sFloor[i]) { sPos[o + 1] = sFloor[i]; sVel[o + 1] *= -0.4; }
        const k = sLife[i] / SPARK_TTL;
        sCol[o] = sBase[o] * k; sCol[o + 1] = sBase[o + 1] * k; sCol[o + 2] = sBase[o + 2] * k;
      }
      sGeo.attributes.position.needsUpdate = true;
      sGeo.attributes.color.needsUpdate = true;
    }
  }

  function clear() {
    tStyle.fill(null); for (let i = 0; i < MAX_TRACERS; i++) _hide(i);
    sLife.fill(0); sCol.fill(0);
    tAlive = sAlive = 0;
    tGeo.attributes.position.needsUpdate = true; tGeo.attributes.aUv.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
  }

  function dispose() {
    parent.remove(tracers); parent.remove(sparks);
    tGeo.dispose(); sGeo.dispose(); tMat.dispose(); sMat.dispose();
  }

  return { tracer, impact, tick, clear, dispose, get active() { return tAlive + sAlive; } };
}
