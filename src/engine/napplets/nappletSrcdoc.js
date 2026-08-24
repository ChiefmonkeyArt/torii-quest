// engine/napplets/nappletSrcdoc.js — builds the `srcdoc` HTML that bootstraps
// `window.napplet.world` inside a sandboxed napplet iframe (ADR-0057). PURE +
// node-safe: returns an HTML string; mounts nothing.
//
// The bootstrap runs INSIDE the iframe at an opaque origin (sandbox="allow-scripts"
// without allow-same-origin). It may only talk to its parent via postMessage — it
// MUST NOT assume same-origin access to window.parent (reading parent.document
// throws). The parent (NappletSurface) validates every inbound message by
// MessageEvent.source, never by event.origin (per NIP-5D).
//
// v0 world surface method set. pose.* and visit are listed so a napplet author can
// call them; the shell responds with an "unsupported" error until implemented.
export const WORLD_METHODS = Object.freeze([
  'attach.get',
  'pose.subscribe',
  'pose.unsubscribe',
  'emit',
  'visit',
  'zone.list',
]);

// buildWorldSrcdoc() → an HTML string to assign as iframe.srcdoc. The in-iframe
// bootstrap exposes window.napplet.world.<method>(data) → Promise that resolves
// with the shell's .result payload or rejects with the shell's .error code.
export function buildWorldSrcdoc() {
  // The methods are spliced into the in-iframe script as a JSON string literal;
  // the bootstrap builds the call surface from that list, so adding a method
  // here is the only change needed to expose it on both sides.
  const methods = JSON.stringify(WORLD_METHODS);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:transparent;font:14px/1.4 system-ui,sans-serif;color:#e8f6f4}</style>
</head><body>
<div id="root"></div>
<script>
(function(){
  "use strict";
  var NS = "world";
  var METHODS = ${methods};
  var pending = {};
  var seq = 0;
  function send(action, data){
    var id = "r" + (++seq) + "." + Date.now();
    return new Promise(function(resolve, reject){
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ type: NS + "." + action, id: id, data: data || {} }, "*");
    });
  }
  window.addEventListener("message", function(ev){
    var msg = ev.data;
    if (!msg || typeof msg !== "object") return;
    var t = msg.type;
    if (typeof t !== "string") return;
    if (!t.endsWith(".result") && !t.endsWith(".error")) return;
    var p = pending[msg.id];
    if (!p) return;
    delete pending[msg.id];
    if (t.endsWith(".result")) p.resolve(msg.result || {});
    else p.reject(new Error((msg.error && msg.error.code) || "error"));
  });
  var api = {};
  METHODS.forEach(function(m){
    api[m] = function(data){ return send(m, data); };
  });
  // Dot-access form too: window.napplet.world.attach.get(data)
  ["attach","pose","zone"].forEach(function(grp){
    api[grp] = {};
  });
  api.attach.get = function(data){ return send("attach.get", data); };
  api.pose.subscribe = function(data){ return send("pose.subscribe", data); };
  api.pose.unsubscribe = function(data){ return send("pose.unsubscribe", data); };
  api.emit = function(data){ return send("emit", data); };
  api.visit = function(data){ return send("visit", data); };
  api.zone.list = function(data){ return send("zone.list", data); };
  window.napplet = window.napplet || {};
  window.napplet.world = api;
  window.napplet.ready = true;
  window.dispatchEvent(new Event("napplet:ready"));
})();
</script>
</body></html>`;
}
