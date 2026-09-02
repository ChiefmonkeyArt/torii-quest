// tests/napplets/game-napplet-host.test.js — the NappletGameHost mount boundary
// (ADR-0082). DI stubs (no jsdom). Proves: iframe sandbox is exactly allow-scripts,
// source is validated by MessageEvent.source, channelId is enforced, sync + async
// results are posted back with the correct channelId, and destroy() tears down.
import { describe, it, expect } from 'vitest';
import { createNappletGameHost } from '../../src/engine/napplets/NappletGameHost.js';
import { createGameHandlers } from '../../src/engine/napplets/gameNappletHandlers.js';

function makeFakeIframe() {
  const attrs = {};
  const contentWindow = { posted: [], postMessage(msg) { this.posted.push(msg); } };
  const el = {
    _attrs: attrs,
    setAttribute(n, v) { attrs[n] = String(v); },
    getAttribute(n) { return attrs[n] ?? null; },
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
    appendChild(c) { c.parentNode = container; container.children.push(c); return c; },
    removeChild(c) {
      container.children = container.children.filter((x) => x !== c);
      c.parentNode = null;
    },
  };
  const document = {
    createElement(tag) {
      if (tag === 'iframe') return makeFakeIframe().el;
      throw new Error('unexpected createElement: ' + tag);
    },
  };
  return { window, document, container, listeners };
}

function dispatch(stubs, source, data) {
  const ev = { source, data };
  for (const cb of (stubs.listeners.message || [])) cb(ev);
}

function makeHost(stubs, handlers, opts = {}) {
  return createNappletGameHost({
    window: stubs.window,
    document: stubs.document,
    container: stubs.container,
    surfaceId: 'arena-game',
    handlers,
    identity: { dTag: 'torii-arena', aggregateHash: 'builtin-arena-v1' },
    channelId: opts.channelId || 'cid-test',
  });
}

describe('NappletGameHost — sandbox', () => {
  it('mounts an iframe with sandbox exactly "allow-scripts"', () => {
    const s = makeStubs();
    const h = makeHost(s, createGameHandlers({ worldNpub: 'w', worldLabel: 'L' }));
    expect(h.iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(h.iframe.getAttribute('data-napplet-host')).toBe('game');
    expect(s.container.children).toContain(h.iframe);
  });
});

describe('NappletGameHost — source validation', () => {
  it('ignores messages from a stranger window', () => {
    const s = makeStubs();
    const h = makeHost(s, createGameHandlers({ worldNpub: 'w', worldLabel: 'L' }));
    const stranger = { posted: [], postMessage(m) { this.posted.push(m); } };
    dispatch(s, stranger, { type: 'game.host.info', id: 'r1', channelId: 'cid-test', data: {} });
    expect(h.iframe.contentWindow.posted).toHaveLength(0);
  });
  it('rejects messages with wrong channelId', () => {
    const s = makeStubs();
    const h = makeHost(s, createGameHandlers({ worldNpub: 'w', worldLabel: 'L' }));
    dispatch(s, h.source, { type: 'game.host.info', id: 'r1', channelId: 'other-cid', data: {} });
    expect(h.iframe.contentWindow.posted).toHaveLength(0);
  });
  it('posts a result envelope back on valid source + channelId', () => {
    const s = makeStubs();
    const h = makeHost(s, createGameHandlers({ worldNpub: 'w', worldLabel: 'L' }));
    dispatch(s, h.source, { type: 'game.host.info', id: 'r1', channelId: 'cid-test', data: {} });
    expect(h.iframe.contentWindow.posted).toHaveLength(1);
    const m = h.iframe.contentWindow.posted[0];
    expect(m.type).toBe('game.host.info.result');
    expect(m.channelId).toBe('cid-test');
    expect(m.result.worldNpub).toBe('w');
  });
});

describe('NappletGameHost — async publish', () => {
  it('awaits publishEvent and posts the resolved envelope with channelId', async () => {
    const s = makeStubs();
    let resolveIt;
    const p = new Promise((res) => { resolveIt = res; });
    const handlers = createGameHandlers({
      worldNpub: 'w', worldLabel: 'L',
      publishEvent: () => p,
    });
    const h = makeHost(s, handlers);
    dispatch(s, h.source, {
      type: 'game.event.publish', id: 'r1', channelId: 'cid-test',
      data: { event: { kind: 1 } },
    });
    expect(h.iframe.contentWindow.posted).toHaveLength(0);
    resolveIt({ id: 'e1', ok: true, relays: [] });
    await p;
    // one microtask more to let the .then run
    await Promise.resolve();
    expect(h.iframe.contentWindow.posted).toHaveLength(1);
    const m = h.iframe.contentWindow.posted[0];
    expect(m.type).toBe('game.event.publish.result');
    expect(m.channelId).toBe('cid-test');
    expect(m.result.id).toBe('e1');
  });
});

describe('NappletGameHost — destroy', () => {
  it('removes the iframe and the message listener', () => {
    const s = makeStubs();
    const h = makeHost(s, createGameHandlers({ worldNpub: 'w', worldLabel: 'L' }));
    expect(s.listeners.message.length).toBe(1);
    h.destroy();
    expect(s.listeners.message.length).toBe(0);
    expect(s.container.children).not.toContain(h.iframe);
  });
});
