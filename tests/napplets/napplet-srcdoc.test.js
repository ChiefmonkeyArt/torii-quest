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
