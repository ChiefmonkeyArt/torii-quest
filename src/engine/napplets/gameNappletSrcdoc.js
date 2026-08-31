// engine/napplets/gameNappletSrcdoc.js — builds the `srcdoc` HTML that bootstraps
// `window.napplet.game` inside a sandboxed napplet iframe (ADR-0082, follows the
// ADR-0057/0058 shell pattern). PURE + node-safe: returns an HTML string; mounts
// nothing.
//
// The `game` namespace is nap-torii-game v0 — napplets that OWN their scene (arena,
// racer, puzzle). Unlike `world` napplets (in-world surface panels), a game napplet
// takes over the viewport when mounted and runs its own render loop. The shell still
// brokers everything that crosses the trust boundary: player identity, event publish/
// subscribe (relay-mediated), zone travel, and exit.
//
// Trust boundary is identical to the world shell:
//  - sandbox="allow-scripts" (opaque origin, no allow-same-origin)
//  - `if (ev.source !== parent) return;` — never trust event.origin
//  - per-mount channelId nonce stamped on every request/result/push
//  - CSP: default-src 'none'; connect-src 'none'; img-src 'none'
//  - `script-src`/`style-src` 'unsafe-inline' acceptable for built-in local napplets
//    (shell-controlled srcdoc); hash-based CSP lands with remote napplets (deferred).

export const GAME_METHODS = Object.freeze([
  'host.info',
  'player.get',
  'player.subscribe',
  'player.unsubscribe',
  'event.publish',
  'event.subscribe',
  'event.unsubscribe',
  'visit',
  'exit',
]);

// generateChannelId — re-exported for tests, symmetric with nappletSrcdoc.js.
export function generateChannelId() {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(8));
    return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  return 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// buildGameSrcdoc({ channelId, extraScript } = {}) → HTML string for iframe.srcdoc.
// The in-iframe bootstrap exposes:
//   window.napplet.game.<method>(data) → Promise resolving with .result / rejecting on .error
//   window.napplet.game.on(type, handler)  → unsubscribe fn (shell→napplet event pushes)
//   window.napplet.game.off(type, handler)
// `channelId` defaults to a fresh nonce. `extraScript` is spliced into the bootstrap
// IIFE after the api is built — the game renderer registers its handlers here.
export function buildGameSrcdoc({ channelId, extraScript } = {}) {
  const cid = channelId || generateChannelId();
  const methods = JSON.stringify(GAME_METHODS);
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
      var id = 'g' + (seq++);
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
    // request/result pairing
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
    // shell→napplet event push
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
    api[m] = function(data){ return post('game.' + m, data); };
  })(METHODS[i]);
  window.napplet = window.napplet || {};
  window.napplet.game = api;
  ${extra}
})();
</script></body></html>`;
}
