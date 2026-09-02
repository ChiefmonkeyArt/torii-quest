// tests/dashboard-live-diagnostics.test.js — ADR-0056. The static oversight
// dashboard gains a "Live diagnostics" section + a LIVE_DIAGNOSTICS constant.
// Pins: the constant is frozen/well-shaped, and the rendered page includes the
// autocap card (label, ring cap, retrieval CLI) — static/read-only, no network.

import { describe, it, expect } from 'vitest';
import { LIVE_DIAGNOSTICS, renderToriiQuestPage } from '../src/engine/dashboard/toriiQuestDashboardData.js';

describe('LIVE_DIAGNOSTICS constant (ADR-0055 autocap)', () => {
  it('is frozen + well-shaped', () => {
    expect(Object.isFrozen(LIVE_DIAGNOSTICS)).toBe(true);
    const a = LIVE_DIAGNOSTICS.autocap;
    expect(a.adr).toBe('ADR-0055');
    expect(a.ringCap).toBe(120);
    expect(typeof a.ringPath).toBe('string');
    expect(a.retrieval).toContain('kami-autocap-dump');
    expect(a.indicator).toContain('RECORDING');
  });
});

describe('renderToriiQuestPage — Live diagnostics section', () => {
  it('includes the autocap card with label, ring cap, and retrieval CLI', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('Live diagnostics');
    expect(html).toContain('EMA auto-capture (1Hz ring)');
    expect(html).toContain('ADR-0055');
    expect(html).toContain('120 frames');
    expect(html).toContain('kami-autocap-dump.mjs');
    expect(html).toContain('RECORDING');
  });

  it('does NOT add a live network call — the dashboard stays static', () => {
    const html = renderToriiQuestPage();
    // The section documents the ring path + retrieval CLI as text only;
    // it must not embed a live fetch / XHR / websocket in the page.
    expect(html).not.toMatch(/fetch\(['"`]\/mp\/kami\/autocap/);
    expect(html).not.toMatch(/new WebSocket\(/);
  });
});
