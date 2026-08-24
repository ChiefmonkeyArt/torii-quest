// src/engine/kami/kamiAutoCapture.js — ADR-0055. Pure 1Hz auto-capture state machine.
//
// Captures a rolling ring of (frame + snapshot) records while the owner plays so
// the run-up to a transient glitch (phantom bots, desync) is on tape. This module
// is PURE: no DOM, no THREE, no fetch. Every edge (clock, owner-check, the frame
// grab callback, the seal+POST) is INJECTED, so the throttle / backpressure /
// report logic is unit-testable with fakes.
//
// Lifecycle: the in-arena rAF loop calls tick(nowMs, ctx) every frame. tick
// returns a capture REQUEST {frameId, ts, snapshot} or null. The caller then
// drives the async seal+POST and resolves it through markUploaded/markFailed.
// inflight backpressure: if the previous capture hasn't resolved, tick returns
// null (it does NOT queue — missed frames are skipped, never retried).
//
// Owner-only + playing-only: a non-admin or title-screen session never captures.

const DEFAULT_INTERVAL_MS = 1000; // 1Hz. Named constant so it can be raised later.
const DEFAULT_RING_CAP = 120;

let _seq = 0;

/**
 * @param {object} opts
 *   intervalMs {number}  capture throttle (default 1000)
 *   ringCap   {number}  how many captures to keep reported-state for (informational)
 */
export function createAutoCapture(opts = {}) {
  const intervalMs = typeof opts.intervalMs === 'number' && opts.intervalMs > 0
    ? opts.intervalMs : DEFAULT_INTERVAL_MS;
  const ringCap = typeof opts.ringCap === 'number' && opts.ringCap > 0
    ? opts.ringCap : DEFAULT_RING_CAP;

  // State. All mutated through the actions below.
  let inflight = false;           // a seal+POST for the last capture is still resolving
  let lastCapturedAt = null;      // ms of the last capture REQUEST emitted
  let lastFrameId = null;         // the frameId of the last capture REQUEST
  let lastUploadOkAt = null;      // ms of the last successful upload
  let lastError = null;           // last failure reason (cleared on next success)
  let captured = 0;               // total capture requests emitted
  let uploaded = 0;               // total successful uploads
  let failed = 0;                 // total failed uploads

  function nextFrameId(nowMs) {
    _seq = (_seq + 1) >>> 0;
    // frameId is sortable + unique within a session: ts-seq. The seq breaks ties
    // when two captures share a millisecond (a forced captureNow right after a
    // tick capture).
    return `ac-${nowMs}-${_seq}`;
  }

  function shouldCapture(nowMs, ctx) {
    if (!ctx) return false;
    if (!ctx.isOwner) return false;       // non-admin never captures
    if (!ctx.isPlaying) return false;      // title/pause/gameover never capture
    if (inflight) return false;           // backpressure: previous upload still resolving
    if (lastCapturedAt !== null && (nowMs - lastCapturedAt) < intervalMs) return false;
    return true;
  }

  /**
   * Called from the in-arena rAF loop every frame. Returns a capture request or null.
   * @returns {{frameId:string, ts:number, snapshot:*}|null}
   */
  function tick(nowMs, ctx) {
    if (!shouldCapture(nowMs, ctx)) return null;
    const frameId = nextFrameId(nowMs);
    const ts = nowMs;
    let snapshot = null;
    try { snapshot = ctx.takeSnapshot ? ctx.takeSnapshot() : null; } catch { snapshot = null; }
    inflight = true;
    lastCapturedAt = ts;
    lastFrameId = frameId;
    lastError = null; // a new capture supersedes any prior per-tick error
    captured += 1;
    return { frameId, ts, snapshot };
  }

  /**
   * Force a capture ignoring the interval (a manual "mark this moment"). Still
   * respects owner + playing + !inflight.
   */
  function captureNow(nowMs, ctx) {
    // Temporarily ignore the interval by pretending lastCapturedAt is far in the
    // past — but only for the shouldCapture interval check, which we bypass by
    // checking the other guards directly.
    if (!ctx || !ctx.isOwner || !ctx.isPlaying || inflight) return null;
    const frameId = nextFrameId(nowMs);
    const ts = nowMs;
    let snapshot = null;
    try { snapshot = ctx.takeSnapshot ? ctx.takeSnapshot() : null; } catch { snapshot = null; }
    inflight = true;
    lastCapturedAt = ts;
    lastFrameId = frameId;
    captured += 1;
    return { frameId, ts, snapshot };
  }

  /** The async seal+POST resolved OK. */
  function markUploaded(frameId, nowMs) {
    if (frameId !== lastFrameId) return; // a stale resolution for an older frame
    inflight = false;
    lastUploadOkAt = typeof nowMs === 'number' ? nowMs : Date.now();
    lastError = null;
    uploaded += 1;
  }

  /** The async seal+POST failed. Resets inflight but does NOT pause future captures. */
  function markFailed(frameId, err, nowMs) {
    if (frameId !== lastFrameId) return;
    inflight = false;
    lastError = typeof err === 'string' && err ? err : (err && err.message) || 'unknown';
    failed += 1;
  }

  /** A snapshot of the state for the debug surface. */
  function report() {
    return {
      enabled: true,
      intervalMs,
      ringCap,
      inflight,
      lastFrameId,
      lastCapturedAt,
      lastUploadOkAt,
      lastError,
      captured,
      uploaded,
      failed,
    };
  }

  function reset() {
    inflight = false;
    lastCapturedAt = null;
    lastFrameId = null;
    lastUploadOkAt = null;
    lastError = null;
    captured = 0;
    uploaded = 0;
    failed = 0;
  }

  return { tick, captureNow, markUploaded, markFailed, report, reset };
}

export const AUTOCAP_INTERVAL_MS = DEFAULT_INTERVAL_MS;
export const AUTOCAP_RING_CAP = DEFAULT_RING_CAP;
