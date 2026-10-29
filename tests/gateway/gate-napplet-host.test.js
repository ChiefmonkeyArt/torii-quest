// v0.2.934 (ADR-0147 M2) — the gateway napplet's trusted HOST (gatewayScreen.js) and
// its pure protocol (gateNapplet.js). The doorway UI runs in a sandboxed iframe; the
// host must validate every message and keep all authority.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { gateStateFor, parseGateRequest, sanitizeGateTheme, gateRowView, GATE_FORWARD_KEYS, gateHostLabel, gateArrivalFor } from '../../src/engine/gateway/gateNapplet.js';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);
const rowA = { pubkey: A, displayName: 'Bekka', shortPubkey: 'npub1bekka…', wsEndpoint: 'wss://bekka.example/mp', relays: ['wss://secret.relay'], website: 'https://bekka.example/quest/' };
const rowB = { pubkey: B, displayName: 'Chief', wsEndpoint: 'wss://chief.example/mp', website: 'https://chief.example/quest/' };

describe('gateNapplet protocol (pure)', () => {
  it('rows carry display strings only — no endpoints, relays or extra fields', () => {
    const { state, rows } = gateStateFor({ mutualFriends: [rowA], otherWorlds: [rowB], canTravel: true });
    const json = JSON.stringify(state);
    expect(json).not.toMatch(/wss:|secret|relays|wsEndpoint/);
    expect(state.sections[0].rows[0]).toEqual({ key: A, label: 'Bekka', sub: 'npub1bekka…' });
    expect(rows.get(A)).toBe(rowA); // the ORIGINAL record stays host-side
    expect(state.canTravel).toBe(true);
  });
  it('caps rows, reports searching/offline honestly, drops junk', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ pubkey: (i.toString(16).padStart(2, '0')).repeat(32) }));
    const { state } = gateStateFor({ otherWorlds: [null, 7, ...many] });
    expect(state.sections[1].rows).toHaveLength(24);
    expect(state.sections[1].count).toBe(42);
    expect(gateStateFor({ scanStatus: 'scanning' }).state.searching).toBe(true);
    expect(gateStateFor({ scanStatus: 'offline' }).state.sections[1].empty).toBe('login to see worlds');
    expect(gateRowView({ pubkey: 'nothex' }).key).toBe('');
  });
  it('parseGateRequest: nonce, namespace, action and payload are all checked', () => {
    const ok = (type, data) => ({ type, id: 1, channelId: 'cid12345', data });
    expect(parseGateRequest(ok('gate.ready', {}), 'cid12345')).toEqual({ action: 'ready', data: {} });
    expect(parseGateRequest(ok('gate.ready', {}), 'other')).toBeNull();
    expect(parseGateRequest(ok('gate.ready', {}), '')).toBeNull();
    expect(parseGateRequest({ type: 'gate.ready', channelId: 'cid12345' }, 'cid12345')).toBeNull(); // no id
    expect(parseGateRequest(ok('world.visit', {}), 'cid12345')).toBeNull();
    expect(parseGateRequest(ok('gate.travel', {}), 'cid12345')).toBeNull(); // unknown action
    expect(parseGateRequest(ok('gate.peek', { key: A }), 'cid12345')).toEqual({ action: 'peek', data: { key: A } });
    expect(parseGateRequest(ok('gate.peek', { key: 'x' }), 'cid12345')).toBeNull();
    expect(parseGateRequest(ok('gate.key', { type: 'keydown', code: 'KeyW' }), 'cid12345').data).toEqual({ type: 'keydown', code: 'KeyW' });
    expect(parseGateRequest(ok('gate.key', { type: 'keydown', code: 'Enter' }), 'cid12345')).toBeNull(); // Enter is an intent, never a key
    expect(parseGateRequest(ok('gate.key', { type: 'keypress', code: 'KeyW' }), 'cid12345')).toBeNull();
    expect(parseGateRequest(ok('gate.size', { h: 1e9 }), 'cid12345').data.h).toBe(4000);
    expect(parseGateRequest(ok('gate.size', { h: -1 }), 'cid12345')).toBeNull();
    expect(GATE_FORWARD_KEYS.has('Escape')).toBe(false);
  });
  it('v0.2.935: enter carries only a boolean confirm; stay is an intent; hosts and arrivals are display-safe', () => {
    const ok = (type, data) => ({ type, id: 1, channelId: 'cid12345', data });
    expect(parseGateRequest(ok('gate.enter', { confirm: true, url: 'https://evil' }), 'cid12345')).toEqual({ action: 'enter', data: { confirm: true } });
    expect(parseGateRequest(ok('gate.enter', { confirm: 'yes' }), 'cid12345').data.confirm).toBe(false);
    expect(parseGateRequest(ok('gate.stay', { x: 1 }), 'cid12345')).toEqual({ action: 'stay', data: {} });
    expect(gateHostLabel('https://Other.Example/quest/?a=1')).toBe('other.example');
    expect(gateHostLabel('not a url')).toBe('');
    expect(gateHostLabel('https://localhost/')).toBe('');
    expect(gateArrivalFor({ kind: 'arrive', owner: 'B\u0000ekka' + 'x'.repeat(200), npub: 'not-an-npub' })).toEqual({ kind: 'arrive', owner: ('Bekka' + 'x'.repeat(200)).slice(0, 80), world: '', npub: '' });
    expect(gateArrivalFor({ kind: 'nope' })).toBeNull();
  });

  it('theme: known keys with colour values only', () => {
    expect(sanitizeGateTheme({ '--gw-accent': '#f7931a', '--gw-glass': 'rgba(1, 2, 3, 0.5)', '--gw-evil': '#fff', '--gw-ink': 'url(x)', '--gw-edge': 'red; background:url(x)' }))
      .toEqual({ '--gw-accent': '#f7931a', '--gw-glass': 'rgba(1, 2, 3, 0.5)' });
    expect(sanitizeGateTheme(null)).toEqual({});
  });
});

// ── the host adapter with fake DOM / window ───────────────────────────────────────
function fakeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(), style: {}, attrs: {}, children: [], handlers: {}, id: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); },
  };
  if (tag === 'iframe') el.contentWindow = { posted: [], postMessage(m, _o, tr) { this.posted.push({ m, tr }); } };
  if (tag === 'canvas') { el.width = 0; el.height = 0; }
  return el;
}

describe('gatewayScreen — napplet host', () => {
  let G; let win; let doc; let iframe; let cid; const calls = { peek: [], commit: 0, close: 0 };
  const saved = {};
  const from = (type, data, src) => G._gatewayNappletMessageForTest({ source: src || iframe.contentWindow, data: { type, id: 1, channelId: cid, data: data || {} } });
  const posted = () => iframe.contentWindow.posted.map((p) => p.m);
  const open = (extra = {}) => G.openGatewayScreen({
    mutualFriends: [rowA], otherWorlds: [rowB], canTravel: true,
    onPeek: (w) => calls.peek.push(w), onCommit: () => { calls.commit += 1; }, onClose: () => { calls.close += 1; }, ...extra,
  });

  beforeAll(async () => {
    for (const k of ['document', 'window', 'KeyboardEvent', 'createImageBitmap']) saved[k] = globalThis[k];
    win = { innerHeight: 1000, listeners: [], addEventListener(t, fn) { this.listeners.push([t, fn]); } };
    doc = { dispatched: [], body: fakeEl('body'), createElement: (t) => fakeEl(t), dispatchEvent(e) { this.dispatched.push(e); return true; } };
    globalThis.window = win; globalThis.document = doc;
    globalThis.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
    globalThis.createImageBitmap = async () => ({ width: 4, height: 2, close() {} });
    vi.resetModules();
    G = await import('../../src/engine/gateway/gatewayScreen.js');
  });
  afterAll(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; } });

  it('is inert while closed', () => {
    expect(G.isGatewayScreenOpen()).toBe(false);
    G.peekGateWorld(rowA);
    expect(calls.peek).toHaveLength(0);
    expect(G.getGatewayPreviewCanvas()).toBeNull();
  });

  it('mounts the napplet sandboxed, with a nonce, and listens for messages', () => {
    open();
    const backdrop = doc.body.children[0];
    iframe = backdrop.children[0];
    cid = G._gatewayChannelForTest();
    expect(iframe.attrs.sandbox).toBe('allow-scripts');
    expect(iframe.attrs.referrerpolicy).toBe('no-referrer');
    expect(cid).toMatch(/^[0-9a-z]{8,64}$/);
    expect(iframe.src).toBe(`/napplets/gateway/index.html#c=${cid}`);
    expect(win.listeners.some(([t]) => t === 'message')).toBe(true);
    expect(posted()).toHaveLength(0); // nothing is sent before the napplet says ready
  });

  it('ignores messages from other sources or with the wrong nonce', () => {
    from('gate.ready', {}, { postMessage() {} });
    G._gatewayNappletMessageForTest({ source: iframe.contentWindow, data: { type: 'gate.ready', id: 1, channelId: 'forged', data: {} } });
    expect(posted()).toHaveLength(0);
  });

  it('on ready: theme, state (display only) and the peek, all stamped with the nonce', () => {
    from('gate.ready');
    const types = posted().map((m) => m.type);
    expect(types).toEqual(['gate.theme', 'gate.state', 'gate.peek']);
    expect(posted().every((m) => m.channelId === cid)).toBe(true);
    expect(JSON.stringify(posted())).not.toMatch(/wss:/);
  });

  it('a peek can only name a row the host sent; 入 waits for the host to say ready', () => {
    from('gate.peek', { key: 'cc'.repeat(32) });
    expect(calls.peek).toHaveLength(0);
    from('gate.peek', { key: A });
    expect(calls.peek).toEqual([rowA]); // the ORIGINAL record (with its endpoint) goes to the host
    expect(G.gatewayPeekKey()).toBe(A);
    expect(posted().at(-1)).toMatchObject({ type: 'gate.peek', data: { key: A, label: 'Bekka', ready: false } });
    from('gate.enter');
    G.commitGatewayScreen();
    expect(calls.commit).toBe(0); // not ready → no travel (the early-press finding)
    expect(G.markGatewayPeekReady()).toBe(true);
    expect(posted().at(-1).data.ready).toBe(true);
    from('gate.enter');
    expect(calls.commit).toBe(1);
  });

  it('switching rows re-arms (ready resets) and refresh keeps the peek', () => {
    from('gate.peek', { key: B });
    expect(G.gatewayPeekKey()).toBe(B);
    G.commitGatewayScreen();
    expect(calls.commit).toBe(1);
    G.refreshGatewayScreen({ mutualFriends: [rowA], otherWorlds: [{ ...rowB, displayName: 'Chiefmonkey' }] });
    const last = posted().slice(-2);
    expect(last[0].type).toBe('gate.state');
    expect(last[0].data.canTravel).toBe(true); // kept from open
    expect(last[1]).toMatchObject({ type: 'gate.peek', data: { key: B } });
  });

  it('forwards movement keys only, as KeyboardEvents on the document', () => {
    from('gate.key', { type: 'keydown', code: 'KeyW' });
    from('gate.key', { type: 'keydown', code: 'Enter' });
    expect(doc.dispatched.map((e) => [e.type, e.code, e.key])).toEqual([['keydown', 'KeyW', 'w']]);
  });

  it('size is clamped to 46% of the window', () => {
    from('gate.size', { h: 2000 });
    expect(iframe.style.height).toBe('460px');
    from('gate.size', { h: 10 });
    expect(iframe.style.height).toBe('60px');
  });

  it('theme is sanitised before it reaches the napplet', () => {
    expect(G.setGatewayTheme({ '--gw-accent': '#123', '--gw-x': '#fff' })).toEqual({ '--gw-accent': '#123' });
    expect(posted().at(-1)).toEqual({ type: 'gate.theme', channelId: cid, data: { vars: { '--gw-accent': '#123' } } });
  });

  it('preview frames go over as transferable bitmaps', async () => {
    const c = G.getGatewayPreviewCanvas();
    c.width = 4; c.height = 2;
    G.pushGatewayPreview();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const p = iframe.contentWindow.posted.at(-1);
    expect(p.m.type).toBe('gate.preview');
    expect(p.tr).toEqual([p.m.data.bitmap]);
  });

  it('close: onClose once, peek cleared, then inert', () => {
    from('gate.close');
    expect(calls.close).toBe(1);
    expect(G.isGatewayScreenOpen()).toBe(false);
    expect(G.gatewayPeekKey()).toBe('');
    from('gate.close');
    from('gate.peek', { key: A });
    G.commitGatewayScreen();
    expect(calls.close).toBe(1);
    expect(calls.commit).toBe(1);
  });

  it('guests: rows render but cannot be peeked from the napplet', () => {
    open({ canTravel: false });
    from('gate.peek', { key: A });
    expect(G.gatewayPeekKey()).toBe('');
    G.closeGatewayScreen();
  });

  it('visit mode (M3.3): the HOST asks first, and only a confirm while asking travels', () => {
    open();
    from('gate.ready');
    from('gate.peek', { key: B });
    expect(G.markGatewayPeekVisit({ host: 'other.example', note: 'other-engine' })).toBe(true);
    expect(G.gatewayPeekMode()).toBe('visit');
    expect(posted().at(-1).data).toMatchObject({ key: B, ready: true, mode: 'visit', host: 'other.example', note: 'other-engine', confirm: false });
    expect(G.getGatewayPreviewCanvas()).toBeNull(); // no mirror for a visit
    const before = calls.commit;
    from('gate.enter', { confirm: true });          // a napplet cannot skip the question
    expect(calls.commit).toBe(before);
    expect(posted().at(-1).data.confirm).toBe(true); // …it only made the host ask
    from('gate.stay');
    expect(posted().at(-1).data.confirm).toBe(false);
    from('gate.enter', {});                          // ask again
    from('gate.enter', {});                          // a plain enter while asking is not a confirm
    expect(calls.commit).toBe(before);
    from('gate.enter', { confirm: true });           // GO
    expect(calls.commit).toBe(before + 1);
    G.commitGatewayScreen();                         // keyboard: first Enter asks…
    expect(calls.commit).toBe(before + 1);
    G.commitGatewayScreen();                         // …second Enter goes
    expect(calls.commit).toBe(before + 2);
    from('gate.peek', { key: A });                   // switching rows resets the mode
    expect(G.gatewayPeekMode()).toBe('enter');
    expect(G.markGatewayPeekVisit({ host: '' })).toBe(false);
    expect(G.markGatewayPeekVisit({ host: 'x.example', note: 'made-up' })).toBe(true);
    expect(posted().at(-1).data.note).toBe('other-engine');
    G.closeGatewayScreen();
    expect(G.markGatewayPeekVisit({ host: 'x.example' })).toBe(false);
    expect(G.gatewayPeekMode()).toBe('');
  });

  it('a pre-peek (world link / menu hand-off) arms from the host side', () => {
    open();
    const linkRow = { npub: 'npub1x', pubkey: 'dd'.repeat(32) };
    G.peekGateWorld(linkRow);
    expect(calls.peek.at(-1)).toBe(linkRow);
    expect(G.gatewayPeekKey()).toBe('dd'.repeat(32));
    G.closeGatewayScreen();
  });
});

describe('arrivalCard — the napplet in arrival mode', () => {
  let A_; let doc; let win; const saved = {};
  beforeAll(async () => {
    for (const k of ['document', 'window']) saved[k] = globalThis[k];
    win = { innerHeight: 900, listeners: [], addEventListener(t, fn) { this.listeners.push([t, fn]); } };
    doc = { body: fakeEl('body'), createElement: (t) => fakeEl(t) };
    doc.body.removeChild = function (c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; };
    globalThis.window = win; globalThis.document = doc;
    vi.resetModules();
    A_ = await import('../../src/engine/gateway/arrivalCard.js');
  });
  afterAll(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; } });

  it('mounts sandboxed, non-interactive, in arrival mode; sends the card on ready', () => {
    expect(A_.showArrivalCard({ kind: 'arrive', owner: 'Bekka', world: 'torii-quest', npub: 'npub1a3um269aaf3u5cy37kuykrrrnsg2pyv7za06pxjduv25lq5sdujs2qmdj6' })).toBe(true);
    const { frame, cid, payload } = A_._arrivalStateForTest();
    expect(frame.attrs.sandbox).toBe('allow-scripts');
    expect(frame.attrs.tabindex).toBe('-1');
    expect(frame.style.pointerEvents).toBe('none');
    expect(frame.src).toBe(`/napplets/gateway/index.html#c=${cid}&m=arrival`);
    expect(payload).toEqual({ kind: 'arrive', owner: 'Bekka', world: 'torii-quest', npub: 'npub1a3um269…2qmdj6' });
    A_._arrivalMessageForTest({ source: {}, data: { type: 'gate.ready', id: 1, channelId: cid, data: {} } }); // wrong source
    expect(frame.contentWindow.posted).toHaveLength(0);
    A_._arrivalMessageForTest({ source: frame.contentWindow, data: { type: 'gate.ready', id: 1, channelId: cid, data: {} } });
    expect(frame.contentWindow.posted.map((p) => p.m.type)).toEqual(['gate.theme', 'gate.arrival']);
    A_._arrivalMessageForTest({ source: frame.contentWindow, data: { type: 'gate.size', id: 2, channelId: cid, data: { h: 999 } } });
    expect(frame.style.height).toBe('200px');
  });
  it('ignores every intent but close, and close removes the frame', () => {
    const { frame, cid } = A_._arrivalStateForTest();
    A_._arrivalMessageForTest({ source: frame.contentWindow, data: { type: 'gate.enter', id: 3, channelId: cid, data: {} } });
    expect(A_._arrivalStateForTest().frame).toBe(frame);
    A_._arrivalMessageForTest({ source: frame.contentWindow, data: { type: 'gate.close', id: 4, channelId: cid, data: {} } });
    expect(A_._arrivalStateForTest().frame).toBeNull();
    expect(doc.body.children).toHaveLength(0);
  });
  it('one card at a time; unknown kinds and junk are refused', () => {
    A_.showArrivalCard({ kind: 'arrive', owner: 'x' });
    A_.showArrivalCard({ kind: 'home' });
    expect(doc.body.children).toHaveLength(1);
    expect(A_._arrivalStateForTest().payload).toEqual({ kind: 'home', owner: '', world: '', npub: '' });
    expect(A_.showArrivalCard({ kind: 'teleport' })).toBe(false);
    A_.hideArrivalCard();
    expect(doc.body.children).toHaveLength(0);
  });
});
