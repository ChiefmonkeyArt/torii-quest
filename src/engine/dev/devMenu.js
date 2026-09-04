// engine/dev/devMenu.js — DOM driver for the Kami-mode dev menu (ADR-0099).
//
// Renders whatever `devMenuModel.renderModel()` returns into `#torii-dev-menu`
// (left edge, smoked-glass style, hidden by default). Owner-and-Kami visibility
// is decided by the model — this driver never inspects Kami state directly, so
// there's exactly one source of truth for "should the menu show right now".
//
// Update cadence: every frame (driven by the caller's animation-frame
// scheduler via pumpDevMenu()). Cheap: renderModel() is O(entries) — a handful
// of boolean reads. We rebuild the DOM only when the shape changes (visibility
// flip, or a toggle state change) via the snapshot-key change detector, so
// mid-play frames don't churn DOM. Same-frame visibility syncs keep the panel
// appearing/disappearing in lock-step with Kami Mode (no 1Hz lag).

import { createDevMenuModel } from './devMenuModel.js';

let _model = null;
let _root = null;
let _lastKey = '';        // last-rendered snapshot key — cheap change detector

// installDevMenu({ isVisible, doc? }) — one-time boot. Returns the model
// handle so callers can register entries and (in tests) pump synchronously.
export function installDevMenu({ isVisible, doc } = {}) {
  if (_model) return _model; // idempotent
  const D = doc || (typeof document !== 'undefined' ? document : null);
  _model = createDevMenuModel({ isVisible });
  _root = D ? D.getElementById('torii-dev-menu') : null;
  // Also expose to window for the diagnostic surface used by the Kami tests
  // ("kami dev menu present when kami-active + owner"). Never write there in
  // headless tests where window is undefined.
  if (typeof window !== 'undefined') {
    window.__toriiDevMenu = {
      register: (e) => _model.register(e),
      pump: () => pumpDevMenu(0, D),
      state: () => _model.renderModel(),
    };
  }
  return _model;
}

// registerDevToggle(entry) — thin re-export so callers don't have to hold the
// model handle. See devMenuModel.js for entry shape.
export function registerDevToggle(entry) {
  if (!_model) throw new Error('devMenu: installDevMenu() first');
  return _model.register(entry);
}

// pumpDevMenu(nowMs, doc?) — call once per frame. `nowMs` is accepted for
// backward compatibility with callers/tests but no longer used (the old 1Hz
// throttle is gone — the snapshot-key detector already skips unchanged DOM
// work, and same-frame visibility syncs beat the previous up-to-1s lag).
export function pumpDevMenu(nowMs, doc) {
  if (!_model) return;

  const D = doc || (typeof document !== 'undefined' ? document : null);
  const root = _root || (D ? D.getElementById('torii-dev-menu') : null);
  if (!root) return;
  _root = root;

  const snap = _model.renderModel();
  const key = snapKey(snap);
  if (key === _lastKey) return; // nothing changed → skip DOM work
  _lastKey = key;

  if (!snap.visible) {
    root.hidden = true;
    root.innerHTML = ''; // wipe stale rows so a re-open starts clean
    return;
  }
  root.hidden = false;
  root.innerHTML = renderHTML(snap);
  wireRows(root, snap);
}

// __resetDevMenuForTests() — tests only. Never called at runtime.
export function __resetDevMenuForTests() {
  _model = null;
  _root = null;
  _lastKey = '';
  if (typeof window !== 'undefined') { try { delete window.__toriiDevMenu; } catch { /* noop */ } }
}

function snapKey(snap) {
  if (!snap.visible) return 'hidden';
  return snap.entries.map((e) => `${e.id}:${e.on ? 1 : 0}`).join('|');
}

function renderHTML(snap) {
  const rows = snap.entries.map((e) => {
    const cls = e.on ? 'dev-toggle on' : 'dev-toggle';
    const state = e.on ? 'ON' : 'OFF';
    const hint = e.hint ? `<div class="dev-toggle-hint">${escapeHTML(e.hint)}</div>` : '';
    return (
      `<button type="button" class="${cls}" data-dev-toggle-id="${escapeHTML(e.id)}" aria-pressed="${e.on}">`
      + `<span class="dev-toggle-label">${escapeHTML(e.label)}</span>`
      + `<span class="dev-toggle-state">${state}</span>`
      + hint
      + `</button>`
    );
  }).join('');
  return (
    `<div class="dev-menu-header">DEV — KAMI</div>`
    + `<div class="dev-menu-body">${rows}</div>`
  );
}

function wireRows(root, snap) {
  const buttons = root.querySelectorAll('[data-dev-toggle-id]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-dev-toggle-id');
      const entry = snap.entries.find((e) => e.id === id);
      if (!entry) return;
      const result = _model.applyToggle(id, !entry.on);
      // The model is authoritative — if the gate refused, we don't repaint.
      // The next 1Hz pump will re-sync; test-mode callers can pump manually.
      if (result.ok) {
        _lastKey = ''; // force next pump to redraw with the new value
        pumpDevMenu(0);
      }
    });
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
