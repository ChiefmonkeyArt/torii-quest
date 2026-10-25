// SPDX-License-Identifier: 0BSD
// The SAME gateway napplet Torii Quest uses (../napplet/), mounted by a world with no
// engine. Proof that the doorway is portable: any host that speaks these few messages
// gets the directory, peek, 入 and ✕, restyled with its own colours.
//
// mountDoorway({ container, onEnter, theme?, nappletUrl?, win?, doc? }) →
//   { setWorlds(worlds), iframe, destroy() }
//   worlds: readWorlds() output; onEnter(world) runs when the player presses 入.

const HEX64 = /^[0-9a-f]{64}$/;
const nonce = (c) => Array.from(c.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
const label = (w) => String(w.displayName || w.title || (w.owner || '').slice(0, 12) || '—').slice(0, 80);

export function mountDoorway({ container, onEnter, theme = {}, nappletUrl = '../napplet/index.html', win = window, doc = document } = {}) {
  const cid = nonce(win.crypto || globalThis.crypto);
  const f = doc.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('title', 'Torii gateway');
  f.style.cssText = 'width:100%;height:180px;border:0;background:transparent';
  f.src = `${nappletUrl}#c=${cid}`;
  container.appendChild(f);

  let ready = false; let rows = new Map(); let state = null; let peek = null;
  const post = (type, data) => { if (ready && f.contentWindow) f.contentWindow.postMessage({ type, channelId: cid, data }, '*'); };

  function onMessage(ev) {
    if (ev.source !== f.contentWindow) return;
    const m = ev.data;
    if (!m || typeof m !== 'object' || m.channelId !== cid || typeof m.type !== 'string') return;
    const d = m.data && typeof m.data === 'object' ? m.data : {};
    if (m.type === 'gate.ready') { ready = true; post('gate.theme', { vars: theme }); if (state) post('gate.state', state); }
    else if (m.type === 'gate.peek') {
      const w = rows.get(d.key);
      if (!w) return;
      peek = w;
      // No engine, nothing to build: the world is resolved the moment it is listed.
      post('gate.peek', { key: d.key, label: label(w), ready: true });
    } else if (m.type === 'gate.enter') { if (peek && typeof onEnter === 'function') onEnter(peek); }
    else if (m.type === 'gate.close') { peek = null; post('gate.peek', { key: '' }); }
    else if (m.type === 'gate.size' && Number.isFinite(d.h)) f.style.height = `${Math.max(60, Math.min(600, Math.round(d.h)))}px`;
  }
  win.addEventListener('message', onMessage);

  return {
    iframe: f,
    setWorlds(worlds) {
      rows = new Map();
      const view = [];
      for (const w of Array.isArray(worlds) ? worlds : []) {
        if (!w || !w.travellable || !HEX64.test(w.owner || '') || view.length >= 24) continue;
        rows.set(w.owner, w);
        view.push({ key: w.owner, label: label(w), sub: `${w.owner.slice(0, 12)}…` });
      }
      state = { canTravel: true, searching: false, sections: [{ title: 'live worlds', count: view.length, empty: 'no worlds online', rows: view }] };
      post('gate.state', state);
    },
    destroy() { win.removeEventListener('message', onMessage); f.remove(); },
  };
}
