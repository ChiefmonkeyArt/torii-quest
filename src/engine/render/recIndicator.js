// src/engine/render/recIndicator.js — ADR-0056. Live "RECORDING" HUD indicator.
//
// A tiny absolutely-positioned DOM overlay (top-right, monospace, pointer-events:none)
// that glows amber while the ADR-0055 auto-capture diagnostic is actively recording
// the owner's play. It is OWNER-GATED (not debug-gated): the owner sees it while
// they play in the arena so they know the 1Hz ring is live. Non-owners never capture
// and never see it.
//
// Cost: pure CSS animation for the glow (no rAF work for the pulse — rAF only calls a
// throttled update() that changes text/state). Zero cost when not recording — no DOM
// is created until the owner is in the arena, and it's torn down the moment they leave.
//
// States:
//   RECORDING  — active + recent upload (or inflight). Amber glow.
//   REC ERROR  — lastError set + no upload since. Red glow, secondary line shows why.
//
// Respects prefers-reduced-motion: the glow softens to a steady amber.
//
// Pure DOM module — no THREE, no fetch, no game state. Driven entirely by the
// injected getReport()/isActive() callbacks, so it's unit-testable with fakes.

const AMBER = '#ffb300';
const AMBER_DIM = '#8a6200';
const RED = '#ff5a4d';

export function createRecIndicator({
  window: win = (typeof window !== 'undefined' ? window : undefined),
  getReport,
  isActive,
  throttleMs = 250,
} = {}) {
  let el = null;
  let lastDraw = -Infinity;
  let curState = ''; // '' | 'rec' | 'error'

  function _styleId() {
    // Inject the keyframes + base style once per document.
    if (!win || !win.document) return false;
    const doc = win.document;
    if (doc.getElementById('torii-rec-style')) return true;
    const st = doc.createElement('style');
    st.id = 'torii-rec-style';
    st.textContent = `
@keyframes torii-rec-pulse {
  0%, 100% { opacity: 1; text-shadow: 0 0 4px ${AMBER}, 0 0 10px ${AMBER}66; }
  50%      { opacity: 0.55; text-shadow: 0 0 2px ${AMBER}, 0 0 6px ${AMBER}33; }
}
@keyframes torii-rec-pulse-err {
  0%, 100% { opacity: 1; text-shadow: 0 0 4px ${RED}, 0 0 10px ${RED}66; }
  50%      { opacity: 0.6; text-shadow: 0 0 2px ${RED}, 0 0 6px ${RED}33; }
}
#torii-rec-hud { will-change: opacity; }
@media (prefers-reduced-motion: reduce) {
  #torii-rec-hud { animation: none !important; opacity: 1 !important; }
}`;
    (doc.head || doc.documentElement).appendChild(st);
    return true;
  }

  function _ensureEl() {
    if (el || !win || !win.document) return el;
    if (!_styleId()) return null;
    const doc = win.document;
    el = doc.createElement('div');
    el.id = 'torii-rec-hud';
    const s = el.style;
    s.position = 'fixed';
    s.top = '8px';
    s.right = '10px';
    s.zIndex = '99999';
    s.pointerEvents = 'none';
    s.font = '600 13px/1.3 ui-monospace, Menlo, Consolas, monospace';
    s.color = AMBER;
    s.background = 'transparent';
    s.padding = '4px 6px';
    s.borderRadius = '4px';
    s.whiteSpace = 'pre';
    s.letterSpacing = '0.04em';
    (doc.body || doc.documentElement).appendChild(el);
    return el;
  }

  function destroy() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
    curState = '';
  }

  function _ageLabel(ms, nowMs) {
    if (typeof ms !== 'number' || ms == null) return '—';
    const s = Math.max(0, Math.round((nowMs - ms) / 1000));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    return m + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '');
  }

  function update(nowMs) {
    // Not active (not owner, not playing, or capability not resolved) → hide.
    if (!isActive || !isActive()) {
      if (el) destroy();
      return;
    }
    const now = typeof nowMs === 'number' ? nowMs
      : (win && win.performance ? win.performance.now() : Date.now());
    if (now - lastDraw < throttleMs) return;
    lastDraw = now;

    const r = (getReport && getReport()) || {};
    const ringCap = r.ringCap || 0;
    const onRing = Math.min(r.captured || 0, ringCap); // captured count, ring-capped for display
    const hasError = !!(r.lastError);
    const recentOk = (typeof r.lastUploadOkAt === 'number')
      && ((now - r.lastUploadOkAt) < 60000); // an upload succeeded in the last 60s
    const inflight = !!r.inflight;

    // Error state only if the last failure has no success since it.
    const errorSinceOk = hasError
      && !(typeof r.lastUploadOkAt === 'number' && r.lastUploadOkAt >= 0 && r.lastError === null);
    const isError = hasError && !recentOk;

    const node = _ensureEl();
    if (!node) return;

    const state = isError ? 'error' : 'rec';
    if (state !== curState) {
      curState = state;
      node.style.color = isError ? RED : AMBER;
      node.style.animation = (isError ? 'torii-rec-pulse-err' : 'torii-rec-pulse') + ' 1.4s ease-in-out infinite';
    }

    const label = isError ? '● REC ERROR' : '● RECORDING';
    const sub = isError
      ? (String(r.lastError || 'unknown').slice(0, 28))
      : `ring ${onRing}/${ringCap} · last ${_ageLabel(r.lastUploadOkAt, now)}${inflight ? ' · ↑' : ''}`;
    node.textContent = `${label}  ${sub}`;
  }

  return { update, destroy };
}
