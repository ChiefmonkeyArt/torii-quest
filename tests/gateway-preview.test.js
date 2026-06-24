// tests/gateway-preview.test.js — gateway/NAP-to-NAP PREVIEW block
// (gatewayPreview.js, LEAN-2, v0.2.139). Asserts the block is render-ready,
// armed only on a valid plan, carries an explicit inert badge + actionable:false,
// and never exposes a clickable/navigating action.
import { describe, it, expect } from 'vitest';
import {
  gatewayPreviewBlock, statusText, previewUrl,
  GATEWAY_PREVIEW_BADGE, GATEWAY_STATUS_TEXT,
} from '../src/engine/gateway/gatewayPreview.js';
import { createToriiGateway } from '../src/engine/components/toriiGateway.js';
import * as SDK from '../src/sdk/index.js';

describe('gatewayPreview — statusText', () => {
  it('maps known statuses to display labels', () => {
    expect(statusText('ready')).toBe('READY');
    expect(statusText('invalid')).toBe('INVALID');
    expect(statusText('not-a-gateway')).toBe('NO GATEWAY');
  });
  it('falls back to an upper-cased raw value', () => {
    expect(statusText('weird')).toBe('WEIRD');
    expect(statusText(null)).toBe('UNKNOWN');
  });
});

describe('gatewayPreview — previewUrl', () => {
  it('returns short urls unchanged', () => {
    expect(previewUrl('?to=world-2')).toBe('?to=world-2');
  });
  it('caps long urls with an ellipsis', () => {
    const long = `?to=${'x'.repeat(80)}`;
    const out = previewUrl(long, 20);
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });
  it('is safe on null/non-strings', () => {
    expect(previewUrl(null)).toBe('');
    expect(previewUrl(123)).toBe('123');
  });
});

describe('gatewayPreview — gatewayPreviewBlock', () => {
  it('is armed + ready for a valid gateway, with intent + capped URL preview', () => {
    const gate = createToriiGateway({ target: 'world-2', relay: 'wss://relay.example.com' });
    const block = gatewayPreviewBlock(gate, { from: 'torii-quest' });
    expect(block.title).toBe('GATEWAY PREVIEW');
    expect(block.status).toBe('ready');
    expect(block.statusLabel).toBe('READY');
    expect(block.armed).toBe(true);
    expect(block.destination).toBe('world-2');
    expect(block.intent).toEqual({ from: 'torii-quest', to: 'world-2' });
    expect(block.urlPreview).not.toBe('');
    expect(block.urlPreview.length).toBeLessThanOrEqual(48);
    expect(block.badge).toBe(GATEWAY_PREVIEW_BADGE);
  });

  it('exposes render-ready label/value rows for every field', () => {
    const gate = createToriiGateway({ target: 'world-2', relay: 'wss://relay.example.com' });
    const block = gatewayPreviewBlock(gate, { from: 'torii-quest' });
    const labels = block.lines.map((l) => l.label);
    expect(labels).toEqual(['Destination', 'Status', 'Relay', 'Intent', 'URL']);
    const intentRow = block.lines.find((l) => l.label === 'Intent');
    expect(intentRow.value).toBe('torii-quest → world-2');
  });

  it('is inert: actionable false and no clickable/action keys', () => {
    const gate = createToriiGateway({ target: 'world-2' });
    const block = gatewayPreviewBlock(gate, { from: 'torii-quest' });
    expect(block.actionable).toBe(false);
    expect(block.badge).toContain('INERT');
    for (const k of ['action', 'actions', 'href', 'onClick', 'navigate', 'url']) {
      expect(block[k]).toBeUndefined();
    }
  });

  it('is not armed on an invalid plan — no intent, no URL, no prompt', () => {
    const gate = createToriiGateway({ target: 'world-2' });
    const block = gatewayPreviewBlock(gate, { player: 'not-an-npub' });
    expect(block.status).toBe('invalid');
    expect(block.statusLabel).toBe('INVALID');
    expect(block.armed).toBe(false);
    expect(block.intent).toBeNull();
    expect(block.urlPreview).toBe('');
    expect(block.prompt).toBe('');
    expect(block.lines.find((l) => l.label === 'URL').value).toBe('—');
  });

  it('reports NO GATEWAY for a non-gateway component', () => {
    const block = gatewayPreviewBlock({ manifest: { kind: 'product' } }, {});
    expect(block.status).toBe('not-a-gateway');
    expect(block.statusLabel).toBe('NO GATEWAY');
    expect(block.armed).toBe(false);
    expect(block.actionable).toBe(false);
  });
});

describe('gatewayPreview — SDK exposure', () => {
  it('is re-exported at the experimental tier', () => {
    expect(typeof SDK.gatewayPreview.gatewayPreviewBlock).toBe('function');
    expect(SDK.SDK_SURFACE.gatewayPreview.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});

describe('gatewayPreview — status text table', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(GATEWAY_STATUS_TEXT)).toBe(true);
  });
});
