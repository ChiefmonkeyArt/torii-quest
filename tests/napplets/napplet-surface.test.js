// tests/napplets/napplet-surface.test.js — the trusted-shell mount boundary (ADR-0057).
// Dependency-injected stubs (no jsdom). Proves: iframe sandbox is exactly
// allow-scripts, source is validated by MessageEvent.source (not origin), a wrong
// source is ignored, a valid source gets its result posted back, and destroy()
// tears the listener + iframe down.
import { describe, it, expect } from 'vitest';
import { createNappletSurface } from '../../src/engine/napplets/NappletSurface.js';
import { createWorldHandlers } from '../../src/engine/napplets/worldNappletHandlers.js';
import {
  getWorldSurfaceConfig, listWorldSurfaces,
} from '../../src/engine/napplets/worldNappletSurfaceConfig.js';

// A fake iframe element with a contentWindow source we control. setAttribute/getAttribute
// store attrs; parentNode is set when the container adopts it.
function makeFakeIframe() {
  const attrs = {};
  const contentWindow = { posted: [], postMessage(msg, target) { this.posted.push({ msg, target }); } };
  const el = {
    _attrs: attrs,
    setAttribute(name, val) { attrs[name] = String(val); },
    getAttribute(name) { return attrs[name] ?? null; },
    contentWindow,
    parentNode: null,
  };
  return { el, contentWindow };
}

function makeStubs() {
  const listeners = {};
  const window = {
    addEventListener(ev, cb) { (listeners[ev] ??= []).push(cb); },
    removeEventListener(ev, cb) {
      listeners[ev] = (listeners[ev] || []).filter((c) => c !== cb);
    },
  };
  const container = {
    children: [],
    appendChild(child) { child.parentNode = container; container.children.push(child); return child; },
    removeChild(child) {
      container.children = container.children.filter((c) => c !== child);
      child.parentNode = null;
    },
  };
  let nextIframe = makeFakeIframe();
  const document = {
    createElement(tag) {
      if (tag === 'iframe') { const f = nextIframe; nextIframe = makeFakeIframe(); return f.el; }
      throw new Error('unexpected createElement: ' + tag);
    },
  };
  return { window, document, container, listeners, takeIframe: () => nextIframe };
}

function makeHandlers() {
  return createWorldHandlers({
    worldNpub: 'npub1shellhost',
    worldLabel: 'Cornish Torii',
    getSurfaceConfig: getWorldSurfaceConfig,
    listSurfaces: listWorldSurfaces,
  });
}

function dispatch(stubs, source, data) {
  const ev = { source, data };
  for (const cb of (stubs.listeners.message || [])) cb(ev);
}

describe('NappletSurface — sandbox', () => {
  it('mounts an iframe with sandbox exactly "allow-scripts" (no allow-same-origin)', () => {
    const s = makeStubs();
    const surf = createNappletSurface({
      window: s.window, document: s.document, container: s.container,
      surfaceId: 'product-stall-panel', handlers: makeHandlers(),
      identity: { dTag: 'dtag-a', aggregateHash: 'hash-a' },
    });
    expect(surf.iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(s.container.children).toContain(surf.iframe);
  });
});

describe('NappletSurface — source validation', () => {
  it('ignores messages from an unregistered source (no result posted)', () => {
    const s = makeStubs();
    const surf = createNappletSurface({
      window: s.window, document: s.document, container: s.container,
      surfaceId: 'product-stall-panel', handlers: makeHandlers(),
      identity: { dTag: 'dtag-a', aggregateHash: 'hash-a' },
    });
    const stranger = { posted: [], postMessage() { this.posted.push(arguments); } };
    dispatch(s, stranger, { type: 'world.attach.get', id: 'r1', data: {} });
    expect(stranger.posted).toHaveLength(0);
    expect(surf.source).not.toBe(stranger);
  });

  it('posts a result envelope back to the registered source only', () => {
    const s = makeStubs();
    const surf = createNappletSurface({
      window: s.window, document: s.document, container: s.container,
      surfaceId: 'product-stall-panel', handlers: makeHandlers(),
      identity: { dTag: 'dtag-a', aggregateHash: 'hash-a' },
    });
    dispatch(s, surf.source, { type: 'world.attach.get', id: 'r1', data: {} });
    expect(surf.source.posted).toHaveLength(1);
    const { msg, target } = surf.source.posted[0];
    expect(msg).toEqual({
      type: 'world.attach.get.result', id: 'r1',
      result: expect.objectContaining({ surfaceId: 'product-stall-panel', zoneId: 'nap' }),
    });
    expect(target).toBe('*');
  });

  it('silently drops malformed envelopes from a valid source', () => {
    const s = makeStubs();
    const surf = createNappletSurface({
      window: s.window, document: s.document, container: s.container,
      surfaceId: 'product-stall-panel', handlers: makeHandlers(),
      identity: { dTag: 'dtag-a', aggregateHash: 'hash-a' },
    });
    dispatch(s, surf.source, { type: 'not-dotted', id: 'r1' });
    dispatch(s, surf.source, { type: 'world.emit' }); // missing id
    expect(surf.source.posted).toHaveLength(0);
  });
});

describe('NappletSurface — lifecycle', () => {
  it('destroy() removes the message listener and the iframe from the DOM', () => {
    const s = makeStubs();
    const surf = createNappletSurface({
      window: s.window, document: s.document, container: s.container,
      surfaceId: 'product-stall-panel', handlers: makeHandlers(),
      identity: { dTag: 'dtag-a', aggregateHash: 'hash-a' },
    });
    expect(s.listeners.message).toHaveLength(1);
    expect(s.container.children).toContain(surf.iframe);
    surf.destroy();
    expect(s.listeners.message).toHaveLength(0);
    expect(s.container.children).not.toContain(surf.iframe);
  });

  it('accepts an injected srcdoc (e.g. a test harness without the real bootstrap)', () => {
    const s = makeStubs();
    const surf = createNappletSurface({
      window: s.window, document: s.document, container: s.container,
      surfaceId: 'product-stall-panel', handlers: makeHandlers(),
      identity: { dTag: 'dtag-a', aggregateHash: 'hash-a' },
      srcdoc: '<!doctype html><script>1</script>',
    });
    expect(surf.iframe.srcdoc).toContain('script');
  });
});
