// engine/napplets/nappletSrcdoc.js — builds the `srcdoc` HTML that bootstraps
// `window.napplet.world` inside a sandboxed napplet iframe (ADR-0057 + ADR-0058).
// PURE + node-safe: returns an HTML string; mounts nothing.
//
// The bootstrap runs INSIDE the iframe at an opaque origin (sandbox="allow-scripts"
// without allow-same-origin). It may only talk to its parent via postMessage — it
// MUST NOT assume same-origin access to window.parent (reading parent.document
// throws). The parent (NappletSurface) validates every inbound message by
// MessageEvent.source, never by event.origin (per NIP-5D).
//
// ADR-0058 hardening (now landed):
//  - parent source check: `if (ev.source !== parent) return;`
//  - per-mount nonce (channelId): parent injects it; every request carries it; the
//    shell validates event.source === contentWindow AND channelId.
//  - shell→napplet event channel: world.on(type, handler) / world.off(type, handler).
//  - CSP: default-src 'none'; connect-src 'none'; img-src 'none' — the iframe cannot
//    fetch / WebSocket / load images even if a bug tried to. script-src/style-src
//    'unsafe-inline' is acceptable here because the srcdoc is fully shell-controlled
//    (built-in local napplet, not untrusted remote). Hash-based CSP lands with remote
//    napplets (deferred).
//  - extraScript hook: a product renderer can be spliced in without duplicating the
//    bootstrap.

export const WORLD_METHODS = Object.freeze([
  'attach.get',
  'pose.subscribe',
  'pose.unsubscribe',
  'emit',
  'visit',
  'zone.list',
]);

// generateChannelId() → a 16-hex-char per-mount nonce (crypto-backed when available).
// Used as the channelId nonce stamped on every napplet↔shell message.
export function generateChannelId() {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(8));
    return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  // Fallback only in non-crypto envs (none in practice — Node 20 + browsers ship crypto).
  return 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// buildWorldSrcdoc({ channelId, extraScript } = {}) → an HTML string to assign as
// iframe.srcdoc. The in-iframe bootstrap exposes:
//   window.napplet.world.<method>(data) → Promise resolving with the shell's .result
//     payload or rejecting with the shell's .error code.
//   window.napplet.world.on(type, handler) → unsubscribe fn  (shell→napplet events)
//   window.napplet.world.off(type, handler)
// `channelId` defaults to a fresh nonce. `extraScript` is spliced into the bootstrap
// IIFE after the world api is built — a product renderer registers its world.on handler
// here without duplicating the bootstrap.
export function buildWorldSrcdoc({ channelId, extraScript } = {}) {
  const cid = channelId || generateChannelId();
  const methods = JSON.stringify(WORLD_METHODS);
  const cidJson = JSON.stringify(cid);
  const extra = typeof extraScript === 'string' ? extraScript : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;background:transparent;font:14px/1.4 system-ui,sans-serif;color:#e8f6f4}</style>
</head><body>
<div id="root"></div>
<script>
(function(){
  "use strict";
  var CHANNEL_ID = ${cidJson};
  var NS = "world";
  var METHODS = ${methods};
  var pending = {};
  var seq = 0;
  var handlers = {};
  function send(action, data){
    var id = "r" + (++seq) + "." + Date.now();
    return new Promise(function(resolve, reject){
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ type: NS + "." + action, id: id, channelId: CHANNEL_ID, data: data || {} }, "*");
    });
  }
  window.addEventListener("message", function(ev){
    if (ev.source !== parent) return;
    var msg = ev.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.channelId !== CHANNEL_ID) return;
    var t = msg.type;
    if (typeof t !== "string") return;
    if (t.endsWith(".result") || t.endsWith(".error")) {
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (t.endsWith(".result")) p.resolve(msg.result || {});
      else p.reject(new Error((msg.error && msg.error.code) || "error"));
      return;
    }
    var set = handlers[t];
    if (set) { for (var i = 0; i < set.length; i++) { try { set[i](msg.data || {}, msg); } catch (_) {} } }
  });
  var api = {};
  METHODS.forEach(function(m){ api[m] = function(data){ return send(m, data); }; });
  ["attach","pose","zone"].forEach(function(grp){ api[grp] = {}; });
  api.attach.get = function(data){ return send("attach.get", data); };
  api.pose.subscribe = function(data){ return send("pose.subscribe", data); };
  api.pose.unsubscribe = function(data){ return send("pose.unsubscribe", data); };
  api.emit = function(data){ return send("emit", data); };
  api.visit = function(data){ return send("visit", data); };
  api.zone.list = function(data){ return send("zone.list", data); };
  api.on = function(type, cb){
    if (typeof type !== "string" || typeof cb !== "function") return function(){};
    (handlers[type] || (handlers[type] = [])).push(cb);
    return function(){ var s = handlers[type]; if (!s) return; handlers[type] = s.filter(function(f){ return f !== cb; }); };
  };
  api.off = function(type, cb){
    if (typeof type !== "string") return;
    var s = handlers[type]; if (!s) return;
    handlers[type] = s.filter(function(f){ return f !== cb; });
  };
  window.napplet = window.napplet || {};
  window.napplet.world = api;
  window.napplet.ready = true;
  window.napplet.channelId = CHANNEL_ID;
  window.dispatchEvent(new Event("napplet:ready"));
  ${extra}
})();
</script>
</body></html>`;
}
