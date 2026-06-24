// tests/shell-report.test.js — read-only DEBUG reports over the v0.2.136 VIEW
// shells (shellReport.js, v0.2.137). Asserts each report reads its shell's pure
// output, is deterministic, and exposes NO commerce/signer/publish/navigation.
import { describe, it, expect } from 'vitest';
import {
  gatewayReport, productReport, leaderboardReport, buildShellReport,
  DEMO_GATEWAY, DEMO_PRODUCT, DEMO_SCORES,
} from '../src/engine/debug/shellReport.js';

describe('shellReport — gatewayReport', () => {
  it('reports an armed, ready portal for the demo gateway (display only)', () => {
    const r = gatewayReport();
    expect(r.status).toBe('ready');
    expect(r.isGateway).toBe(true);
    expect(r.armed).toBe(true);
    expect(r.destinationLabel).toBe('plebeian-market-bazaar');
    expect(r.relay).toBe('wss://relay.example.com');
    expect(r.urlPreview).not.toBe('');
    // No live-action fields leak into the report.
    expect(r).not.toHaveProperty('navigate');
    expect(r).not.toHaveProperty('sign');
  });

  it('reports not-a-gateway for a non-gateway component', () => {
    const r = gatewayReport({ manifest: { kind: 'product' } });
    expect(r.status).toBe('not-a-gateway');
    expect(r.isGateway).toBe(false);
    expect(r.armed).toBe(false);
  });
});

describe('shellReport — productReport', () => {
  it('reports a read-only panel with no commerce surface', () => {
    const r = productReport();
    expect(r.ok).toBe(true);
    expect(r.title).toBe('Sticker Gun Skin');
    expect(r.lineCount).toBe(r.lines.length);
    expect(r.readOnly).toBe(true);
    expect(r.actionable).toBe(false);
    expect(r.actionCount).toBe(0);
  });

  it('reports ok:false for an invalid product', () => {
    const r = productReport({ title: '', sellerNpub: 'nope', url: 'ftp://x' });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.actionCount).toBe(0);
  });
});

describe('shellReport — leaderboardReport', () => {
  it('ranks scores deterministically and never signs or publishes', () => {
    const r = leaderboardReport();
    expect(r.count).toBe(3);
    expect(r.skipped).toBe(0);
    // Highest score first (run-b 240, run-a 120, run-c 90).
    expect(r.rows.map((x) => x.runId)).toEqual(['run-b', 'run-a', 'run-c']);
    expect(r.rows[0].rank).toBe(1);
    expect(r.signed).toBe(false);
    expect(r.published).toBe(false);
  });
});

describe('shellReport — buildShellReport', () => {
  it('composes all three reports with safe demo defaults', () => {
    const r = buildShellReport();
    expect(r.gateway.armed).toBe(true);
    expect(r.product.ok).toBe(true);
    expect(r.leaderboard.count).toBe(3);
    expect(r.leaderboard.signed).toBe(false);
    expect(r.leaderboard.published).toBe(false);
  });

  it('accepts overrides for each section', () => {
    const r = buildShellReport({
      gateway: { manifest: { kind: 'product' } },
      scores: [],
    });
    expect(r.gateway.status).toBe('not-a-gateway');
    expect(r.leaderboard.count).toBe(0);
    expect(r.product.ok).toBe(true); // falls back to DEMO_PRODUCT
  });
});

describe('shellReport — demo fixtures', () => {
  it('exposes frozen, valid demo fixtures', () => {
    expect(DEMO_GATEWAY.manifest.kind).toBe('gateway');
    expect(Object.isFrozen(DEMO_PRODUCT)).toBe(true);
    expect(Object.isFrozen(DEMO_SCORES)).toBe(true);
    expect(DEMO_SCORES.length).toBe(3);
  });
});
