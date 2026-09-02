// tests/napplets/napplet-srcdoc.test.js — the in-iframe bootstrap HTML that exposes
// window.napplet.world (ADR-0057). Pure string assertions — no DOM mount needed.
import { describe, it, expect } from 'vitest';
import { buildWorldSrcdoc, WORLD_METHODS } from '../../src/engine/napplets/nappletSrcdoc.js';

describe('WORLD_METHODS', () => {
  it('lists the six v0 world surface methods in NAP order', () => {
    expect(WORLD_METHODS).toEqual([
      'attach.get', 'pose.subscribe', 'pose.unsubscribe', 'emit', 'visit', 'zone.list',
    ]);
  });
});

describe('buildWorldSrcdoc', () => {
  const html = buildWorldSrcdoc();

  it('returns a complete HTML document string', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<script>');
    expect(html.trim().endsWith('</html>')).toBe(true);
  });

  it('exposes window.napplet.world and marks ready', () => {
    expect(html).toContain('window.napplet.world = api');
    expect(html).toContain('window.napplet.ready = true');
  });

  it('talks to the parent via postMessage only — never reads parent.document', () => {
    expect(html).toContain('parent.postMessage(');
    expect(html).not.toContain('parent.document');
    expect(html).not.toContain('window.parent.location');
  });

  it('listens for result/error envelopes keyed by request id', () => {
    expect(html).toContain('window.addEventListener("message"');
    expect(html).toContain('.result');
    expect(html).toContain('.error');
    expect(html).toContain('pending[msg.id]');
  });

  it('embeds the method list as JSON so both sides share one source of truth', () => {
    expect(html).toContain(JSON.stringify(WORLD_METHODS));
  });

  it('builds a dot-access surface (attach.get / pose.subscribe / zone.list)', () => {
    expect(html).toContain('api.attach.get =');
    expect(html).toContain('api.pose.subscribe =');
    expect(html).toContain('api.zone.list =');
  });
});

describe('buildWorldSrcdoc — ADR-0058 hardening', () => {
  const html = buildWorldSrcdoc({ channelId: 'test-nonce-123' });

  it('ignores messages not from the parent (parent source check)', () => {
    expect(html).toContain('if (ev.source !== parent) return;');
  });

  it('validates the per-mount nonce on every inbound message', () => {
    expect(html).toContain('msg.channelId !== CHANNEL_ID');
    expect(html).toContain('test-nonce-123');
  });

  it('stamps the nonce on every outbound request', () => {
    expect(html).toContain('channelId: CHANNEL_ID');
  });

  it('exposes world.on / world.off for shell→napplet event subscriptions', () => {
    expect(html).toContain('api.on = function');
    expect(html).toContain('api.off = function');
    expect(html).toContain("handlers[type]");
  });

  it('ships a CSP that blocks network + images (connect-src none, img-src none)', () => {
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('connect-src \'none\'');
    expect(html).toContain('img-src \'none\'');
  });

  it('does not use innerHTML of untrusted data in the bootstrap', () => {
    expect(html).not.toContain('innerHTML');
  });

  it('accepts an extraScript hook spliced into the bootstrap', () => {
    const withExtra = buildWorldSrcdoc({ channelId: 'c1', extraScript: '/*MARKER_X*/' });
    expect(withExtra).toContain('/*MARKER_X*/');
  });
});
