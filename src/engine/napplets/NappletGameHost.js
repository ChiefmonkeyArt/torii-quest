// engine/napplets/NappletGameHost.js — the browser-only trusted-shell mounter for a
// nap-torii-game v0 napplet (ADR-0082). Symmetric with NappletSurface (ADR-0057):
// creates a sandboxed srcdoc iframe that OWNS the viewport, binds its contentWindow
// to a napplet identity, and routes only source-validated postMessages through the
// game handlers.
//
// TRUST BOUNDARY (per NIP-5D): every inbound message is validated by
// MessageEvent.source — a napplet cannot spoof another's identity because only the
// iframe whose contentWindow matches event.source is dispatched. event.origin is
// never trusted (sandboxed iframes run at an opaque origin).
//
// Difference from NappletSurface:
//  - The game iframe fills its container by design (fullscreen or a zone-owned
//    viewport). The caller decides where it mounts (arena container, modal, zone
//    booth); the host just fills it 100% × 100%.
//  - The game shell dispatches the `game.*` namespace via createGameHandlers().
//  - Handler returns may be async (event.publish is a Promise); the host awaits
//    and posts the resolved envelope with the correct channelId.
//
// Browser dependencies (window, document) are injected so the host is unit-testable
// with plain stubs and never touches jsdom.

import { validateEnvelope } from './nappletEnvelope.js';
import { normalizeIdentity } from './nappletIdentity.js';
import { buildGameSrcdoc, generateChannelId } from './gameNappletSrcdoc.js';

const DEFAULT_IFRAME_STYLE =
  'width:100%;height:100%;min-height:0;border:0;background:transparent;display:block';

// createNappletGameHost({ window, document, container, surfaceId, handlers, identity,
//   srcdoc?, extraScript?, channelId?, iframeStyle? }) → { iframe, source, identity,
//   surfaceId, channelId, post, destroy }.
//
// `handlers` is the output of createGameHandlers(). See NappletSurface for the
// override/extraScript/channelId semantics — identical here for the `game` shell.
export function createNappletGameHost({
  window,
  document,
  container,
  surfaceId,
  handlers,
  identity,
  srcdoc,
  extraScript,
  channelId,
  iframeStyle,
}) {
  if (!window || !document || !container)
    throw new Error('NappletGameHost: window, document, container are required');
  if (!handlers || typeof handlers.dispatch !== 'function')
    throw new Error('NappletGameHost: handlers.dispatch is required');
  if (typeof surfaceId !== 'string' || !surfaceId)
    throw new Error('NappletGameHost: surfaceId must be a non-empty string');

  const norm = normalizeIdentity(identity);
  const cid = channelId || generateChannelId();
  const builtSrcdoc = srcdoc === undefined;
  const html = builtSrcdoc
    ? buildGameSrcdoc({ channelId: cid, extraScript })
    : srcdoc;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('data-napplet-host', 'game');
  iframe.setAttribute('data-napplet-surface', surfaceId);
  iframe.setAttribute('data-napplet-dtag', norm.dTag);
  iframe.setAttribute('style', typeof iframeStyle === 'string' ? iframeStyle : DEFAULT_IFRAME_STYLE);
  iframe.srcdoc = html;
  container.appendChild(iframe);

  const source = iframe.contentWindow;

  function post(type, data) {
    if (!source) return false;
    try {
      source.postMessage({ type, channelId: cid, data: data || {} }, '*');
      return true;
    } catch (_) {
      return false;
    }
  }

  function _postEnvelope(env) {
    if (!source || !env) return;
    try {
      // Stamp the per-mount channelId on every outbound envelope so the napplet
      // accepts it. `type` on result/error envelopes already carries the suffix.
      source.postMessage(Object.assign({}, env, { channelId: cid }), '*');
    } catch (_) { /* isolate — a dead iframe is not our problem */ }
  }

  function _onMessage(ev) {
    // Trust boundary: unforgeable source identity.
    if (ev.source !== source) return;
    const m = ev.data;
    // ADR-0058 channelId nonce — validated before shape.
    if (!m || typeof m !== 'object' || m.channelId !== cid) return;
    const v = validateEnvelope(m);
    if (!v.ok) return; // silently drop malformed
    // Ignore result/error frames — those are shell→napplet only in v0.
    if (v.type.endsWith('.result') || v.type.endsWith('.error')) return;
    const out = handlers.dispatch(v.type, v.data, surfaceId, v.id);
    if (!out) return;
    // Handler may return a Promise envelope for async ops (event.publish).
    if (out.__async && out.promise && typeof out.promise.then === 'function') {
      out.promise.then(_postEnvelope, (err) => {
        _postEnvelope({
          type: v.type + '.error',
          id: v.id,
          error: { code: 'internal', message: String(err && err.message || err) },
        });
      });
      return;
    }
    _postEnvelope(out);
  }

  window.addEventListener('message', _onMessage, false);

  function destroy() {
    try { window.removeEventListener('message', _onMessage, false); } catch (_) { /* isolate */ }
    try { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch (_) { /* isolate */ }
    // If the handlers own subscription state per surface, release it. Optional
    // because a pure test handler will not implement it.
    if (typeof handlers.releaseSurface === 'function') {
      try { handlers.releaseSurface(surfaceId); } catch (_) { /* isolate */ }
    }
  }

  return {
    iframe,
    source,
    identity: norm,
    surfaceId,
    channelId: cid,
    post,
    destroy,
  };
}
