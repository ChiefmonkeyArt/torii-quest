// engine/diagnostics/freezeWatchdog.js — off-thread main-thread stall monitor.
//
// v0.2.778-alpha (Bug L): a hard title-screen freeze (nothing clickable, hard
// refresh does nothing, must close the tab) is the signature of a SYNCHRONOUS
// infinite loop on the main thread. No async API inside the renderer can observe
// that from within — a long task never ends, so it never emits a longtask entry,
// and the render loop's own rAF tick can never run to notice the gap. The only
// in-renderer observer is a Web Worker (a separate thread) that pings the main
// thread and measures the round-trip; if the main thread stops answering, the
// freeze is happening and the worker can still log it (worker console is visible
// in DevTools) with a timestamp to correlate against a repro.
//
// This is deliberately a BLUNT instrument: it proves "main thread froze at ~T"
// (and surfaces the last-responsive stage label set via setFreezeStage()), but it
// cannot read the frozen stack. It complements — not replaces — the defensive
// angle-normalisation fix (engine/math/angle.js) that removes the prime suspect.
//
// setFreezeStage(label) is a pure no-op-safe write to window (safe to import in
// any module, including under node/test where `window` is absent). The worker is
// spawned lazily by installFreezeWatchdog() and only ever in a browser.

export function setFreezeStage(label) {
  if (typeof window !== 'undefined') window.__toriiFreezeStage = label;
}

// Spawn a blob worker that pings the main thread on an interval and warns when
// the round-trip exceeds stallMs. Returns the worker (or null when unsupported).
export function installFreezeWatchdog({ pingMs = 1000, stallMs = 2500 } = {}) {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (typeof window.__toriiFreezeWatchdog !== 'undefined') return null; // idempotent

  // Worker-side: ping → measure last-pong age → warn on stall. Runs on its own
  // thread, so it keeps ticking even while the main thread is wedged.
  const workerCode = `
    var pingMs = ${JSON.stringify(pingMs)};
    var stallMs = ${JSON.stringify(stallMs)};
    var lastPongAt = Date.now();
    var lastStage = 'unknown';
    var stalls = 0;
    self.onmessage = function (e) {
      var d = e.data;
      if (d && d.type === 'pong') { lastPongAt = Date.now(); lastStage = d.stage; }
    };
    function tick() {
      self.postMessage({ type: 'ping' });
      setTimeout(function () {
        var gap = Date.now() - lastPongAt;
        if (gap > stallMs) {
          stalls++;
          console.warn('[freeze-watchdog] main thread unresponsive: ' + gap + 'ms since last pong (last responsive stage: ' + lastStage + ', stall #' + stalls + ')');
        }
        tick();
      }, pingMs);
    }
    tick();
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  worker.onmessage = (e) => {
    if (e.data && e.data.type === 'ping') {
      worker.postMessage({
        type: 'pong',
        stage: (typeof window !== 'undefined' ? window.__toriiFreezeStage : null) || 'unknown',
      });
    }
  };
  window.__toriiFreezeWatchdog = true;
  return worker;
}