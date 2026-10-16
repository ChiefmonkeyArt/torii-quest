// src/gamezone/client/fx.js — tracers + impact sparks for the Game Zone (ADR-0130).
//
// Two draw calls total, whatever is happening: every tracer lives in ONE
// LineSegments buffer and every spark in ONE Points buffer. Additive blending
// with vertex colours, so fading = scaling the colour toward black (no
// transparency sorting, no per-effect material). Ring-buffer allocation: when
// the pool is full the oldest effect is recycled. Zero allocation per shot.

import * as THREE from 'three';

const MAX_TRACERS = 48;
const MAX_SPARKS = 192;
const SPARKS_PER_HIT = 8;
const SPARK_TTL = 0.45;
const SPARK_G = -9;

export const TRACER_PLAYER = Object.freeze({ r: 0.75, g: 0.45, b: 1.0, ttl: 0.06 });
export const TRACER_BOT = Object.freeze({ r: 0.35, g: 1.0, b: 0.45, ttl: 0.12 });
export const TRACER_PEER = Object.freeze({ r: 1.0, g: 0.55, b: 0.2, ttl: 0.08 });
const SPARK_WALL = Object.freeze({ r: 1.0, g: 0.7, b: 0.28 });
const SPARK_FLESH = Object.freeze({ r: 1.0, g: 0.18, b: 0.1 });

export function createGzFx(parent) {
  // ── tracers ──
  const tPos = new Float32Array(MAX_TRACERS * 6);
  const tCol = new Float32Array(MAX_TRACERS * 6);
  const tBase = new Float32Array(MAX_TRACERS * 3);
  const tLife = new Float32Array(MAX_TRACERS);
  const tTtl = new Float32Array(MAX_TRACERS);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const tMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = new THREE.LineSegments(tGeo, tMat);
  tracers.frustumCulled = false;
  tracers.renderOrder = 10;
  tracers.raycast = () => {};
  parent.add(tracers);
  let tNext = 0, tAlive = 0;

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

  function tracer(ax, ay, az, bx, by, bz, style = TRACER_PLAYER) {
    const i = tNext; tNext = (tNext + 1) % MAX_TRACERS;
    if (tLife[i] <= 0) tAlive++;
    const o = i * 6;
    tPos[o] = ax; tPos[o + 1] = ay; tPos[o + 2] = az;
    tPos[o + 3] = bx; tPos[o + 4] = by; tPos[o + 5] = bz;
    tBase[i * 3] = style.r; tBase[i * 3 + 1] = style.g; tBase[i * 3 + 2] = style.b;
    tLife[i] = tTtl[i] = style.ttl;
    tGeo.attributes.position.needsUpdate = true;
  }

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
    if (tAlive) {
      for (let i = 0; i < MAX_TRACERS; i++) {
        if (tLife[i] <= 0) continue;
        tLife[i] -= dt;
        const k = tLife[i] > 0 ? tLife[i] / tTtl[i] : 0;
        if (tLife[i] <= 0) tAlive--;
        const o = i * 6, b = i * 3;
        // Head (barrel end) fades faster than the tail for a streak look.
        tCol[o] = tBase[b] * k * k; tCol[o + 1] = tBase[b + 1] * k * k; tCol[o + 2] = tBase[b + 2] * k * k;
        tCol[o + 3] = tBase[b] * k; tCol[o + 4] = tBase[b + 1] * k; tCol[o + 5] = tBase[b + 2] * k;
      }
      tGeo.attributes.color.needsUpdate = true;
    }
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
    tLife.fill(0); tCol.fill(0); sLife.fill(0); sCol.fill(0);
    tAlive = sAlive = 0;
    tGeo.attributes.color.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
  }

  function dispose() {
    parent.remove(tracers); parent.remove(sparks);
    tGeo.dispose(); sGeo.dispose(); tMat.dispose(); sMat.dispose();
  }

  return { tracer, impact, tick, clear, dispose, get active() { return tAlive + sAlive; } };
}
