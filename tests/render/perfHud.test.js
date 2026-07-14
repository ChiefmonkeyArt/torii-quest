// tests/render/perfHud.test.js — locks down the v0.2.379-alpha debug perf HUD
// (src/engine/render/perfHud.js). The suite runs in node (no jsdom), so a minimal
// fake window/document is injected. Covers: zero DOM when the flag is off, lazy
// creation when on, the ~250ms throttle, count/metric rendering, teardown when the
// flag flips off, and both flag styles (__toriiPerf and ToriiDebug.perf).
import { describe, it, expect } from 'vitest';
import { createPerfHud } from '../../src/engine/render/perfHud.js';

function makeEl() {
  return {
    id: '', style: {}, textContent: '',
    parentNode: null,
    appendChild(child) { child.parentNode = this; },
    removeChild(child) { child.parentNode = null; },
  };
}

function makeWindow(flags = {}) {
  const created = [];
  const body = makeEl();
  const doc = {
    body,
    documentElement: body,
    createElement() { const el = makeEl(); created.push(el); return el; },
  };
  return {
    document: doc,
    performance: { now: () => 0 },
    __created: created,
    __body: body,
    ...flags,
  };
}

const metrics = () => ({ fps: 60, frameMs: 16.7, drawCalls: 30, triangles: 5000, dpr: 1.5, tier: 'HIGH' });
const counts = () => ({ bots: 5, peers: 2 });

describe('createPerfHud', () => {
  it('creates no DOM and does nothing when the flag is off', () => {
    const win = makeWindow();
    const hud = createPerfHud({ window: win, getMetrics: metrics, getCounts: counts });
    hud.update(0);
    hud.update(1000);
    expect(win.__created).toHaveLength(0);
    expect(win.__body.parentNode).toBe(null);
  });

  it('lazily creates one overlay element when __toriiPerf is true', () => {
    const win = makeWindow({ __toriiPerf: true });
    const hud = createPerfHud({ window: win, getMetrics: metrics, getCounts: counts });
    hud.update(0);
    expect(win.__created).toHaveLength(1);
    const el = win.__created[0];
    expect(el.id).toBe('torii-perf-hud');
    expect(el.parentNode).toBe(win.__body);
    expect(el.style.pointerEvents).toBe('none');
    expect(el.style.position).toBe('fixed');
  });

  it('renders FPS, draws/tris, DPR/tier, and bot/peer counts', () => {
    const win = makeWindow({ __toriiPerf: true });
    const hud = createPerfHud({ window: win, getMetrics: metrics, getCounts: counts });
    hud.update(0);
    const txt = win.__created[0].textContent;
    expect(txt).toContain('FPS 60');
    expect(txt).toContain('draws 30');
    expect(txt).toContain('tier HIGH');
    expect(txt).toContain('DPR 1.5');
    expect(txt).toContain('bots 5');
    expect(txt).toContain('peers 2');
  });

  it('throttles updates to ~250ms', () => {
    const win = makeWindow({ __toriiPerf: true });
    let n = 0;
    const hud = createPerfHud({
      window: win,
      getMetrics: () => { n++; return metrics(); },
      getCounts: counts,
    });
    hud.update(0);    // draws
    hud.update(100);  // within throttle — skipped
    hud.update(200);  // still within throttle — skipped
    expect(n).toBe(1);
    hud.update(300);  // > 250ms since last draw — draws
    expect(n).toBe(2);
  });

  it('tears the overlay down when the flag flips off', () => {
    const win = makeWindow({ __toriiPerf: true });
    const hud = createPerfHud({ window: win, getMetrics: metrics, getCounts: counts });
    hud.update(0);
    const el = win.__created[0];
    expect(el.parentNode).toBe(win.__body);
    win.__toriiPerf = false;
    hud.update(300);
    expect(el.parentNode).toBe(null);
  });

  it('also activates via ToriiDebug.perf', () => {
    const win = makeWindow({ ToriiDebug: { perf: true } });
    const hud = createPerfHud({ window: win, getMetrics: metrics, getCounts: counts });
    expect(hud._enabled()).toBe(true);
    hud.update(0);
    expect(win.__created).toHaveLength(1);
  });
});
