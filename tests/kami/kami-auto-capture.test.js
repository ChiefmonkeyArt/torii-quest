// tests/kami/kami-auto-capture.test.js — ADR-0055. Pure state machine tests.
//
// The 1Hz throttle, owner-only / playing-only gates, and inflight backpressure
// are all pure logic with injected clock + ctx — no DOM, no THREE, no fetch.

import { describe, it, expect } from 'vitest';
import { createAutoCapture } from '../../src/engine/kami/kamiAutoCapture.js';

function ctx(overrides = {}) {
  return {
    isOwner: true,
    isPlaying: true,
    takeSnapshot: () => ({ stub: 'snap' }),
    ...overrides,
  };
}

describe('kamiAutoCapture — 1Hz throttle', () => {
  it('emits a capture on the first tick when owner + playing', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    const req = ac.tick(1000, ctx());
    expect(req).not.toBeNull();
    expect(req.frameId).toMatch(/^ac-1000-/);
    expect(req.ts).toBe(1000);
    expect(req.snapshot).toEqual({ stub: 'snap' });
    expect(ac.report().captured).toBe(1);
    expect(ac.report().inflight).toBe(true);
  });

  it('does NOT emit again within the interval (1Hz throttle)', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    expect(ac.tick(1000, ctx())).not.toBeNull();
    expect(ac.tick(1500, ctx())).toBeNull(); // 500ms later — under interval
    expect(ac.tick(1999, ctx())).toBeNull(); // 999ms later — still under
    expect(ac.report().captured).toBe(1);
  });

  it('emits again exactly at the interval boundary once the previous upload resolves', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    const r1 = ac.tick(1000, ctx());
    expect(r1).not.toBeNull();
    ac.markUploaded(r1.frameId, 1100); // previous upload resolved → inflight clears
    expect(ac.tick(2000, ctx())).not.toBeNull(); // exactly 1000ms later
    expect(ac.report().captured).toBe(2);
  });
});

describe('kamiAutoCapture — owner + playing gates', () => {
  it('never captures for a non-owner', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    expect(ac.tick(1000, ctx({ isOwner: false }))).toBeNull();
    expect(ac.report().captured).toBe(0);
  });

  it('never captures while not playing (title/pause)', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    expect(ac.tick(1000, ctx({ isPlaying: false }))).toBeNull();
    expect(ac.report().captured).toBe(0);
  });

  it('never captures with no ctx', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    expect(ac.tick(1000, null)).toBeNull();
    expect(ac.report().captured).toBe(0);
  });
});

describe('kamiAutoCapture — inflight backpressure', () => {
  it('skips a tick while the previous upload is still in flight', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    expect(ac.tick(1000, ctx())).not.toBeNull(); // inflight now true
    // Even past the interval, inflight blocks the next capture.
    expect(ac.tick(5000, ctx())).toBeNull();
    expect(ac.report().captured).toBe(1);
  });

  it('emits again once the previous upload resolves OK', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    const r1 = ac.tick(1000, ctx());
    expect(r1).not.toBeNull();
    ac.markUploaded(r1.frameId, 1100);
    expect(ac.report().inflight).toBe(false);
    expect(ac.report().uploaded).toBe(1);
    expect(ac.tick(2000, ctx())).not.toBeNull();
  });

  it('emits again once the previous upload resolves FAILED (does not pause)', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    const r1 = ac.tick(1000, ctx());
    ac.markFailed(r1.frameId, 'HTTP 500', 1100);
    expect(ac.report().inflight).toBe(false);
    expect(ac.report().failed).toBe(1);
    expect(ac.report().lastError).toBe('HTTP 500');
    // A failure does NOT pause future captures — a transient relay error retries.
    expect(ac.tick(2000, ctx())).not.toBeNull();
  });

  it('ignores a stale resolution for an older frame', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    const r1 = ac.tick(1000, ctx());
    ac.markUploaded(r1.frameId, 1100);
    const r2 = ac.tick(2000, ctx());
    // A late resolution for r1 must NOT clear r2's inflight.
    ac.markUploaded(r1.frameId, 2100);
    expect(ac.report().inflight).toBe(true);
    ac.markUploaded(r2.frameId, 2200);
    expect(ac.report().inflight).toBe(false);
    expect(ac.report().uploaded).toBe(2);
  });
});

describe('kamiAutoCapture — captureNow (forced)', () => {
  it('forces a capture ignoring the interval', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    expect(ac.tick(1000, ctx())).not.toBeNull();
    ac.markUploaded(ac.report().lastFrameId, 1100);
    // captureNow ignores the interval but still respects owner + playing + !inflight.
    expect(ac.captureNow(1050, ctx())).not.toBeNull();
    expect(ac.report().captured).toBe(2);
  });

  it('still respects inflight backpressure', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    ac.tick(1000, ctx()); // inflight
    expect(ac.captureNow(1050, ctx())).toBeNull();
  });

  it('still respects owner + playing gates', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    expect(ac.captureNow(1000, ctx({ isOwner: false }))).toBeNull();
    expect(ac.captureNow(1000, ctx({ isPlaying: false }))).toBeNull();
  });
});

describe('kamiAutoCapture — report + reset', () => {
  it('report surfaces the full state', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    const r = ac.tick(1000, ctx());
    ac.markUploaded(r.frameId, 1200);
    const rep = ac.report();
    expect(rep.enabled).toBe(true);
    expect(rep.intervalMs).toBe(1000);
    expect(rep.captured).toBe(1);
    expect(rep.uploaded).toBe(1);
    expect(rep.lastFrameId).toBe(r.frameId);
    expect(rep.lastUploadOkAt).toBe(1200);
    expect(rep.lastError).toBeNull();
  });

  it('reset clears all state', () => {
    const ac = createAutoCapture({ intervalMs: 1000 });
    const r = ac.tick(1000, ctx());
    ac.markFailed(r.frameId, 'boom', 1100);
    ac.reset();
    const rep = ac.report();
    expect(rep.captured).toBe(0);
    expect(rep.uploaded).toBe(0);
    expect(rep.failed).toBe(0);
    expect(rep.inflight).toBe(false);
    expect(rep.lastCapturedAt).toBeNull();
  });
});
