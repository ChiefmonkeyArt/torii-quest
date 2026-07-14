// perfHud.js — v0.2.379-alpha debug performance HUD.
//
// A tiny absolutely-positioned DOM overlay (top-left, monospace, semi-transparent
// dark bg, pointer-events:none) showing live render metrics. Debug-only: it does
// nothing — and creates no DOM — unless the flag is set:
//
//   window.__toriiPerf === true   (or)   window.ToriiDebug.perf === true
//
// Zero cost when the flag is off: update() bails before touching the DOM. When on,
// it throttles to ~250 ms so the readout itself doesn't skew the numbers.
//
// Metrics come from getMetrics() (the quality-tier snapshot) and getCounts() (bot
// + peer counts owned by the arena runtime). Kept separate from qualityTier.js so
// that module stays DOM-free and node-testable.

export function createPerfHud({
  window: win = (typeof window !== 'undefined' ? window : undefined),
  getMetrics,
  getCounts,
  throttleMs = 250,
} = {}) {
  let el = null;
  let lastDraw = -Infinity; // ensures the first enabled update draws immediately

  function _enabled() {
    if (!win) return false;
    if (win.__toriiPerf === true) return true;
    return !!(win.ToriiDebug && win.ToriiDebug.perf);
  }

  function _ensureEl() {
    if (el || !win || !win.document) return el;
    const doc = win.document;
    el = doc.createElement('div');
    el.id = 'torii-perf-hud';
    const s = el.style;
    s.position = 'fixed';
    s.top = '8px';
    s.left = '8px';
    s.zIndex = '99999';
    s.pointerEvents = 'none';
    s.font = '11px/1.4 monospace';
    s.color = '#9effa0';
    s.background = 'rgba(0,0,0,0.55)';
    s.padding = '6px 8px';
    s.borderRadius = '4px';
    s.whiteSpace = 'pre';
    s.textShadow = '0 1px 1px rgba(0,0,0,0.8)';
    (doc.body || doc.documentElement).appendChild(el);
    return el;
  }

  function destroy() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  function update(nowMs) {
    if (!_enabled()) {
      // Flag turned off after being on — tear the overlay down so it leaves no
      // trace and costs nothing per frame.
      if (el) destroy();
      return;
    }
    const now = typeof nowMs === 'number' ? nowMs
      : (win && win.performance ? win.performance.now() : Date.now());
    if (now - lastDraw < throttleMs) return;
    lastDraw = now;

    const m = (getMetrics && getMetrics()) || {};
    const c = (getCounts && getCounts()) || {};
    const node = _ensureEl();
    if (!node) return;

    const fps = Math.round(m.fps || 0);
    const frameMs = (m.frameMs || 0).toFixed(1);
    const draws = m.drawCalls || 0;
    const tris = m.triangles || 0;
    const dpr = (m.dpr != null ? m.dpr : 0);
    const tier = m.tier || '?';
    const bots = c.bots || 0;
    const peers = c.peers || 0;

    node.textContent =
      `FPS ${fps}  (${frameMs} ms)\n` +
      `draws ${draws}  tris ${tris.toLocaleString()}\n` +
      `DPR ${dpr}  tier ${tier}\n` +
      `bots ${bots}  peers ${peers}`;
  }

  return { update, destroy, _enabled };
}
