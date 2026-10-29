// v0.2.937 — Gate v1 §8.1 "world + travel" extension, the Unreachable group and the
// exact world lookup. Reader + writer are pure; the host part uses a fake DOM.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { readTravelExtension, effectiveTravelModes, travelExtensionFor, TRAVEL_MODES } from '../../src/engine/gateway/travelExtension.js';
import { advertisedTravel, rowIsUnreachable } from '../../src/engine/gateway/travelMode.js';
import { gateStateFor, GATE_NOTES } from '../../src/engine/gateway/gateNapplet.js';
import { extractGatewayFromEvent, GATEWAY_FIELDS } from '../../src/engine/gateway/gatewayRead.js';
import { buildPresenceEvent, worldsFromEvents } from '../../src/engine/gateway/worldPresence.js';
import { discoverWorldReference } from '../../src/engine/world/worldResolver.js';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);
const C = 'cc'.repeat(32);
const SITE = 'https://other.example/quest/';

describe('§8.1 reader', () => {
  it('reads world ids and travel modes from tags; tags win over content', () => {
    const r = readTravelExtension([['world', 'torii-quest'], ['travel', 'enter', 'visit']], { worlds: ['x'], travel: ['visit'] });
    expect(r).toEqual({ worlds: ['torii-quest'], travel: ['enter', 'visit'] });
    expect(readTravelExtension([], { worlds: ['w1'], travel: ['visit'] })).toEqual({ worlds: ['w1'], travel: ['visit'] });
  });
  it('no travel tag or content = unknown (null); an empty tag = known, no modes', () => {
    expect(readTravelExtension([], {}).travel).toBeNull();
    expect(readTravelExtension([['travel']], {}).travel).toEqual([]);
  });
  it('drops unknown modes, duplicates, bad world ids and caps worlds at 4', () => {
    const r = readTravelExtension([
      ['travel', 'teleport', 'enter', 'enter', 7],
      ['world', '../etc'], ['world', ''], ['world', 'x'.repeat(129)], ['world', 'ok.1'],
      ['world', 'a'], ['world', 'b'], ['world', 'c'], ['world', 'd'],
    ], {});
    expect(r.travel).toEqual(['enter']);
    expect(r.worlds).toEqual(['ok.1', 'a', 'b', 'c']);
    expect(TRAVEL_MODES).toEqual(['enter', 'visit']);
  });
  it('visit is only usable with a website', () => {
    expect(effectiveTravelModes({ travel: ['enter', 'visit'] })).toEqual(['enter']);
    expect(effectiveTravelModes({ travel: ['visit'], website: SITE })).toEqual(['visit']);
    expect(effectiveTravelModes({})).toBeNull();
  });
  it('gatewayRead carries the extension on a real signed heartbeat', () => {
    const sk = generateSecretKey();
    const { event: ev } = buildPresenceEvent({ pubkey: getPublicKey(sk), zoneId: 'z', title: 'T', website: SITE, relays: ['wss://r.example'], worlds: ['torii-quest'], travel: ['enter', 'visit'] });
    const signed = finalizeEvent(ev, sk);
    const { gateway: g } = extractGatewayFromEvent(signed);
    expect(g.worlds).toEqual(['torii-quest']);
    expect(g.travel).toEqual(['enter', 'visit']);
    expect(GATEWAY_FIELDS).toEqual(expect.arrayContaining(['worlds', 'travel']));
    const row = worldsFromEvents([signed]).worlds[0];               // the directory's own pipeline
    expect(row).toMatchObject({ worlds: ['torii-quest'], travel: ['enter', 'visit'] });
  });
});

describe('§8.1 writer', () => {
  it('nothing known → no travel tag (readers stay "unknown")', () => {
    const { event: ev } = buildPresenceEvent({ pubkey: A, zoneId: 'z', title: 'T', website: SITE });
    expect(ev.tags.some((t) => t[0] === 'travel' || t[0] === 'world')).toBe(false);
    expect(JSON.parse(ev.content).travel).toBeUndefined();
  });
  it('drops visit without a website and sanitises ids', () => {
    expect(travelExtensionFor({ worlds: ['good', 'bad id'], travel: ['enter', 'visit', 'fly'] })).toEqual({
      tags: [['world', 'good'], ['travel', 'enter']],
      content: { worlds: ['good'], travel: ['enter'] },
    });
    expect(travelExtensionFor({ travel: ['visit'], website: SITE }).tags).toEqual([['travel', 'visit']]);
  });
});

describe('advertisedTravel + rowIsUnreachable', () => {
  it('enter / visit-only / unreachable / unknown', () => {
    expect(advertisedTravel({ pubkey: A, travel: ['enter'] })).toEqual({ known: true, enter: true });
    const v = advertisedTravel({ pubkey: A, travel: ['visit'], website: SITE });
    expect(v).toMatchObject({ known: true, enter: false, visit: { mode: 'visit', host: 'other.example', note: 'visit-only' } });
    expect(advertisedTravel({ pubkey: A, travel: [] })).toEqual({ known: true, enter: false, unreachable: true });
    expect(advertisedTravel({ pubkey: A, travel: ['visit'], website: 'http://127.0.0.1/' }).unreachable).toBe(true);
    expect(advertisedTravel({ pubkey: A })).toEqual({ known: false });
    expect(GATE_NOTES).toContain('visit-only');
  });
  it('unreachable: no usable mode, unknown with no website, or a recent failed lookup', () => {
    expect(rowIsUnreachable({ pubkey: A, travel: [] })).toBe(true);
    expect(rowIsUnreachable({ pubkey: A })).toBe(true);                       // §3.7: never travellable
    expect(rowIsUnreachable({ pubkey: A, website: SITE })).toBe(false);       // unknown, may try
    expect(rowIsUnreachable({ pubkey: A, travel: ['enter'] })).toBe(false);
    expect(rowIsUnreachable({ pubkey: A, website: SITE }, { failed: new Set([A]) })).toBe(true);
    expect(rowIsUnreachable(null)).toBe(true);
  });
});

describe('gateStateFor: the collapsed Unreachable group', () => {
  const ok = { pubkey: A, displayName: 'Bekka', website: SITE };
  const dead = { pubkey: B, displayName: 'Ghost', wsEndpoint: 'wss://secret.example' };
  it('splits unreachable rows out; they are counted, display-only and never peekable', () => {
    const { state, rows } = gateStateFor({ mutualFriends: [dead], otherWorlds: [ok, null, dead], isUnreachable: (w) => rowIsUnreachable(w) });
    expect(state.sections[0].rows).toEqual([]);
    expect(state.sections[0].count).toBe(0);
    expect(state.sections[1].rows.map((r) => r.key)).toEqual([A]);
    expect(state.unreachable.count).toBe(2);
    expect(state.unreachable.rows.every((r) => r.key === '' && r.label === 'Ghost')).toBe(true);
    expect(rows.has(B)).toBe(false);
    expect(JSON.stringify(state)).not.toMatch(/wss:/);
  });
  it('no predicate → nothing hidden (old behaviour); a throwing predicate fails open', () => {
    expect(gateStateFor({ otherWorlds: [dead] }).state.unreachable.count).toBe(0);
    expect(gateStateFor({ otherWorlds: [dead], isUnreachable: () => { throw new Error('x'); } }).state.sections[1].rows).toHaveLength(1);
  });
  it('the group is capped like the sections', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ pubkey: i.toString(16).padStart(2, '0').repeat(32) }));
    const { state } = gateStateFor({ otherWorlds: many, isUnreachable: () => true });
    expect(state.unreachable.count).toBe(40);
    expect(state.unreachable.rows).toHaveLength(24);
  });
});

describe('napplet renders Unreachable collapsed and inert', () => {
  const DIR = new URL('../../conformance/gateway-v1/napplet/', import.meta.url);
  it('a closed <details>, no buttons inside, only when there are any', () => {
    const HTML = readFileSync(new URL('index.html', DIR), 'utf8');
    const JS = readFileSync(new URL('gateway.js', DIR), 'utf8');
    const dom = new JSDOM(HTML.replace(/<script[^>]*><\/script>/, ''), { url: 'https://node.example/quest/napplets/gateway/index.html#c=abcdef1234', runScripts: 'outside-only' });
    const host = { postMessage() {} };
    Object.defineProperty(dom.window, 'parent', { value: host, configurable: true });
    dom.window.eval(JS);
    const send = (data) => {
      const ev = new dom.window.MessageEvent('message', { data: { type: 'gate.state', channelId: 'abcdef1234', data } });
      Object.defineProperty(ev, 'source', { value: host });
      dom.window.dispatchEvent(ev);
    };
    const sections = [{ title: 'mutual friends', empty: 'none', rows: [] }, { title: 'all other worlds', empty: 'none', rows: [] }];
    send({ canTravel: true, sections, unreachable: { count: 0, rows: [] } });
    expect(dom.window.document.querySelector('details')).toBeNull();
    send({ canTravel: true, sections, unreachable: { count: 3, rows: [{ key: '', label: '<b>Ghost</b>', sub: 'npub1…' }] } });
    const det = dom.window.document.querySelector('details');
    expect(det).not.toBeNull();
    expect(det.open).toBe(false);
    expect(det.querySelector('summary').textContent).toBe('unreachable · 3');
    expect(det.querySelectorAll('button')).toHaveLength(0);
    expect(det.innerHTML).not.toContain('<b>');                 // text only
  });
});

describe('exact world lookup', () => {
  it('asks for the owner by author and by #p (and #d when known), not the newest 200', async () => {
    const seen = [];
    await discoverWorldReference({ pubkeyHex: A, relays: ['wss://r1', 'wss://r2'], worldId: 'torii-quest', relayReqFn: async (url, f) => { seen.push([url, f]); return { ok: true, events: [] }; } });
    expect(seen).toHaveLength(2);
    const [f1, f2] = seen[0][1];
    expect(f1).toMatchObject({ authors: [A], limit: 20, '#d': ['torii-quest'] });
    expect(f2).toMatchObject({ '#p': [A], limit: 20, '#d': ['torii-quest'] });
    expect(f2.authors).toBeUndefined();
    expect(seen.every(([, f]) => f.every((x) => x.limit <= 20))).toBe(true);
  });
  it('main.js hands the resolver filter list to the transport, which sends them in one REQ', () => {
    const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/Array\.isArray\(filter\) \? filter : \[filter\]/);
    const nostr = readFileSync(new URL('../../src/nostr.js', import.meta.url), 'utf8');
    expect(nostr).toMatch(/\['REQ', entry\.subId, \.\.\.filters\]/);
  });
});

// ── host: a failed lookup moves the row to Unreachable for 10 minutes ─────────────
function fakeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(), style: {}, attrs: {}, children: [], handlers: {}, id: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); },
  };
  if (tag === 'iframe') el.contentWindow = { posted: [], postMessage(m) { this.posted.push(m); } };
  return el;
}

describe('gatewayScreen: markGatewayRowUnreachable', () => {
  let G; let iframe; let cid; let t = 1_000_000; const saved = {};
  const lastState = () => iframe.contentWindow.posted.filter((m) => m.type === 'gate.state').at(-1).data;
  beforeAll(async () => {
    for (const k of ['document', 'window']) saved[k] = globalThis[k];
    globalThis.window = { innerHeight: 1000, addEventListener() {} };
    globalThis.document = { body: fakeEl('body'), createElement: (x) => fakeEl(x), dispatchEvent() { return true; } };
    vi.resetModules();
    G = await import('../../src/engine/gateway/gatewayScreen.js');
    G._setGatewayClockForTest(() => t);
  });
  afterAll(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; } });

  it('hides a failed row for 10 minutes, then lets it back', () => {
    G.openGatewayScreen({ otherWorlds: [{ pubkey: A, displayName: 'A', website: SITE }, { pubkey: C, displayName: 'C', website: SITE }], canTravel: true });
    iframe = globalThis.document.body.children[0].children[0];
    cid = G._gatewayChannelForTest();
    G._gatewayNappletMessageForTest({ source: iframe.contentWindow, data: { type: 'gate.ready', id: 1, channelId: cid, data: {} } });
    expect(lastState().sections[1].rows.map((r) => r.key)).toEqual([A, C]);
    expect(G.markGatewayRowUnreachable('nothex')).toBe(false);
    expect(G.markGatewayRowUnreachable(A)).toBe(true);
    expect(lastState().sections[1].rows.map((r) => r.key)).toEqual([C]);
    expect(lastState().unreachable.count).toBe(1);
    t += 9 * 60_000;
    G.refreshGatewayScreen({ otherWorlds: [{ pubkey: A, displayName: 'A', website: SITE }, { pubkey: C, displayName: 'C', website: SITE }] });
    expect(lastState().unreachable.count).toBe(1);
    t += 2 * 60_000;
    G.refreshGatewayScreen({ otherWorlds: [{ pubkey: A, displayName: 'A', website: SITE }, { pubkey: C, displayName: 'C', website: SITE }] });
    expect(lastState().unreachable.count).toBe(0);
    G.closeGatewayScreen();
  });
});
