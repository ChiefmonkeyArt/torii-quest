// engine/ui/toast.js — pure toast/confirmation layer for user actions.
// Colour-coded (success/error/info) with slide-in animation, auto-dismiss,
// sits above every panel (z-index 300 > settings 200). No import-time DOM.
//
// showToast(message, opts?) — opts: { tone: 'success' | 'error' | 'info',
//   duration: ms (default 2400), doc: Document (for tests) }.
// Returns { el, dismiss } — dismiss() removes the toast early with the
// leave animation.
//
// The layer element (`#torii-toast-layer`) is lazily created on first
// call and reused. Multiple toasts stack vertically. Purely DOM — no
// framework, no state library.

const DEFAULT_DURATION_MS = 2400;
const LEAVE_ANIM_MS = 200;
const VALID_TONES = new Set(['success', 'error', 'info']);

function _getDoc(opts) {
  if (opts && opts.doc) return opts.doc;
  if (typeof document !== 'undefined') return document;
  return null;
}

function _ensureLayer(doc) {
  if (!doc.body) return null;
  let layer = doc.getElementById && doc.getElementById('torii-toast-layer');
  if (layer) return layer;
  layer = doc.createElement('div');
  layer.id = 'torii-toast-layer';
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-live', 'polite');
  doc.body.appendChild(layer);
  return layer;
}

export function showToast(message, opts) {
  const doc = _getDoc(opts);
  if (!doc || typeof doc.createElement !== 'function') {
    return { el: null, dismiss: () => {} };
  }
  const layer = _ensureLayer(doc);
  if (!layer) return { el: null, dismiss: () => {} };

  const tone = (opts && VALID_TONES.has(opts.tone)) ? opts.tone : 'info';
  const duration = (opts && typeof opts.duration === 'number' && opts.duration >= 0)
    ? opts.duration
    : DEFAULT_DURATION_MS;

  const el = doc.createElement('div');
  el.className = 'ts-toast';
  el.dataset.tone = tone;
  el.textContent = String(message == null ? '' : message);
  layer.appendChild(el);

  let removed = false;
  const dismiss = () => {
    if (removed) return;
    removed = true;
    el.classList.add('is-leaving');
    // Use setTimeout so tests without a real animation engine still clean up.
    if (typeof setTimeout === 'function') {
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, LEAVE_ANIM_MS);
    } else if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  };

  if (duration > 0 && typeof setTimeout === 'function') {
    setTimeout(dismiss, duration);
  }

  return { el, dismiss };
}

// Convenience helpers so callsites read naturally.
export const toastSuccess = (msg, opts) => showToast(msg, { ...opts, tone: 'success' });
export const toastError = (msg, opts) => showToast(msg, { ...opts, tone: 'error' });
export const toastInfo = (msg, opts) => showToast(msg, { ...opts, tone: 'info' });
