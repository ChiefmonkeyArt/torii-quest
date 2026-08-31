// engine/napplets/avatarNappletSrcdoc.js — builds the `srcdoc` HTML that bootstraps
// `window.napplet.avatar` inside a sandboxed napplet iframe (ADR-0083, follows the
// ADR-0057/0058 shell pattern). PURE + node-safe: returns an HTML string; mounts
// nothing.
//
// The `avatar` namespace is nap-torii-avatar v0 — read/write for the player's
// character event (proposed kind 35100 addressable, d="torii-character", one per
// npub for v0). WRITE is opt-in per napplet: the mount config must include the
// `torii-avatar-write` requires tag; without it, avatar.propose returns `unsupported`
// and the shell will not surface a consent prompt.
//
// Trust boundary is identical to the world/game shells (see nappletSrcdoc.js).

export const AVATAR_METHODS = Object.freeze([
  'get',
  'subscribe',
  'unsubscribe',
  'propose',
  'revert',
]);

export function generateChannelId() {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(8));
    return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  return 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// buildAvatarSrcdoc({ channelId, extraScript } = {}) → HTML string.
// The in-iframe bootstrap exposes:
//   window.napplet.avatar.<method>(data) → Promise<result> | rejection on .error
//   window.napplet.avatar.on(type, handler) / .off(type, handler)   (shell→napplet)
export function buildAvatarSrcdoc({ channelId, extraScript } = {}) {
  const cid = channelId || generateChannelId();
  const methods = JSON.stringify(AVATAR_METHODS);
  const cidJson = JSON.stringify(cid);
  const extra = typeof extraScript === 'string' ? extraScript : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;padding:0;height:100%;background:transparent;color:#e8e8e8;font-family:system-ui,sans-serif}#root{position:absolute;inset:0}</style>
</head><body><div id="root"></div><script>
(function(){
  var CID = ${cidJson};
  var METHODS = ${methods};
  var pending = Object.create(null);
  var subs = Object.create(null);
  var seq = 1;
  function post(type, data){
    return new Promise(function(resolve, reject){
      var id = 'a' + (seq++);
      pending[id] = { resolve: resolve, reject: reject, type: type };
      parent.postMessage({ type: type, id: id, channelId: CID, data: data || {} }, '*');
    });
  }
  function onMessage(ev){
    if (ev.source !== parent) return;
    var m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.channelId !== CID) return;
    if (typeof m.type !== 'string') return;
    if (m.type.endsWith('.result') && m.id && pending[m.id]) {
      var p = pending[m.id]; delete pending[m.id];
      p.resolve(m.result || {});
      return;
    }
    if (m.type.endsWith('.error') && m.id && pending[m.id]) {
      var e = pending[m.id]; delete pending[m.id];
      e.reject(new Error((m.error && m.error.code) || 'napplet-error'));
      return;
    }
    var handlers = subs[m.type];
    if (handlers) {
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](m.data || {}); } catch (_) { /* isolate */ }
      }
    }
  }
  window.addEventListener('message', onMessage, false);
  var api = { on: function(type, fn){
    if (!subs[type]) subs[type] = [];
    subs[type].push(fn);
    return function(){ api.off(type, fn); };
  }, off: function(type, fn){
    var h = subs[type]; if (!h) return;
    var i = h.indexOf(fn); if (i >= 0) h.splice(i, 1);
  }};
  for (var i = 0; i < METHODS.length; i++) (function(m){
    api[m] = function(data){ return post('avatar.' + m, data); };
  })(METHODS[i]);
  window.napplet = window.napplet || {};
  window.napplet.avatar = api;
  ${extra}
})();
</script></body></html>`;
}
