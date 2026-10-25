// v0.2.934 (ADR-0147 M2) — portability proof. The SAME gateway napplet Quest mounts
// runs inside the engine-free reference world (conformance/gateway-v1/reference-world/
// doorway.mjs) with a different theme: list → peek → 入 reaches that world's onEnter.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountDoorway } from '../../conformance/gateway-v1/reference-world/doorway.mjs';

const DIR = new URL('../../conformance/gateway-v1/napplet/', import.meta.url);
const HTML = readFileSync(new URL('index.html', DIR), 'utf8').replace(/<script[^>]*><\/script>/, '');
const JS = readFileSync(new URL('gateway.js', DIR), 'utf8');
const OWNER = 'cd'.repeat(32);

function wire() {
  let napplet = null;
  const listeners = [];
  const hostWin = {
    crypto: globalThis.crypto,
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: () => {},
    postMessage: (m) => { for (const fn of listeners) fn({ source: napplet.proxy, data: m }); }, // napplet → host (source = the iframe WindowProxy)
  };
  const iframe = {
    attrs: {}, style: {}, src: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() {},
    get contentWindow() { return napplet && napplet.proxy; },
  };
  const doc = { createElement: () => iframe };
  const container = { appendChild: (el) => {
    const cid = /#c=([0-9a-z]+)$/.exec(el.src)[1];
    const dom = new JSDOM(HTML, { url: `https://ref.example/napplet/index.html#c=${cid}`, runScripts: 'outside-only' });
    Object.defineProperty(dom.window, 'parent', { value: hostWin, configurable: true });
    // host → napplet: deliver as a MessageEvent whose source is the host window
    const proxy = { postMessage: (m) => { const ev = new dom.window.MessageEvent('message', { data: m }); Object.defineProperty(ev, 'source', { value: hostWin }); dom.window.dispatchEvent(ev); } };
    napplet = { window: dom.window, proxy };
    // the host listens before the napplet script runs (same order as a real load)
    queueMicrotask(() => dom.window.eval(JS));
  } };
  return { hostWin, doc, container, iframe, napplet: () => napplet };
}

describe('the gateway napplet is portable (reference world, no engine)', () => {
  it('lists, peeks and enters through the same napplet, restyled', async () => {
    const w = wire();
    const entered = [];
    const door = mountDoorway({
      container: w.container, doc: w.doc, win: w.hostWin, nappletUrl: '../napplet/index.html',
      theme: { '--gw-accent': '#f7931a', '--gw-evil': '#000' },
      onEnter: (world) => entered.push(world),
    });
    expect(w.iframe.attrs.sandbox).toBe('allow-scripts');
    expect(w.iframe.src).toMatch(/^\.\.\/napplet\/index\.html#c=[0-9a-f]{16}$/);
    await new Promise((r) => setTimeout(r, 0)); // napplet loads → gate.ready → theme
    const world = { owner: OWNER, displayName: 'Bekka', travellable: true, website: 'https://bekka.example/quest/' };
    door.setWorlds([world, { owner: 'nothex', travellable: true }, { owner: 'ee'.repeat(32), travellable: false }]);
    const ndoc = w.napplet().window.document;
    expect(ndoc.documentElement.style.getPropertyValue('--gw-accent')).toBe('#f7931a');
    expect(ndoc.documentElement.style.getPropertyValue('--gw-evil')).toBe('');
    const rows = ndoc.querySelectorAll('.row');
    expect(rows).toHaveLength(1); // only the valid, travellable world
    expect(ndoc.querySelector('.col-title').textContent).toBe('live worlds');
    rows[0].click(); // napplet → gate.peek → host → gate.peek ready
    expect(ndoc.getElementById('enter').disabled).toBe(false);
    expect(ndoc.getElementById('looking').textContent).toBe('looking at Bekka');
    ndoc.getElementById('enter').click();
    expect(entered).toEqual([world]);
    ndoc.getElementById('close').click();
    expect(ndoc.getElementById('peek').hidden).toBe(true);
  });

  it('ignores messages that are not from its napplet', async () => {
    const w = wire();
    const entered = [];
    mountDoorway({ container: w.container, doc: w.doc, win: w.hostWin, onEnter: (x) => entered.push(x) });
    await new Promise((r) => setTimeout(r, 0));
    w.hostWin.postMessage({ type: 'gate.enter', channelId: 'forged', data: {} });
    expect(entered).toHaveLength(0);
  });
});
