#!/usr/bin/env node
// tools/gamezone-bench.mjs — Game Zone v2 combat-quality bench (ADR-0130).
//
//   node tools/gamezone-bench.mjs [--rays 300] [--poses 8] [--json out.json] [--soft-timing]
//   npm run bench:gamezone
//
// 1. HIT CONSISTENCY. Fires random rays at the real animated bot meshes and
//    takes the triangle the ray actually strikes as ground truth (zone =
//    anatomical: head when the struck vertices sit at or above the neck line in
//    the rest pose — the banker rig's "Head" bone also drives the torso, so bone
//    names cannot decide the zone). Three hit models answer
//    the same rays:
//      legacy   — the production MP collider (fixed capsule r0.35 to 1.61 m +
//                 head sphere r0.35 @ 1.55 m, nearest-surface zone) against
//                 clips WITH their root motion (as shipped up to v0.2.894).
//      coarse   — the v2 authority's fallback body (no client claim).
//      skeletal — the v2 client hitbox (capsule broad phase + exact skinned
//                 triangles), clips with root motion stripped (what the player
//                 now shoots at).
//    Also reports how many skeletal claims the authority's validator rejects.
// 2. SIM COST. Ticks the v2 authority with 4 players for N ticks; p50/p99/max.
//
// Deterministic (seeded). Exit code 1 when the v2 gates fail:
//   skeletal hit agreement ≥ 97 %, skeletal zone agreement ≥ 97 %,
//   validator false-reject ≤ 0.5 %, sim tick p99 ≤ 2 ms, no tick over 5 ms
//   (timing gates become warnings with --soft-timing).

import * as THREE from 'three';
import { loadGlbNode } from './gamezone/glbNode.mjs';
import { fitHitboxParts, createHitboxRig, stripRootMotion, isHeadVertex } from '../src/gamezone/client/hitbox.js';
import { rayVsBody, validateClaim } from '../src/gamezone/core/body.js';
import { raySphere, rayCapsule, createRng } from '../src/gamezone/core/geom.js';
import { BOT_KINDS, FLINCH_HEAD_RAD } from '../src/gamezone/core/constants.js';
import { BOT_TEMPLATES } from '../src/gamezone/client/botTemplates.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RAYS = Number(arg('--rays', 300));
const POSES = Number(arg('--poses', 8));
const JSON_OUT = arg('--json', null);

const clipsOf = (k) => [...new Set(Object.values(BOT_TEMPLATES[k].anims).filter((a) => !a.once && a.timeScale).map((a) => a.clip))];
const MODELS = ['regular', 'boss'].map((kind) => ({
  kind, url: 'public' + BOT_TEMPLATES[kind].url, target: BOT_TEMPLATES[kind].target,
  neckY: BOT_TEMPLATES[kind].neckY, clips: clipsOf(kind),
}));

// Legacy production collider (server/bots/botColliders.js @ v0.2.894, frozen here).
function legacyRay(o, d, scale) {
  const r = 0.35 * scale;
  const tb = rayCapsule(o[0], o[1], o[2], d[0], d[1], d[2], 0, r, 0, 0, 1.26 * scale, 0, r);
  const th = raySphere(o[0], o[1], o[2], d[0], d[1], d[2], 0, 1.55 * scale, 0, r);
  if (tb < 0 && th < 0) return null;
  if (th >= 0 && (tb < 0 || th <= tb)) return { t: th, zone: 'head' };
  return { t: tb, zone: 'body' };
}

async function loadModel(m, strip) {
  const g = await loadGlbNode(m.url);
  let sk = null;
  g.scene.traverse((o) => { if (o.isSkinnedMesh && !sk) sk = o; });
  if (strip) stripRootMotion(g.animations);
  const root = g.scene;
  let s = 1, lift = 0;
  if (m.target) {
    sk.geometry.computeBoundingBox();
    const b = sk.geometry.boundingBox;
    s = m.target / (b.max.y - b.min.y);
    lift = -b.min.y * s;
  }
  const holder = new THREE.Group();
  holder.add(root);
  root.scale.multiplyScalar(s);
  root.position.y = lift;
  const mixer = new THREE.AnimationMixer(root);
  return { g, sk, root, holder, mixer, scale: s };
}

function skinAll(sk, out) {
  const pos = sk.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    sk.applyBoneTransform(i, v);
    v.applyMatrix4(sk.matrixWorld);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
}

// Möller–Trumbore over every triangle (ground truth).
function truthRay(o, d, P, idx, headVert) {
  let best = Infinity, zone = null;
  const e1 = [0, 0, 0], e2 = [0, 0, 0];
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    e1[0] = P[b] - P[a]; e1[1] = P[b + 1] - P[a + 1]; e1[2] = P[b + 2] - P[a + 2];
    e2[0] = P[c] - P[a]; e2[1] = P[c + 1] - P[a + 1]; e2[2] = P[c + 2] - P[a + 2];
    const px = d[1] * e2[2] - d[2] * e2[1], py = d[2] * e2[0] - d[0] * e2[2], pz = d[0] * e2[1] - d[1] * e2[0];
    const det = e1[0] * px + e1[1] * py + e1[2] * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1[2] - tz * e1[1], qy = tz * e1[0] - tx * e1[2], qz = tx * e1[1] - ty * e1[0];
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
    if (t > 1e-4 && t < best) {
      best = t;
      // Zone by the barycentric-nearest vertex's dominant bone.
      const w0 = 1 - u - v;
      const vi = w0 >= u && w0 >= v ? idx[k] : (u >= v ? idx[k + 1] : idx[k + 2]);
      zone = headVert[vi] ? 'head' : 'body';
    }
  }
  return best < Infinity ? { t: best, zone } : null;
}

function blank() { return { rays: 0, truthHits: 0, hitAgree: 0, fp: 0, fn: 0, bothHit: 0, zoneAgree: 0, truthHead: 0, headRecall: 0, falseHead: 0 }; }
function score(acc, truth, got) {
  acc.rays++;
  if (truth) acc.truthHits++;
  if (!!truth === !!got) acc.hitAgree++;
  if (got && !truth) acc.fp++;
  if (truth && !got) acc.fn++;
  if (truth && got) {
    acc.bothHit++;
    if (truth.zone === got.zone) acc.zoneAgree++;
    if (truth.zone === 'head') { acc.truthHead++; if (got.zone === 'head') acc.headRecall++; }
    else if (got.zone === 'head') acc.falseHead++;
  }
}
function summarise(a) {
  const pct = (n, d) => (d ? +(100 * n / d).toFixed(2) : null);
  return {
    rays: a.rays, truthHits: a.truthHits,
    hitAgreePct: pct(a.hitAgree, a.rays), falsePosPct: pct(a.fp, a.rays), falseNegPct: pct(a.fn, a.rays),
    zoneAgreePct: pct(a.zoneAgree, a.bothHit), headRecallPct: pct(a.headRecall, a.truthHead),
    falseHeadPct: pct(a.falseHead, a.bothHit - a.truthHead),
  };
}

async function hitBench() {
  const out = {};
  for (const m of MODELS) {
    const legacy = await loadModel(m, false);
    const v2 = await loadModel(m, true);
    const parts = fitHitboxParts(v2.sk, { neckY: m.neckY });
    const rig = createHitboxRig(v2.sk, parts);
    const spec = BOT_KINDS[m.kind];
    const legacyScale = m.kind === 'boss' ? spec.radius / 0.35 : 1;
    // Ground-truth zone is anatomical: rest-pose height at/above the neck line.
    const gp = v2.sk.geometry.attributes.position;
    const headV = new Uint8Array(gp.count);
    for (let i = 0; i < gp.count; i++) headV[i] = isHeadVertex(gp.getY(i), m.neckY) ? 1 : 0;
    const headL = headV;
    const idx = v2.sk.geometry.index.array;
    const n = v2.sk.geometry.attributes.position.count;
    const PL = new Float32Array(n * 3), PV = new Float32Array(n * 3);
    const acc = { legacy: blank(), coarse: blank(), skeletal: blank() };
    let claims = 0, rejected = 0, rayMs = 0, rayN = 0;
    let fClaims = 0, fRejected = 0; // ADR-0131: honest claims on a bot at max flinch lean
    const reasons = {};
    const rng = createRng(m.kind === 'boss' ? 0xb055 : 0xbabe);
    for (const clipName of m.clips) {
      const cL = legacy.g.animations.find((c) => c.name === clipName);
      const cV = v2.g.animations.find((c) => c.name === clipName);
      if (!cL || !cV) continue;
      legacy.mixer.stopAllAction(); legacy.mixer.clipAction(cL).reset().play();
      v2.mixer.stopAllAction(); v2.mixer.clipAction(cV).reset().play();
      for (let p = 0; p < POSES; p++) {
        const t = (p + 0.5) / POSES * cV.duration;
        const yaw = rng() * Math.PI * 2;
        for (const M of [legacy, v2]) { M.mixer.setTime(t); M.holder.rotation.y = yaw; M.holder.updateMatrixWorld(true); }
        skinAll(legacy.sk, PL); skinAll(v2.sk, PV);
        rig.update();
        rig.raycast(0, 50, 0, 0, -1, 0, 1); // warm
        for (let r = 0; r < RAYS; r++) {
          // Aim at a random point near the VISIBLE mesh (±0.3 m) from 4–25 m away at eye height.
          const useL = r & 1; // half the rays sample each mesh so both get fair coverage
          const P = useL ? PL : PV;
          const vi = Math.floor(rng() * n) * 3;
          const tx = P[vi] + (rng() - 0.5) * 0.6, ty = P[vi + 1] + (rng() - 0.5) * 0.6, tz = P[vi + 2] + (rng() - 0.5) * 0.6;
          const dist = 4 + rng() * 21, az = rng() * Math.PI * 2;
          const o = [Math.sin(az) * dist, 1.0 + rng() * 1.4, Math.cos(az) * dist];
          let d = [tx - o[0], ty - o[1], tz - o[2]];
          const L = Math.hypot(...d); d = d.map((x) => x / L);
          // Legacy: hitbox vs the mesh the player SAW (root motion on).
          const truthL = truthRay(o, d, PL, idx, headL);
          score(acc.legacy, truthL, legacyRay(o, d, legacyScale));
          // v2: coarse + skeletal vs the root-motion-free mesh.
          const truthV = truthRay(o, d, PV, idx, headV);
          score(acc.coarse, truthV, rayVsBody(o[0], o[1], o[2], d[0], d[1], d[2], 200, 0, 0, 0, spec));
          const ts = performance.now();
          const sk = rig.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 200);
          rayMs += performance.now() - ts; rayN++;
          score(acc.skeletal, truthV, sk);
          if (sk) {
            claims++;
            const v = validateClaim(o[0], o[1], o[2], d[0], d[1], d[2], 200, 0, 0, 0, spec, { zone: sk.zone, dist: sk.t });
            if (!v.ok || v.zone !== sk.zone) { rejected++; const why = v.ok ? 'downgraded' : v.reason; reasons[why] = (reasons[why] || 0) + 1; }
          }
        }
        // Flinch pass (ADR-0131): the same pose leaned by the strongest hit
        // reaction, in a random direction. The authority validates against the
        // UNLEANED body, so this proves a reaction never costs a fair hit.
        {
          const la = rng() * Math.PI * 2;
          v2.holder.rotation.set(Math.cos(la) * FLINCH_HEAD_RAD, yaw, Math.sin(la) * FLINCH_HEAD_RAD);
          v2.holder.updateMatrixWorld(true);
          skinAll(v2.sk, PV);
          rig.update(); rig.raycast(0, 50, 0, 0, -1, 0, 1);
          for (let r = 0; r < RAYS; r++) {
            const vi = Math.floor(rng() * n) * 3;
            const tx = PV[vi] + (rng() - 0.5) * 0.6, ty = PV[vi + 1] + (rng() - 0.5) * 0.6, tz = PV[vi + 2] + (rng() - 0.5) * 0.6;
            const dist = 4 + rng() * 21, az = rng() * Math.PI * 2;
            const o = [Math.sin(az) * dist, 1.0 + rng() * 1.4, Math.cos(az) * dist];
            let d = [tx - o[0], ty - o[1], tz - o[2]];
            const L = Math.hypot(...d); d = d.map((x) => x / L);
            const sk = rig.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 200);
            if (!sk) continue;
            fClaims++;
            const v = validateClaim(o[0], o[1], o[2], d[0], d[1], d[2], 200, 0, 0, 0, spec, { zone: sk.zone, dist: sk.t });
            if (!v.ok || v.zone !== sk.zone) fRejected++;
          }
          v2.holder.rotation.set(0, yaw, 0);
          v2.holder.updateMatrixWorld(true);
        }
      }
    }
    out[m.kind] = {
      parts: parts.length,
      legacy: summarise(acc.legacy), coarse: summarise(acc.coarse), skeletal: summarise(acc.skeletal),
      validator: { claims, rejectedOrDowngraded: rejected, rejectPct: claims ? +(100 * rejected / claims).toFixed(2) : 0, reasons },
      validatorFlinch: { leanRad: FLINCH_HEAD_RAD, claims: fClaims, rejectedOrDowngraded: fRejected, rejectPct: fClaims ? +(100 * fRejected / fClaims).toFixed(2) : 0 },
      exactRaycastMsAvg: +(rayMs / Math.max(1, rayN)).toFixed(3),
    };
  }
  return out;
}

async function simBench() {
  const { sharedArenaWorld } = await import('../src/gamezone/core/arenaWorld.js');
  const { createGameZoneSim } = await import('../src/gamezone/core/sim.js');
  const t0 = performance.now();
  const world = sharedArenaWorld();
  const buildMs = performance.now() - t0;
  const sim = createGameZoneSim({ world, seed: 42 });
  const rng = createRng(7);
  const ids = ['a', 'b', 'c', 'd'];
  for (const id of ids) { const p = world.randomWalkable(rng); sim.addPlayer(id, { pos: [p.x, world.footY(p.x, p.z) + 1.7, p.z] }); }
  const N = Number(arg('--ticks', 6000));
  const times = new Float64Array(N);
  let seq = 0;
  for (let i = 0; i < N; i++) {
    const s = performance.now();
    for (const id of ids) {
      const p = sim.players.get(id);
      if (!p.alive) continue;
      // wander + fire at the nearest bot ~8×/s
      p.x += (rng() - 0.5) * 0.3; p.z += (rng() - 0.5) * 0.3;
      if (!world.walkable(p.x, p.z)) { const q = world.randomWalkable(rng); p.x = q.x; p.z = q.z; }
      p.y = world.footY(p.x, p.z);
      if (rng() < 0.4) {
        let tgt = null, bd = Infinity;
        for (const b of sim.bots.values()) { const dd = Math.hypot(b.x - p.x, b.z - p.z); if (b.st === 0 && dd < bd) { bd = dd; tgt = b; } }
        if (tgt) {
          const o = [p.x, p.y + 1.7, p.z];
          const d = [tgt.x - p.x, tgt.y + 1.0 + rng() - p.y - 1.7, tgt.z - p.z];
          const L = Math.hypot(...d);
          sim.fire(id, { seq: seq++, origin: o, dir: d, rt: sim.tick - 2, claim: { k: 'bot', id: tgt.id, zone: rng() < 0.3 ? 'head' : 'body', dist: L } });
        }
      }
    }
    sim.step();
    times[i] = performance.now() - s;
  }
  const sorted = Array.from(times.slice(200)).sort((a, b) => a - b);
  const q = (f) => +sorted[Math.floor(f * (sorted.length - 1))].toFixed(3);
  return { worldBuildMs: +buildMs.toFixed(0), ticks: N, p50: q(0.5), p99: q(0.99), max: q(1), over5ms: sorted.filter((x) => x > 5).length };
}

const hit = await hitBench();
const sim = await simBench();
const report = { generatedAt: new Date().toISOString(), rays: RAYS, poses: POSES, hit, sim };
console.log(JSON.stringify(report, null, 2));
if (JSON_OUT) { const fs = await import('fs'); fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n'); }

const fails = [];
for (const k of Object.keys(hit)) {
  const s = hit[k].skeletal;
  if (s.hitAgreePct < 97) fails.push(`${k}: skeletal hit agreement ${s.hitAgreePct}% < 97%`);
  if (s.zoneAgreePct < 97) fails.push(`${k}: skeletal zone agreement ${s.zoneAgreePct}% < 97%`);
  if (hit[k].validator.rejectPct > 0.5) fails.push(`${k}: validator rejects ${hit[k].validator.rejectPct}% of honest claims`);
  if (hit[k].validatorFlinch.rejectPct > 0.5) fails.push(`${k}: validator rejects ${hit[k].validatorFlinch.rejectPct}% of honest claims on a flinching bot`);
}
// Timing gates are machine/load dependent: `--soft-timing` (used by the unit
// test, which runs alongside the rest of the suite) reports them without failing.
const timing = [];
if (sim.p99 > 2) timing.push(`sim tick p99 ${sim.p99}ms > 2ms`);
if (sim.over5ms > 0) timing.push(`${sim.over5ms} sim ticks over 5ms`);
if (process.argv.includes('--soft-timing')) { for (const t of timing) console.error('timing (soft): ' + t); }
else fails.push(...timing);
if (fails.length) { console.error('GATES FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
console.error('gates: PASS');
