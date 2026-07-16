// qualityTier.js — v0.2.379-alpha adaptive render-quality tier.
//
// Rolling frame-time monitor + FPS hysteresis that trades GPU fill-rate cost for
// smoothness on weaker hardware. Three tiers adjust the renderer device-pixel
// ratio and gate the bloom pass:
//
//   HIGH:   DPR 1.5,  bloom ON   (matches scene.js default cap)
//   NORMAL: DPR 1.25, bloom ON
//   LOW:    DPR 1.0,  bloom OFF
//
// Step DOWN a tier when the rolling average FPS stays < FPS_LOW for DOWN_HOLD_MS.
// Step UP a tier when it stays > FPS_HIGH for UP_HOLD_MS. The sustained-time
// accumulators give hysteresis so we don't flap between tiers on noisy frames.
//
// Pure logic: no THREE import. The renderer / composer / bloomPass handles are
// injected by the factory, so this module unit-tests in node with fakes. Single-
// player and multiplayer behave identically — the tier is independent of MP.

export const TIERS = {
  HIGH:   { name: 'HIGH',   dpr: 1.5,  bloom: true },
  NORMAL: { name: 'NORMAL', dpr: 1.25, bloom: true },
  LOW:    { name: 'LOW',    dpr: 1.0,  bloom: false },
};

// Ordered worst → best so index math (+1 up, -1 down) is unambiguous.
const ORDER = ['LOW', 'NORMAL', 'HIGH'];

export function createQualityTier({
  renderer,
  composer,
  bloomPass,
  window: win = (typeof window !== 'undefined' ? window : undefined),
  FPS_LOW = 45,
  FPS_HIGH = 55,
  DOWN_HOLD_MS = 2000,
  UP_HOLD_MS = 3000,
  RING = 60,
  startTier = 'HIGH',
} = {}) {
  // Ring buffer of recent frame times (ms). Allocated once — no per-frame alloc.
  const ring = new Float64Array(RING);
  let head = 0;      // next write index
  let count = 0;     // filled slots (<= RING)
  let sum = 0;       // running sum of ring contents (O(1) rolling average)

  let tierIdx = Math.max(0, ORDER.indexOf(startTier));
  if (tierIdx < 0) tierIdx = ORDER.length - 1;

  let belowMs = 0;   // sustained time under FPS_LOW
  let aboveMs = 0;   // sustained time over FPS_HIGH

  let _avgFrameMs = 0;
  let _avgFps = 0;

  // Metrics snapshot for the HUD — updated by update() (fps/frameMs/tier/dpr) and
  // sampleRenderInfo() (drawCalls/triangles). Reused object, no per-frame alloc.
  const _metrics = {
    fps: 0, frameMs: 0, drawCalls: 0, triangles: 0,
    tier: ORDER[tierIdx], dpr: TIERS[ORDER[tierIdx]].dpr,
  };

  function _tierDef() { return TIERS[ORDER[tierIdx]]; }

  function _apply() {
    const def = _tierDef();
    if (renderer && typeof renderer.setPixelRatio === 'function') {
      renderer.setPixelRatio(def.dpr);
      // setSize re-applies the pixel ratio to the drawing buffer.
      const w = win ? win.innerWidth : (renderer.domElement ? renderer.domElement.width : 0);
      const h = win ? win.innerHeight : (renderer.domElement ? renderer.domElement.height : 0);
      if (typeof renderer.setSize === 'function') renderer.setSize(w, h);
      if (composer && typeof composer.setPixelRatio === 'function') composer.setPixelRatio(def.dpr);
      if (composer && typeof composer.setSize === 'function') composer.setSize(w, h);
    }
    if (bloomPass) bloomPass.enabled = def.bloom;
    _metrics.tier = def.name;
    _metrics.dpr = def.dpr;
  }

  function _stepDown() {
    if (tierIdx > 0) { tierIdx--; _apply(); belowMs = 0; aboveMs = 0; return true; }
    return false;
  }
  function _stepUp() {
    if (tierIdx < ORDER.length - 1) { tierIdx++; _apply(); belowMs = 0; aboveMs = 0; return true; }
    return false;
  }

  // Called once per frame BEFORE renderFrame. dtMs is the frame delta in ms.
  function update(dtMs) {
    // Ignore stalls / tab-switch spikes / bogus deltas so a single 900 ms frame
    // after an alt-tab doesn't yank the tier down.
    if (!(dtMs > 0) || !isFinite(dtMs) || dtMs > 500) {
      return ORDER[tierIdx];
    }

    // Rolling frame-time average over the ring.
    if (count === RING) sum -= ring[head];
    ring[head] = dtMs;
    head = (head + 1) % RING;
    if (count < RING) count++;
    sum += dtMs;

    _avgFrameMs = sum / count;
    _avgFps = _avgFrameMs > 0 ? 1000 / _avgFrameMs : 0;
    _metrics.frameMs = _avgFrameMs;
    _metrics.fps = _avgFps;

    // Only make tier decisions once the ring is warm — otherwise the first few
    // frames (cold start / asset upload) would trip the down-step immediately.
    if (count >= RING) {
      if (_avgFps < FPS_LOW) {
        belowMs += dtMs; aboveMs = 0;
        if (belowMs >= DOWN_HOLD_MS) _stepDown();
      } else if (_avgFps > FPS_HIGH) {
        aboveMs += dtMs; belowMs = 0;
        if (aboveMs >= UP_HOLD_MS) _stepUp();
      } else {
        // In the dead band between FPS_LOW and FPS_HIGH — decay both timers so a
        // brief excursion doesn't accumulate toward a step.
        belowMs = 0; aboveMs = 0;
      }
    }

    return ORDER[tierIdx];
  }

  // Called once per frame AFTER renderFrame. renderer.info.render reflects the
  // draw calls / triangles of the frame just rendered; stash for the HUD.
  function sampleRenderInfo() {
    const info = renderer && renderer.info && renderer.info.render;
    if (info) {
      _metrics.drawCalls = info.calls || 0;
      _metrics.triangles = info.triangles || 0;
    }
    return _metrics;
  }

  return {
    update,
    sampleRenderInfo,
    metrics: () => _metrics,
    currentTier: () => ORDER[tierIdx],
    dpr: () => _tierDef().dpr,
    bloomOn: () => _tierDef().bloom,
    // Exposed for tests / debugging.
    _avgFps: () => _avgFps,
    _avgFrameMs: () => _avgFrameMs,
  };
}
