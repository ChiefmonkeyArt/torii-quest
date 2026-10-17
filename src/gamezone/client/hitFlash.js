// src/gamezone/client/hitFlash.js — bot hit flash that restores each material.
//
// Both bot GLBs are lit by an emissive texture (emissiveFactor [1,1,1] plus an
// emissiveMap) and are metallic by default, so with no environment map the
// emissive channel IS their visible colour. The first v2 flash faded emissive
// to black instead of back to each material's own value, so every bot that was
// ever hit stayed dark for good, including after respawning. This records the
// originals once and blends: k = 1 is full red, k = 0 is exactly the original.

const RED_R = 0.9, RED_G = 0.08, RED_B = 0.04;

/** `materials`: the emissive-capable materials of one bot (already cloned per bot). */
export function createHitFlash(materials) {
  const mats = [];
  const orig = [];   // [r, g, b, intensity] per material
  for (const m of materials || []) {
    if (!m || !m.emissive) continue;
    mats.push(m);
    orig.push([m.emissive.r, m.emissive.g, m.emissive.b,
      Number.isFinite(m.emissiveIntensity) ? m.emissiveIntensity : 1]);
  }
  let lastK = 0;
  return {
    get count() { return mats.length; },
    /** Blend toward red by k in [0, 1]. Calling with k = 0 restores the originals exactly. */
    apply(k) {
      const t = k > 0 ? Math.min(1, k) : 0;
      if (t === 0 && lastK === 0) return;
      lastK = t;
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i], o = orig[i];
        if (t === 0) {
          m.emissive.setRGB(o[0], o[1], o[2]);
          m.emissiveIntensity = o[3];
        } else {
          m.emissive.setRGB(o[0] + (RED_R - o[0]) * t, o[1] + (RED_G - o[1]) * t, o[2] + (RED_B - o[2]) * t);
          m.emissiveIntensity = o[3] + (1 - o[3]) * t;
        }
      }
    },
  };
}
