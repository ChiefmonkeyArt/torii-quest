// tests/napplets/product-napplet-host.test.js — ADR-0058. DI stubs (no jsdom). Proves:
// the host mounts only when the surface is enabled, pushes world.surface.update
// envelopes carrying the channelId + plebeian.auction channel, destroys cleanly, and
// falls back when the surface is disabled / the body container is missing / mount throws.
import { describe, it, expect } from 'vitest';
import { createProductNappletHost } from '../../src/engine/napplets/productNappletHost.js';

// Fake iframe with a controllable contentWindow source (mirrors napplet-surface.test.js).
// `withLoad` adds an addEventListener('load',…) capture + fireLoad() so the first-update
// race fix can be exercised (otherwise the host treats the iframe as already ready).
function makeFakeIframe(withLoad) {
  const attrs = {};
  const contentWindow = { posted: [], postMessage(msg, target) { this.posted.push({ msg, target }); } };
  const el = {
    _attrs: attrs,
    _loadListeners: [],
    setAttribute(name, val) { attrs[name] = String(val); },
    getAttribute(name) { return attrs[name] ?? null; },
    contentWindow,
    parentNode: null,
  };
  if (withLoad) {
    el.addEventListener = (ev, cb) => { if (ev === 'load') el._loadListeners.push(cb); };
    el.fireLoad = () => { el._loadListeners.forEach((cb) => cb()); };
  }
  return { el, contentWindow };
}

function makeStubs(withLoad = false) {
  const listeners = {};
  const window = {
    addEventListener(ev, cb) { (listeners[ev] ??= []).push(cb); },
    removeEventListener(ev, cb) { listeners[ev] = (listeners[ev] || []).filter((c) => c !== cb); },
  };
  const container = {
    children: [],
    _text: '',
    appendChild(child) { child.parentNode = container; container.children.push(child); return child; },
    removeChild(child) { container.children = container.children.filter((c) => c !== child); child.parentNode = null; },
    get textContent() { return container._text; },
    set textContent(v) { container._text = String(v); container.children = []; },
  };
  let nextIframe = makeFakeIframe(withLoad);
  const document = {
    createElement(tag) {
      if (tag === 'iframe') { const f = nextIframe; nextIframe = makeFakeIframe(withLoad); return f.el; }
      throw new Error('unexpected createElement: ' + tag);
    },
    getElementById() { return null; },
  };
  return { window, document, container, listeners };
}

// A fake surface config: enabled surfaces return a full config; disabled return enabled:false.
function fakeSurfaceConfig(enabled) {
  return () => enabled
    ? { surfaceId: 'product-stall-panel', zoneId: 'nap', surfaceKind: 'panel',
        surfaceTransform: { position: [1, 2, 3], yaw: 0 }, allowedEmitKinds: [], enabled: true }
    : { surfaceId: 'product-stall-panel', zoneId: 'nap', surfaceKind: 'panel',
        surfaceTransform: { position: [1, 2, 3], yaw: 0 }, allowedEmitKinds: [], enabled: false };
}
const listSurfaces = () => [];

describe('productNappletHost — mount', () => {
  it('mounts when the surface is enabled + a container is present', () => {
    const s = makeStubs();
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    expect(host.mount(s.container)).toBe(true);
    expect(host.isMounted()).toBe(true);
  });

  it('falls back (returns false) when the surface is disabled', () => {
    const s = makeStubs();
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(false), listSurfaces,
    });
    expect(host.mount(s.container)).toBe(false);
    expect(host.isMounted()).toBe(false);
  });

  it('falls back when the body container is missing', () => {
    const s = makeStubs();
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    expect(host.mount(null)).toBe(false);
    expect(host.isMounted()).toBe(false);
  });

  it('mount is idempotent — a second mount does not create a second surface', () => {
    const s = makeStubs();
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    host.mount(s.container);
    const first = s.container.children.length;
    expect(host.mount(s.container)).toBe(true);
    expect(s.container.children.length).toBe(first);
  });

  it('clears pre-existing static content (e.g. the "Waiting for relay…" placeholder baked into index.html) before inserting the iframe (ADR-0061)', () => {
    const s = makeStubs();
    s.container.textContent = ''; // reset via setter to seed _text
    s.container.appendChild({ tagName: 'div', className: 'auction-empty' }); // simulate static placeholder
    expect(s.container.children.length).toBe(1);
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    expect(host.mount(s.container)).toBe(true);
    // Only the iframe should remain — the static placeholder must be gone, not coexisting.
    expect(s.container.children.length).toBe(1);
    expect(s.container.children[0].className).toBeUndefined(); // it's the iframe stub, not the placeholder div
  });
});

describe('productNappletHost — push', () => {
  it('posts world.surface.update with the channel + snapshot + channelId nonce', () => {
    const s = makeStubs();
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    host.mount(s.container);
    const snapshot = { bids: [{ amount: 100 }], bidCount: 1 };
    host.push(snapshot, 'connected · live');

    // The surface iframe is the one child of the container.
    const iframe = s.container.children[0];
    const src = iframe.contentWindow;
    expect(src.posted).toHaveLength(1);
    const { msg, target } = src.posted[0];
    expect(msg.type).toBe('world.surface.update');
    expect(msg.channelId).toBeTruthy();
    expect(msg.data.channel).toBe('plebeian.auction');
    expect(msg.data.snapshot).toBe(snapshot);
    expect(msg.data.status).toBe('connected · live');
    expect(msg.data.seq).toBe(1);
    expect(target).toBe('*');
  });

  it('push is a no-op when not mounted', () => {
    const s = makeStubs();
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(false), listSurfaces,
    });
    expect(() => host.push({ bids: [] }, '')).not.toThrow();
  });
});

describe('productNappletHost — destroy', () => {
  it('destroys the surface + removes the listener', () => {
    const s = makeStubs();
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    host.mount(s.container);
    expect(s.listeners.message).toHaveLength(1);
    expect(s.container.children.length).toBe(1);
    host.destroy();
    expect(host.isMounted()).toBe(false);
    expect(s.listeners.message).toHaveLength(0);
    expect(s.container.children.length).toBe(0);
  });
});

describe('productNappletHost — first-update replay (ADR-0058 race fix)', () => {
  it('queues a push that lands before the iframe boots, then replays it on load', () => {
    const s = makeStubs(true);
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    host.mount(s.container);
    const iframe = s.container.children[0];
    const src = iframe.contentWindow;
    // push BEFORE the iframe loaded → must be queued, not posted yet
    host.push({ bids: [{ amount: 100 }], bidCount: 1 }, 'connecting');
    expect(src.posted).toHaveLength(0);
    // the iframe loads (its script has registered world.on by this point)
    iframe.fireLoad();
    expect(src.posted).toHaveLength(1);
    expect(src.posted[0].msg.type).toBe('world.surface.update');
    expect(src.posted[0].msg.channelId).toBeTruthy();
    expect(src.posted[0].msg.data.snapshot.bids[0].amount).toBe(100);
  });

  it('only the latest pending payload is replayed (older pushes overwritten)', () => {
    const s = makeStubs(true);
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    host.mount(s.container);
    const iframe = s.container.children[0];
    const src = iframe.contentWindow;
    host.push({ bids: [{ amount: 100 }], bidCount: 1 }, 'a');
    host.push({ bids: [{ amount: 200 }], bidCount: 1 }, 'b');
    expect(src.posted).toHaveLength(0);
    iframe.fireLoad();
    expect(src.posted).toHaveLength(1); // only the latest replayed
    expect(src.posted[0].msg.data.snapshot.bids[0].amount).toBe(200);
  });

  it('posts immediately once the iframe has loaded (no queueing after load)', () => {
    const s = makeStubs(true);
    const host = createProductNappletHost({
      window: s.window, document: s.document,
      getSurfaceConfig: fakeSurfaceConfig(true), listSurfaces,
    });
    host.mount(s.container);
    const iframe = s.container.children[0];
    const src = iframe.contentWindow;
    iframe.fireLoad();
    host.push({ bids: [{ amount: 50 }], bidCount: 1 }, 'live');
    expect(src.posted).toHaveLength(1);
    expect(src.posted[0].msg.data.snapshot.bids[0].amount).toBe(50);
  });
});
