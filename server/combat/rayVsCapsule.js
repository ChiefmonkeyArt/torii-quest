// server/combat/rayVsCapsule.js — pure analytic ray-vs-capsule / ray-vs-sphere.
// MP-2 (v0.2.364-alpha). Node-safe, no imports.
//
// Convention: rays are (origin, dir) where dir is NOT required to be
// unit-length (we normalise defensively). t returned is distance along dir
// after normalisation; if unnormalised, callers should treat t as metric
// distance ONLY when we've normalised.
//
// A capsule is {p0, p1, r} where p0, p1 are the cylinder-axis endpoints
// (cap centres). A sphere is {c, r}.
//
// intersectCapsule / intersectSphere return { hit:boolean, t:number, point:[x,y,z] }
// with t=Infinity when hit=false. t is the smallest positive intersection distance.
//
// rayVsPeer(origin, dir, colliders) is the combined test: head sphere is
// preferred over body when both intersect within a small "head-wins" epsilon,
// to keep the shipped classifier's head-over-body semantics (see
// engine/combat/classifier.js).

const EPS = 1e-6;

// ---- vector helpers (all allocate-return; only called on shot-resolve path) ----

function sub(a, b)   { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a, b)   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function cross(a, b) { return [ a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0] ]; }
function len(v)      { return Math.sqrt(dot(v,v)); }
function scale(v,s)  { return [v[0]*s, v[1]*s, v[2]*s]; }
function add(a,b)    { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }

function normalise(v) {
  const l = len(v);
  if (l < EPS) return [0, 0, 0];
  return [v[0]/l, v[1]/l, v[2]/l];
}

// ---- ray vs sphere ----

/** Ray-vs-sphere. Returns nearest positive t. */
export function intersectSphere(origin, dir, sphere) {
  const d = normalise(dir);
  const oc = sub(origin, sphere.c);
  const b = dot(oc, d);
  const c = dot(oc, oc) - sphere.r * sphere.r;
  const disc = b*b - c;
  if (disc < 0) return miss();
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  const t1 = -b + s;
  // Prefer the nearest positive root; if the ray starts inside, t0 will be
  // negative — return t1 in that case (rare for our shots but keep sane).
  let t = t0 >= 0 ? t0 : (t1 >= 0 ? t1 : -1);
  if (t < 0) return miss();
  return { hit: true, t, point: add(origin, scale(d, t)) };
}

// ---- ray vs capsule (finite cylinder + two hemispherical caps) ----

/** Ray-vs-capsule. Returns nearest positive t across the cylinder + both hemispheres. */
export function intersectCapsule(origin, dir, cap) {
  const d = normalise(dir);
  const axis = sub(cap.p1, cap.p0);
  const axisLen = len(axis);
  if (axisLen < EPS) {
    // Degenerate — treat as a sphere at p0.
    return intersectSphere(origin, dir, { c: cap.p0, r: cap.r });
  }
  const ax = scale(axis, 1 / axisLen); // unit axis

  // Cylinder body (infinite), then clamp to segment.
  // Standard trick: subtract the projection along ax from both origin-p0 and d.
  const m = sub(origin, cap.p0);
  const md = dot(m, ax);
  const dd = dot(d, ax);
  // Perpendicular components.
  const mPerp = sub(m, scale(ax, md));
  const dPerp = sub(d, scale(ax, dd));

  const A = dot(dPerp, dPerp);
  const B = dot(mPerp, dPerp);
  const C = dot(mPerp, mPerp) - cap.r * cap.r;

  let bestT = Infinity;

  if (A > EPS) {
    const disc = B*B - A*C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const candidates = [(-B - s) / A, (-B + s) / A];
      for (const t of candidates) {
        if (t <= 0 || t >= bestT) continue;
        // Check the hit lies within the finite segment.
        const hitAxisT = md + t * dd;
        if (hitAxisT >= 0 && hitAxisT <= axisLen) {
          bestT = t;
        }
      }
    }
  }

  // Hemisphere caps at p0 and p1.
  const capA = intersectSphere(origin, d, { c: cap.p0, r: cap.r });
  if (capA.hit) {
    // Only accept if the hit is on the "outer" hemisphere (below-axis side of p0).
    const hitPt = capA.point;
    const along = dot(sub(hitPt, cap.p0), ax);
    if (along <= 0 && capA.t < bestT) bestT = capA.t;
  }
  const capB = intersectSphere(origin, d, { c: cap.p1, r: cap.r });
  if (capB.hit) {
    const hitPt = capB.point;
    const along = dot(sub(hitPt, cap.p1), ax);
    if (along >= 0 && capB.t < bestT) bestT = capB.t;
  }

  if (bestT === Infinity) return miss();
  return { hit: true, t: bestT, point: add(origin, scale(d, bestT)) };
}

// ---- combined per-peer test ----

/**
 * Test a ray against one peer's head+body colliders. Head wins on ties
 * (within EPS) and when the head hit is BEFORE OR EQUAL to the body hit,
 * matching the shipped classifier's "sphere overlaps body cap → head" rule.
 *
 * @returns {{ hit:boolean, t:number, zone:'head'|'body' } | { hit:false, t:Infinity, zone:null }}
 */
export function rayVsPeer(origin, dir, colliders) {
  const h = intersectSphere(origin, dir, colliders.headSphere);
  const b = intersectCapsule(origin, dir, colliders.bodyCap);
  if (!h.hit && !b.hit) return { hit: false, t: Infinity, zone: null };
  if (h.hit && !b.hit) return { hit: true, t: h.t, zone: 'head' };
  if (b.hit && !h.hit) return { hit: true, t: b.t, zone: 'body' };
  // Both hit — head wins if it's not distinctly behind the body hit.
  if (h.t <= b.t + EPS) return { hit: true, t: h.t, zone: 'head' };
  return { hit: true, t: b.t, zone: 'body' };
}

function miss() { return { hit: false, t: Infinity, point: null }; }
