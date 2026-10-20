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
// purple glow; bot rounds are the complements, a cyan core with a lime glow
// (slower and wider so incoming fire is obvious, ADR-0138). Width never drops below ~1.5 px at range.

import * as THREE from 'three';

const MAX_TRACERS = 48;
const MAX_SPARKS = 192;
const SPARKS_PER_HIT = 8;
const SPARK_TTL = 0.45;
const SPARK_G = -9;
const MIN_PX_W = 0.0026; // min ribbon width per metre of camera distance
const NEAR_CAM_M = 1.5;  // incoming streaks end this far from the camera

// core/glow: LINEAR RGB (converted to the output colour space in the shader);
// head/headPx: tip glow size (m) and its minimum per metre of camera distance;
// wPx: optional per-style minimum ribbon width per metre (default MIN_PX_W); speed m/s; len streak m; w ribbon width m; fade s; a alpha.
// ADR-0139: yours = hot orange core (opposite the bots' cyan) + magenta-violet glow
// (opposite their lime). Slower than before so it is seen leaving the barrel;
// `anchor` s keeps the tail on the muzzle for the first frames; `xray` = never
// hidden by grass between you and the hit (see VS); `coreW` widens the hot
// orange core so it reads over the lilac grass; wMaxPx/headMaxPx
// cap the on-screen width up close so it never looks fat next to the gun.
export const TRACER_PLAYER = Object.freeze({ core: [1.0, 0.3, 0.03], glow: [0.72, 0.04, 1.0], speed: 170, len: 3.0, w: 0.075, fade: 0.08, a: 1, head: 0.08, headPx: 0.011, wMaxPx: 0.03, headMaxPx: 0.05, anchor: 0.05, xray: true, coreW: 1.7 });
export const TRACER_PEER = Object.freeze({ core: [1.0, 0.3, 0.03], glow: [0.72, 0.04, 1.0], speed: 200, len: 2.6, w: 0.05, fade: 0.07, a: 0.85, head: 0.06, headPx: 0.007 });
// ADR-0138: bot rounds use the COMPLEMENTS of yours — icy cyan core (opposite
// your orange) with an acid-lime glow (opposite your purple). Bright against the
// purple grass, blue sky and teal water alike; slower + wider so it reads.
export const TRACER_BOT = Object.freeze({ core: [0.15, 1.0, 1.0], glow: [0.45, 1.0, 0.0], speed: 110, len: 3.2, w: 0.12, fade: 0.12, a: 1, head: 0.14, headPx: 0.018, wPx: 0.005 });
const SPARK_WALL = Object.freeze({ r: 1.0, g: 0.7, b: 0.28 });
const SPARK_FLESH = Object.freeze({ r: 1.0, g: 0.18, b: 0.1 });

// aX = 1: YOUR tracer (ADR-0139). Its path is the crosshair ray up to the first
// thing it hit, so nothing between you and that point can hide it; the grass
// blades around your legs used to. Pin it to the near plane (keeps w, so
// perspective is unchanged) and it always passes the depth test.
const VS = `attribute vec3 aCore; attribute vec3 aGlow; attribute vec3 aUv; attribute vec2 aX;
varying vec3 vCore; varying vec3 vGlow; varying vec3 vUv; varying float vK;
void main() { vCore = aCore; vGlow = aGlow; vUv = aUv; vK = aX.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  if (aX.x > 0.5) gl_Position.z = -gl_Position.w * 0.9999; }`;
// Ribbon: vUv.x -1..1 across, vUv.y 0 tail .. 1 head. Head glow (ADR-0138):
// vUv.y in 2..4 marks the round billboard at the bullet's tip. vUv.z: alpha.
// vK: core width scale per style (`coreW`, default 1); a wider hot core reads
// over busy, similarly-coloured backgrounds (your orange over lilac grass).
const FS = `varying vec3 vCore; varying vec3 vGlow; varying vec3 vUv; varying float vK;
void main() { float core, glow, al;
  if (vUv.y > 1.5) {
    float r = length(vec2(vUv.x, vUv.y - 3.0));
    if (r > 1.0) discard;
    core = 1.0 - smoothstep(0.16 * vK, 0.4 * vK, r);
    glow = pow(1.0 - r, 1.8);
    al = vUv.z * max(core, glow);
  } else {
    float a = abs(vUv.x);
    core = 1.0 - smoothstep(0.16 * vK, 0.42 * vK, a);
    glow = pow(1.0 - a, 1.6);
    al = vUv.z * mix(0.12, 1.0, vUv.y * vUv.y) * max(core, glow);
  }
  if (al < 0.004) discard;
  gl_FragColor = vec4(mix(vGlow, vCore, core), al);
  #include <colorspace_fragment>
}`;

export function createGzFx(parent, camera = null) {
  // ── tracers (ribbons) ──
  // 8 vertices per tracer: a 4-vert ribbon + a 4-vert head glow (ADR-0138).
  const V = MAX_TRACERS * 8;
  const tPos = new Float32Array(V * 3);
  const tCore = new Float32Array(V * 3);
  const tGlow = new Float32Array(V * 3);
  const tUv = new Float32Array(V * 3);
  const tX = new Float32Array(V * 2); // (xray, core width scale)
  const idx = new Uint16Array(MAX_TRACERS * 12);
  for (let i = 0; i < MAX_TRACERS; i++) {
    const v = i * 8, o = i * 12;
    for (let q = 0; q < 2; q++) {
      const w = v + q * 4, k = o + q * 6;
      idx[k] = w; idx[k + 1] = w + 1; idx[k + 2] = w + 2; idx[k + 3] = w + 2; idx[k + 4] = w + 1; idx[k + 5] = w + 3;
    }
    tUv[v * 3] = -1; tUv[(v + 1) * 3] = 1; tUv[(v + 2) * 3] = -1; tUv[(v + 3) * 3] = 1;
    tUv[(v + 2) * 3 + 1] = tUv[(v + 3) * 3 + 1] = 1; // ribbon head verts
    // head billboard corners: x ±1, y 2 / 4 (the shader recentres to ±1)
    tUv[(v + 4) * 3] = -1; tUv[(v + 5) * 3] = 1; tUv[(v + 6) * 3] = -1; tUv[(v + 7) * 3] = 1;
    tUv[(v + 4) * 3 + 1] = tUv[(v + 5) * 3 + 1] = 2; tUv[(v + 6) * 3 + 1] = tUv[(v + 7) * 3 + 1] = 4;
  }
  // Per tracer: from (3), unit dir (3), total dist, travelled head, style ref.
  const tFrom = new Float32Array(MAX_TRACERS * 3);
  const tDir = new Float32Array(MAX_TRACERS * 3);
  const tDist = new Float32Array(MAX_TRACERS);
  const tHead = new Float32Array(MAX_TRACERS);
  const tFade = new Float32Array(MAX_TRACERS); // >0 once the head has landed
  const tAge = new Float32Array(MAX_TRACERS);
  const tStyle = new Array(MAX_TRACERS).fill(null);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('aCore', new THREE.BufferAttribute(tCore, 3));
  tGeo.setAttribute('aGlow', new THREE.BufferAttribute(tGlow, 3));
  tGeo.setAttribute('aUv', new THREE.BufferAttribute(tUv, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('aX', new THREE.BufferAttribute(tX, 2));
  tGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const tMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const tracers = new THREE.Mesh(tGeo, tMat);
  tracers.name = 'gz-tracers';
  tracers.frustumCulled = false;
  tracers.renderOrder = 10;
  tracers.raycast = () => {};
  parent.add(tracers);
  let tNext = 0, tAlive = 0;
  const _cam = new THREE.Vector3(), _right = new THREE.Vector3(1, 0, 0), _up = new THREE.Vector3(0, 1, 0);

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
    tDist[i] = L; tHead[i] = 0; tFade[i] = 0; tAge[i] = 0;
    for (let k = 0; k < 8; k++) {
      const v = (i * 8 + k) * 3;
      tCore[v] = style.core[0]; tCore[v + 1] = style.core[1]; tCore[v + 2] = style.core[2];
      tGlow[v] = style.glow[0]; tGlow[v + 1] = style.glow[1]; tGlow[v + 2] = style.glow[2];
      tX[(i * 8 + k) * 2] = style.xray ? 1 : 0;
      tX[(i * 8 + k) * 2 + 1] = style.coreW || 1;
    }
    tGeo.attributes.aX.needsUpdate = true;
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
    const ax = fx + ux * t0, ay = fy + uy * t0, az = fz + uz * t0;
    const bx = fx + ux * t1, by = fy + uy * t1, bz = fz + uz * t1;
    // Width per END (a ribbon from the gun tapers with perspective, ADR-0139).
    const wa = _w(st, Math.hypot(_cam.x - ax, _cam.y - ay, _cam.z - az) || cd);
    const wb = _w(st, Math.hypot(_cam.x - bx, _cam.y - by, _cam.z - bz) || cd);
    const v = i * 24;
    tPos[v] = ax - sx * wa; tPos[v + 1] = ay - sy * wa; tPos[v + 2] = az - sz * wa;
    tPos[v + 3] = ax + sx * wa; tPos[v + 4] = ay + sy * wa; tPos[v + 5] = az + sz * wa;
    tPos[v + 6] = bx - sx * wb; tPos[v + 7] = by - sy * wb; tPos[v + 8] = bz - sz * wb;
    tPos[v + 9] = bx + sx * wb; tPos[v + 10] = by + sy * wb; tPos[v + 11] = bz + sz * wb;
    const a = alpha * st.a;
    tUv[v + 2] = tUv[v + 5] = tUv[v + 8] = tUv[v + 11] = a;
    // Head glow: a camera-facing disc at the tip with a minimum on-screen size,
    // so a round coming straight at you still reads (a streak seen end-on
    // collapses to a speck). Uses the camera's right/up axes.
    const hd = Math.hypot(_cam.x - bx, _cam.y - by, _cam.z - bz);
    let hs = Math.max(st.head, hd * st.headPx);
    if (st.headMaxPx) hs = Math.min(hs, hd * st.headMaxPx);
    hs *= 0.5;
    const rx = _right.x * hs, ry = _right.y * hs, rz = _right.z * hs;
    const qx = _up.x * hs, qy = _up.y * hs, qz = _up.z * hs;
    tPos[v + 12] = bx - rx - qx; tPos[v + 13] = by - ry - qy; tPos[v + 14] = bz - rz - qz;
    tPos[v + 15] = bx + rx - qx; tPos[v + 16] = by + ry - qy; tPos[v + 17] = bz + rz - qz;
    tPos[v + 18] = bx - rx + qx; tPos[v + 19] = by - ry + qy; tPos[v + 20] = bz - rz + qz;
    tPos[v + 21] = bx + rx + qx; tPos[v + 22] = by + ry + qy; tPos[v + 23] = bz + rz + qz;
    tUv[v + 14] = tUv[v + 17] = tUv[v + 20] = tUv[v + 23] = a;
  }

  // Half-width at camera distance d: style width, at least wPx/m, at most wMaxPx/m.
  function _w(st, d) {
    const w = st.wMaxPx ? Math.min(st.w, d * st.wMaxPx) : st.w;
    return Math.max(w, d * (st.wPx || MIN_PX_W)) * 0.5;
  }

  function _hide(i) {
    const v = i * 24;
    for (let k = 0; k < 24; k++) tPos[v + k] = 0;
    tUv[v + 2] = tUv[v + 5] = tUv[v + 8] = tUv[v + 11] = 0;
    tUv[v + 14] = tUv[v + 17] = tUv[v + 20] = tUv[v + 23] = 0;
  }

  function _tickTracers(dt) {
    if (camera) {
      camera.getWorldPosition(_cam);
      const e = camera.matrixWorld.elements;
      _right.set(e[0], e[1], e[2]).normalize(); _up.set(e[4], e[5], e[6]).normalize();
    }
    for (let i = 0; i < MAX_TRACERS; i++) {
      const st = tStyle[i];
      if (!st) continue;
      let alpha = 1;
      if (tFade[i] > 0) {
        tFade[i] -= dt;
        if (tFade[i] <= 0) { tStyle[i] = null; tAlive--; _hide(i); continue; }
        alpha = tFade[i] / st.fade;
      } else {
        tAge[i] += dt;
        tHead[i] += st.speed * dt;
        if (tHead[i] >= tDist[i]) { tHead[i] = tDist[i]; tFade[i] = st.fade; }
      }
      const head = tHead[i];
      // While landed, the tail keeps closing in so the streak "lands".
      let len = tFade[i] > 0 ? st.len * alpha : st.len;
      // Anchored start (ADR-0139): the tail eases off the muzzle over `anchor` s,
      // so the first frames draw a streak that visibly leaves the barrel.
      if (st.anchor && tFade[i] === 0 && tAge[i] < st.anchor) {
        const k = tAge[i] / st.anchor;
        len = Math.max(len, head * (1 - k) + len * k);
      }
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
