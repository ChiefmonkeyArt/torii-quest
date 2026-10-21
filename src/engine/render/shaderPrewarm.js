// ADR-0141: compile every material's shader while the loading screen is still
// up, so the first sight of the arena, the bots, crates, tracers and sparks
// doesn't stall the first seconds of play. three.js otherwise compiles a
// material lazily the first frame it is drawn. Uses compileAsync (parallel,
// KHR_parallel_shader_compile) when available, else compile(). Waits (frame-
// counted, no timers) for `ready()` (e.g. bot models loaded) up to a cap, and
// never throws: a failed prewarm only means lazy compiles, as before.

/**
 * @param {{ renderer: any, targets: Array<[any, any]>, ready?: () => boolean,
 *   raf?: (cb: () => void) => any, maxWaitFrames?: number, maxCompileFrames?: number,
 *   now?: () => number }} o
 * @returns {Promise<{ waitedFrames: number, ready: boolean, compiled: number, ms: number, error: string|null }>}
 */
export async function prewarmShaders({
  renderer, targets, ready = () => true,
  raf = (cb) => requestAnimationFrame(cb),
  maxWaitFrames = 180, maxCompileFrames = 240,
  now = () => performance.now(),
}) {
  const t0 = now();
  const frame = () => new Promise((r) => raf(r));
  let waitedFrames = 0;
  while (!_safe(ready) && waitedFrames < maxWaitFrames) { await frame(); waitedFrames++; }
  const isReady = _safe(ready);
  let compiled = 0, error = null;
  for (const [scene, camera] of targets || []) {
    if (!scene || !camera) continue;
    try {
      if (typeof renderer.compileAsync === 'function') {
        // Cap the wait in frames: a driver that never reports completion
        // must not hold the loading screen.
        let done = false;
        const p = Promise.resolve(renderer.compileAsync(scene, camera)).then(() => { done = true; }, (e) => { done = true; error = String(e && e.message || e); });
        let f = 0;
        while (!done && f < maxCompileFrames) { await Promise.race([p, frame()]); f++; }
      } else if (typeof renderer.compile === 'function') {
        renderer.compile(scene, camera);
      }
      compiled++;
    } catch (e) { error = String(e && e.message || e); }
  }
  return { waitedFrames, ready: isReady, compiled, ms: Math.round(now() - t0), error };
}

function _safe(fn) { try { return !!fn(); } catch { return false; } }
