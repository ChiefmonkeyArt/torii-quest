// tests/update-flow-smoke.test.js — pure UPDATE-FLOW SMOKE harness
// (src/engine/update/updateFlowSmoke.js, v0.2.196). Covers the folded
// runUpdateFlowSmoke() report (all 10 signals + summary), the read-only /
// no-auto-update safety invariants (performed/actionable/autoUpdate/installed/
// executed/fetched/network/signed/published/navigated pinned false), the
// malformed-payload degrade-to-unknown set, the metadata safety floor, the
// confirmation gate, the absence of any exec/install/fetch callable on the
// outputs, and the text formatter on degraded input — plus deliberately-broken
// injected fixtures to prove the harness catches a failing flow without throwing.
// No fs/network/relay/DOM — every input is plain data, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  UPDATE_SMOKE_VERSION, UPDATE_SMOKE_BADGE, UPDATE_ACTION,
  SAMPLE_NEWER_FEED, SAMPLE_CURRENT_RELEASE, MALFORMED_PAYLOADS,
  runUpdateFlowSmoke, formatUpdateFlowSmoke,
} from '../src/engine/update/updateFlowSmoke.js';

describe('constants', () => {
  it('exports a version, a read-only/no-auto-update badge, and the apply action id', () => {
    expect(UPDATE_SMOKE_VERSION).toBe(1);
    expect(UPDATE_SMOKE_BADGE).toMatch(/READ-ONLY/);
    expect(UPDATE_SMOKE_BADGE).toMatch(/NO AUTO-UPDATE/);
    expect(UPDATE_ACTION).toBe('update:apply');
  });
  it('exposes frozen, deterministic local fixtures (never the wire)', () => {
    expect(Array.isArray(SAMPLE_NEWER_FEED)).toBe(true);
    expect(SAMPLE_NEWER_FEED.length).toBe(2);
    expect(Object.isFrozen(SAMPLE_NEWER_FEED)).toBe(true);
    expect(Object.isFrozen(SAMPLE_CURRENT_RELEASE)).toBe(true);
    expect(SAMPLE_CURRENT_RELEASE.tag_name).toMatch(/^v\d+\.\d+\.\d+/);
    expect(Array.isArray(MALFORMED_PAYLOADS)).toBe(true);
    expect(Object.isFrozen(MALFORMED_PAYLOADS)).toBe(true);
    expect(MALFORMED_PAYLOADS.length).toBeGreaterThan(0);
  });
});

describe('runUpdateFlowSmoke', () => {
  it('is all-green over the local fixtures (10 signals, no fail)', () => {
    const r = runUpdateFlowSmoke();
    expect(r.ok).toBe(true);
    expect(r.badge).toBe(UPDATE_SMOKE_BADGE);
    expect(r.version).toBe(UPDATE_SMOKE_VERSION);
    expect(r.summary.total).toBe(10);
    expect(r.summary.ok).toBe(10);
    expect(r.summary.fail).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it('emits exactly the expected signal keys, all ok', () => {
    const r = runUpdateFlowSmoke();
    const keys = r.signals.map((s) => s.key).sort();
    expect(keys).toEqual([
      'confirmation-gated',
      'current-version-read',
      'manual-only-no-auto-update',
      'metadata-safety-floor',
      'no-auto-action',
      'no-exec-install-surface',
      'release-metadata-shape',
      'unknown-degrades-safely',
      'up-to-date-classified',
      'update-available-classified',
    ]);
    expect(r.signals.every((s) => s.status === 'ok')).toBe(true);
  });

  it('pins every safety flag false on the folded report', () => {
    const r = runUpdateFlowSmoke();
    expect(r.safety).toEqual({
      performed: false, actionable: false, autoUpdate: false, installed: false,
      executed: false, fetched: false, network: false, signed: false,
      published: false, navigated: false,
    });
    expect(r.rendered).toBe(false);
    expect(r.actionable).toBe(false);
  });

  it('classifies a strictly-newer release as update-available', () => {
    const r = runUpdateFlowSmoke();
    const sig = r.signals.find((s) => s.key === 'update-available-classified');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/available=true/);
  });

  it('classifies a same-version release as up-to-date', () => {
    const r = runUpdateFlowSmoke();
    const sig = r.signals.find((s) => s.key === 'up-to-date-classified');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/available=false/);
  });

  it('degrades every malformed payload to unknown (no throw)', () => {
    const r = runUpdateFlowSmoke();
    const sig = r.signals.find((s) => s.key === 'unknown-degrades-safely');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/degraded to unknown/);
  });

  it('keeps the status panel/view manual-only and display-only', () => {
    const r = runUpdateFlowSmoke();
    const sig = r.signals.find((s) => s.key === 'manual-only-no-auto-update');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/actionable=false/);
  });

  it('enforces the metadata no-auto-update safety floor (rejects tampered autoUpdate)', () => {
    const r = runUpdateFlowSmoke();
    const sig = r.signals.find((s) => s.key === 'metadata-safety-floor');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/tampered rejected=true/);
  });

  it('exposes no fetch/install/exec/apply callable on any output', () => {
    const r = runUpdateFlowSmoke();
    const sig = r.signals.find((s) => s.key === 'no-exec-install-surface');
    expect(sig.status).toBe('ok');
  });

  it('blocks apply-update without a grant and allows-but-never-performs with one', () => {
    const r = runUpdateFlowSmoke();
    const sig = r.signals.find((s) => s.key === 'confirmation-gated');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/grant\.performed=false/);
  });

  it('surfaces ok:false (with reasons) when an injected fixture breaks the flow', () => {
    // A "newer feed" that is actually empty makes update-available-classified
    // and release-metadata-shape fail; the harness must catch it, not throw.
    const r = runUpdateFlowSmoke({ newerFeed: [] });
    expect(r.ok).toBe(false);
    expect(r.summary.fail).toBeGreaterThan(0);
    expect(r.reasons.length).toBeGreaterThan(0);
    // Even a broken flow keeps the no-auto-update safety posture pinned false.
    expect(r.safety.performed).toBe(false);
    expect(r.safety.autoUpdate).toBe(false);
    expect(r.safety.installed).toBe(false);
    expect(r.safety.network).toBe(false);
  });

  it('catches a malformed fixture that should NOT degrade to unknown', () => {
    // Feeding a genuinely-newer release as a "malformed" payload should be
    // misclassified (it resolves to update-available, not unknown) → fail.
    const r = runUpdateFlowSmoke({ malformed: [SAMPLE_NEWER_FEED] });
    const sig = r.signals.find((s) => s.key === 'unknown-degrades-safely');
    expect(sig.status).toBe('fail');
    expect(r.ok).toBe(false);
  });

  it('is safe on no-arg / degraded opts (never throws)', () => {
    expect(() => runUpdateFlowSmoke(null)).not.toThrow();
    expect(() => runUpdateFlowSmoke([])).not.toThrow();
    expect(() => runUpdateFlowSmoke('nope')).not.toThrow();
    expect(runUpdateFlowSmoke(null).summary.total).toBe(10);
    expect(runUpdateFlowSmoke(null).ok).toBe(true);
  });
});

describe('formatUpdateFlowSmoke', () => {
  it('renders a block with the badge and a verdict line', () => {
    const out = formatUpdateFlowSmoke(runUpdateFlowSmoke());
    expect(out).toMatch(/UPDATE FLOW SMOKE/);
    expect(out).toMatch(/verdict: OK/);
    expect(out).toMatch(/10\/10 signals/);
  });
  it('is safe on null (falls back to running the smoke)', () => {
    expect(() => formatUpdateFlowSmoke(null)).not.toThrow();
    expect(formatUpdateFlowSmoke(null)).toMatch(/UPDATE FLOW SMOKE/);
  });
});
