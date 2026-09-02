// tests/render/rec-indicator.test.js — ADR-0056. RECORDING HUD indicator tests.
//
// A fake document/window exercises the indicator without a real browser:
//   - inactive (not owner / not playing / capability unresolved) → no DOM ever
//   - active → creates #torii-rec-hud, shows "RECORDING" + ring count
//   - error state (lastError, no recent upload) → "REC ERROR" + red
//   - throttling: update() is a no-op inside the throttle window
//   - destroy tears the DOM down

import { describe, it, expect, beforeEach } from 'vitest';
import { createRecIndicator } from '../../src/engine/render/recIndicator.js';

function fakeDoc() {
  const registry = []; // every created element, so getElementById can find them
  const head = { appendChild(c) { c.parentNode = head; return c; }, removeChild(c) { c.parentNode = null; return c; }, children: [] };
  const body = { appendChild(c) { c.parentNode = body; return c; }, removeChild(c) { c.parentNode = null; return c; }, children: [] };
  const doc = {
    getElementById(id) { return registry.find(e => e.id === id && e.parentNode !== null) || null; },
    createElement(tag) {
      const el = { id: null, style: {}, textContent: '', class: '', _tag: tag, _children: [], parentNode: null };
      el.appendChild = (c) => { c.parentNode = el; el._children.push(c); return c; };
      el.removeChild = (c) => { c.parentNode = null; return c; };
      registry.push(el);
      return el;
    },
    head, body,
  };
  const win = { document: doc, performance: { now: () => 0 } };
  return { win, doc, body, registry };
}

describe('recIndicator — inactive creates no DOM', () => {
  it('never touches the DOM when isActive() is false', () => {
    const { win, doc } = fakeDoc();
    const ri = createRecIndicator({ window: win, getReport: () => ({}), isActive: () => false });
    ri.update(1000);
    ri.update(2000);
    ri.update(3000);
    expect(doc.getElementById('torii-rec-hud')).toBeNull();
  });

  it('tears down the DOM if it was active then goes inactive', () => {
    const { win, doc } = fakeDoc();
    let active = true;
    const ri = createRecIndicator({ window: win, getReport: () => ({ captured: 3, ringCap: 120, lastUploadOkAt: 1000 }), isActive: () => active });
    ri.update(5000);
    expect(doc.getElementById('torii-rec-hud')).not.toBeNull();
    active = false;
    ri.update(6000);
    expect(doc.getElementById('torii-rec-hud')).toBeNull();
  });
});

describe('recIndicator — active shows RECORDING', () => {
  it('creates #torii-rec-hud and shows "RECORDING" with ring count', () => {
    const { win, doc } = fakeDoc();
    const ri = createRecIndicator({
      window: win, throttleMs: 0,
      getReport: () => ({ captured: 12, uploaded: 12, ringCap: 120, inflight: false, lastUploadOkAt: 4000, lastError: null }),
      isActive: () => true,
    });
    ri.update(5000);
    const el = doc.getElementById('torii-rec-hud');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('RECORDING');
    expect(el.textContent).toContain('12/120');
  });

  it('shows the inflight marker when a seal+POST is in flight', () => {
    const { win, doc } = fakeDoc();
    const ri = createRecIndicator({
      window: win, throttleMs: 0,
      getReport: () => ({ captured: 5, uploaded: 5, ringCap: 120, inflight: true, lastUploadOkAt: 4000, lastError: null }),
      isActive: () => true,
    });
    ri.update(5000);
    expect(doc.getElementById('torii-rec-hud').textContent).toContain('↑');
  });
});

describe('recIndicator — error state', () => {
  it('shows "REC ERROR" + red when lastError set + no recent upload', () => {
    const { win, doc } = fakeDoc();
    const ri = createRecIndicator({
      window: win, throttleMs: 0,
      getReport: () => ({ captured: 4, uploaded: 4, ringCap: 120, inflight: false, lastUploadOkAt: null, lastError: 'HTTP 403' }),
      isActive: () => true,
    });
    ri.update(5000);
    const el = doc.getElementById('torii-rec-hud');
    expect(el.textContent).toContain('REC ERROR');
    expect(el.style.color).toMatch(/#ff5a4d/i); // red
    expect(el.textContent).toContain('HTTP 403');
  });

  it('shows REC ERROR whenever lastError is set (markUploaded clears it, so any lastError is a current failure)', () => {
    const { win, doc } = fakeDoc();
    const ri = createRecIndicator({
      window: win, throttleMs: 0,
      getReport: () => ({ captured: 10, uploaded: 9, ringCap: 120, inflight: false, lastUploadOkAt: 4900, lastError: 'HTTP 500' }),
      isActive: () => true,
    });
    ri.update(5000);
    // lastError is set → honest REC ERROR, no 60s grace window.
    expect(doc.getElementById('torii-rec-hud').textContent).toContain('REC ERROR');
  });

  it('shows RECORDING (no error) once lastError is cleared by a successful upload', () => {
    const { win, doc } = fakeDoc();
    const ri = createRecIndicator({
      window: win, throttleMs: 0,
      getReport: () => ({ captured: 10, uploaded: 10, ringCap: 120, inflight: false, lastUploadOkAt: 4900, lastError: null }),
      isActive: () => true,
    });
    ri.update(5000);
    expect(doc.getElementById('torii-rec-hud').textContent).toContain('RECORDING');
    expect(doc.getElementById('torii-rec-hud').textContent).not.toContain('REC ERROR');
  });
});

describe('recIndicator — throttling', () => {
  it('update() is a no-op inside the throttle window', () => {
    const { win, doc } = fakeDoc();
    let captured = 1;
    const ri = createRecIndicator({
      window: win, throttleMs: 250,
      getReport: () => ({ captured, uploaded: captured, ringCap: 120, inflight: false, lastUploadOkAt: 1000, lastError: null }),
      isActive: () => true,
    });
    ri.update(5000);
    const first = doc.getElementById('torii-rec-hud').textContent;
    captured = 50; // should NOT show up yet — inside the throttle window
    ri.update(5100);
    expect(doc.getElementById('torii-rec-hud').textContent).toBe(first);
    // Past the window — now it refreshes.
    ri.update(5300);
    expect(doc.getElementById('torii-rec-hud').textContent).toContain('50/120');
  });
});

describe('recIndicator — destroy', () => {
  it('destroy removes the element', () => {
    const { win, doc } = fakeDoc();
    const ri = createRecIndicator({
      window: win, throttleMs: 0,
      getReport: () => ({ captured: 1, uploaded: 1, ringCap: 120, lastUploadOkAt: 1000 }),
      isActive: () => true,
    });
    ri.update(5000);
    expect(doc.getElementById('torii-rec-hud')).not.toBeNull();
    ri.destroy();
    expect(doc.getElementById('torii-rec-hud')).toBeNull();
  });
});
