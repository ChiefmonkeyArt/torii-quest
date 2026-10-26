// v0.2.934 (ADR-0147 M2) — the gateway napplet itself (conformance/gateway-v1/napplet/,
// 0BSD), run for real in jsdom with a fake host. It must render only what the host
// sends, post intents, never enable 入 on its own, and never touch the network.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const DIR = new URL('../../conformance/gateway-v1/napplet/', import.meta.url);
const HTML = readFileSync(new URL('index.html', DIR), 'utf8');
const JS = readFileSync(new URL('gateway.js', DIR), 'utf8');
const CID = 'abcdef1234';
const K = 'ab'.repeat(32);

function mount(hash = `#c=${CID}`) {
  const dom = new JSDOM(HTML.replace(/<script[^>]*><\/script>/, ''), { url: `https://node.example/quest/napplets/gateway/index.html${hash}`, runScripts: 'outside-only' });
  const sent = [];
  const host = { postMessage: (m) => sent.push(m) };
  Object.defineProperty(dom.window, 'parent', { value: host, configurable: true });
  dom.window.eval(JS);
  const w = dom.window;
  const send = (type, data, { source = host, channelId = CID } = {}) => {
    const ev = new w.MessageEvent('message', { data: { type, channelId, data } });
    Object.defineProperty(ev, 'source', { value: source });
    w.dispatchEvent(ev);
  };
  const state = (rows, canTravel = true) => send('gate.state', { canTravel, sections: [{ title: 'mutual friends', empty: 'none here', rows }, { title: 'all other worlds', empty: 'no other worlds online', rows: [] }] });
  return { w, doc: w.document, sent, send, state, types: () => sent.map((m) => m.type) };
}

describe('gateway napplet (real script, jsdom)', () => {
  let n;
  beforeEach(() => { n = mount(); });

  it('stays inert without a nonce, and says ready (with the nonce) when mounted', () => {
    const bare = mount('');
    expect(bare.sent).toHaveLength(0);
    expect(n.sent[0]).toMatchObject({ type: 'gate.ready', channelId: CID, data: {} });
    expect(typeof n.sent[0].id).toBe('number');
  });

  it('renders rows as TEXT (markup in a label is never parsed)', () => {
    n.state([{ key: K, label: 'Bekka <img src=x onerror=alert(1)>', sub: 'npub1…' }]);
    expect(n.doc.querySelectorAll('.row')).toHaveLength(1);
    expect(n.doc.querySelector('img')).toBeNull();
    expect(n.doc.querySelector('.name').textContent).toBe('Bekka <img src=x onerror=alert(1)>');
    expect(n.doc.getElementById('note').hidden).toBe(true);
  });

  it('ignores the wrong nonce or the wrong source', () => {
    n.send('gate.state', { canTravel: true, sections: [{ rows: [{ key: K, label: 'x' }] }] }, { channelId: 'forged' });
    n.send('gate.state', { canTravel: true, sections: [{ rows: [{ key: K, label: 'x' }] }] }, { source: {} });
    expect(n.doc.querySelectorAll('.row')).toHaveLength(0);
  });

  it('a row click asks the host to peek; 入 is disabled until the HOST says ready', () => {
    n.state([{ key: K, label: 'Bekka', sub: 's' }]);
    n.doc.querySelector('.row').click();
    expect(n.sent.at(-1)).toMatchObject({ type: 'gate.peek', data: { key: K } });
    n.send('gate.peek', { key: K, label: 'Bekka', ready: false });
    const enter = n.doc.getElementById('enter');
    expect(enter.disabled).toBe(true);
    expect(n.doc.getElementById('looking').textContent).toBe('finding Bekka…');
    enter.disabled = false; enter.click(); // even a forced click sends nothing
    expect(n.types()).not.toContain('gate.enter');
    n.send('gate.peek', { key: K, label: 'Bekka', ready: true });
    expect(enter.disabled).toBe(false);
    expect(n.doc.querySelector('.row').classList.contains('active')).toBe(true);
    enter.click();
    expect(n.types().filter((t) => t === 'gate.enter')).toHaveLength(1);
    n.send('gate.peek', { key: '' });
    expect(n.doc.getElementById('peek').hidden).toBe(true);
  });

  it('guests see rows they cannot click, and the login note', () => {
    n.state([{ key: K, label: 'Bekka' }], false);
    const row = n.doc.querySelector('.row');
    expect(row.tagName).toBe('DIV');
    row.click();
    expect(n.types()).not.toContain('gate.peek');
    expect(n.doc.getElementById('note').hidden).toBe(false);
  });

  it('keys: Escape → close, Enter → enter (only when ready), movement forwarded', () => {
    const key = (type, code, keyName) => n.doc.dispatchEvent(new n.w.KeyboardEvent(type, { code, key: keyName, bubbles: true }));
    key('keydown', 'Enter', 'Enter');
    expect(n.types()).not.toContain('gate.enter');
    key('keydown', 'KeyW', 'w'); key('keyup', 'KeyW', 'w');
    key('keydown', 'KeyQ', 'q');
    key('keydown', 'Escape', 'Escape');
    expect(n.sent.filter((m) => m.type === 'gate.key').map((m) => m.data)).toEqual([{ type: 'keydown', code: 'KeyW' }, { type: 'keyup', code: 'KeyW' }]);
    expect(n.types()).toContain('gate.close');
  });

  it('theme: only known variables with colour values are applied', () => {
    n.send('gate.theme', { vars: { '--gw-accent': '#f7931a', '--gw-ink': 'url(javascript:x)', '--gw-evil': '#fff' } });
    const s = n.doc.documentElement.style;
    expect(s.getPropertyValue('--gw-accent')).toBe('#f7931a');
    expect(s.getPropertyValue('--gw-ink')).toBe('');
    expect(s.getPropertyValue('--gw-evil')).toBe('');
  });
});

describe('gateway napplet — visit mode (M3.3) and the arrival card (M2)', () => {
  it('another engine: labelled VISIT, the host asks, GO confirms, STAY backs out', () => {
    const n = mount();
    n.state([{ key: K, label: 'Elsewhere', sub: 's' }]);
    n.send('gate.peek', { key: K, label: 'Elsewhere', ready: true, mode: 'visit', host: 'other.example', note: 'other-engine', confirm: false });
    const enter = n.doc.getElementById('enter');
    expect(enter.textContent).toBe('VISIT SITE ↗');
    expect(n.doc.getElementById('looking').textContent).toBe('Elsewhere · other.example');
    expect(n.doc.getElementById('peeknote').textContent).toMatch(/no Torii world found/);
    expect(n.doc.getElementById('confirm').hidden).toBe(true);
    enter.click();
    expect(n.sent.at(-1)).toMatchObject({ type: 'gate.enter', data: {} });
    expect(n.sent.at(-1).data.confirm).toBeUndefined();
    // the HOST decides to ask
    n.send('gate.peek', { key: K, label: 'Elsewhere', ready: true, mode: 'visit', host: 'other.example', note: 'other-engine', confirm: true });
    expect(n.doc.getElementById('confirm').hidden).toBe(false);
    expect(n.doc.getElementById('confirm-q').textContent).toBe('Leave Torii Quest for other.example?');
    expect(enter.disabled).toBe(true);
    n.doc.getElementById('stay').click();
    expect(n.sent.at(-1).type).toBe('gate.stay');
    n.doc.getElementById('go').click();
    expect(n.sent.at(-1)).toMatchObject({ type: 'gate.enter', data: { confirm: true } });
    // keys while asking: Escape = stay (not close), Enter = go
    const key = (code, k) => n.doc.dispatchEvent(new n.w.KeyboardEvent('keydown', { code, key: k, bubbles: true }));
    key('Escape', 'Escape');
    expect(n.sent.at(-1).type).toBe('gate.stay');
    key('Enter', 'Enter');
    expect(n.sent.at(-1)).toMatchObject({ type: 'gate.enter', data: { confirm: true } });
    // a visit never shows the preview, and enter-failed has its own sentence
    n.send('gate.peek', { key: K, label: 'Elsewhere', ready: true, mode: 'visit', host: 'other.example', note: 'enter-failed' });
    expect(n.doc.getElementById('preview').hidden).toBe(true);
    expect(n.doc.getElementById('peeknote').textContent).toMatch(/could not build/);
    // back to a Torii world
    n.send('gate.peek', { key: K, label: 'Bekka', ready: true, mode: 'enter' });
    expect(enter.textContent).toBe('入 · ENTER');
    expect(n.doc.getElementById('peeknote').hidden).toBe(true);
  });

  it('arrival mode: draws only gate.arrival, says size, closes when the fade ends', () => {
    const n = mount(`#c=${CID}&m=arrival`);
    expect(n.types()).toEqual(['gate.ready']);
    expect(n.doc.getElementById('card').hidden).toBe(true);
    n.state([{ key: K, label: 'x' }]); // directory messages are ignored here
    expect(n.doc.querySelectorAll('.row')).toHaveLength(0);
    n.send('gate.arrival', { kind: 'arrive', owner: 'Bekka <b>', world: 'torii-quest', npub: 'npub1abc…xyz' });
    expect(n.doc.getElementById('arrival').hidden).toBe(false);
    expect(n.doc.getElementById('arr-title').textContent).toBe('Bekka <b>’s world');
    expect(n.doc.querySelector('b')).toBeNull();
    expect(n.doc.getElementById('arr-sub').textContent).toBe('torii-quest · npub1abc…xyz');
    // keys do nothing in arrival mode
    n.doc.dispatchEvent(new n.w.KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    expect(n.types()).not.toContain('gate.close');
    n.doc.getElementById('arrival').dispatchEvent(new n.w.Event('animationend'));
    expect(n.types().at(-1)).toBe('gate.close');
    n.send('gate.arrival', { kind: 'home' });
    expect(n.doc.getElementById('arr-kicker').textContent).toBe('⛩ home again');
  });

  it('an unknown mount mode stays inert', () => {
    expect(mount(`#c=${CID}&m=evil`).sent).toHaveLength(0);
  });
});

describe('gateway napplet — static guarantees', () => {
  it('its own CSP denies the network; scripts and styles are external only', () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(HTML)[1];
    for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'none'", "img-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"]) expect(csp).toContain(d);
    expect(HTML).not.toMatch(/<script>|<script\s+type="module">|style="/);
    expect(HTML).toMatch(/<script src="gateway\.js" defer><\/script>/);
    expect(HTML).toMatch(/F to gaze around/);
  });
  it('the script never reaches for the network, storage, eval or HTML parsing', () => {
    for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /importScripts/, /\bimport\s*\(/, /innerHTML|outerHTML|insertAdjacentHTML/, /\beval\s*\(/, /new Function/, /localStorage|sessionStorage|indexedDB|document\.cookie/, /window\.open|location\.(href|assign|replace)\s*=/, /sendBeacon/]) {
      expect(JS).not.toMatch(bad);
    }
    expect(JS).toMatch(/if \(!CID \|\| host === window\) return;/);
    expect(JS).toMatch(/if \(ev\.source !== host\) return;/);
  });
  it('is 0BSD (any world may copy it)', () => {
    for (const f of [HTML, JS, readFileSync(new URL('gateway.css', DIR), 'utf8')]) expect(f).toMatch(/SPDX-License-Identifier: 0BSD/);
  });
});
