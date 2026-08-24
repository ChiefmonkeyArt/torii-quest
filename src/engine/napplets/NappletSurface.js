// engine/napplets/NappletSurface.js — the browser-only trusted-shell mounter for one
// in-world surface napplet (ADR-0057). Creates a sandboxed srcdoc iframe, binds its
// contentWindow to a napplet identity, and routes only source-validated postMessages
// through the world handlers. This is the nap-torii-world host surface.
//
// TRUST BOUNDARY (per NIP-5D): every inbound message is validated by
// MessageEvent.source — a napplet cannot spoof another's identity because only the
// iframe whose contentWindow matches event.source is dispatched. event.origin is
// never trusted (sandboxed iframes run at an opaque origin).
//
// Browser dependencies (window, document) are injected so the surface is unit-testable
// with plain stubs and never touches jsdom. No live relay, Blossom, signing, wallet,
// or travel — this scaffold only proves the mount + message-routing boundary.

import { validateEnvelope } from './nappletEnvelope.js';
import { normalizeIdentity } from './nappletIdentity.js';
import { buildWorldSrcdoc } from './nappletSrcdoc.js';

// createNappletSurface({ window, document, container, surfaceId, handlers, identity, srcdoc? })
//   → { iframe, source, identity, destroy }.
// `identity` is { dTag, aggregateHash } (normalized here). `handlers` is the output
// of createWorldHandlers(). `srcdoc` defaults to buildWorldSrcdoc().
export function createNappletSurface({
  window,
  document,
  container,
  surfaceId,
  handlers,
  identity,
  srcdoc,
}) {
  const norm = normalizeIdentity(identity);
  const html = srcdoc === undefined ? buildWorldSrcdoc() : srcdoc;

  const iframe = document.createElement('iframe');
  // Exactly allow-scripts: NO allow-same-origin → opaque origin, parent can reach
  // contentWindow for source comparison but cannot read the napplet's DOM.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('data-napplet-surface', surfaceId);
  iframe.setAttribute('data-napplet-dtag', norm.dTag);
  iframe.srcdoc = html;
  container.appendChild(iframe);

  // The contentWindow is the unforgeable source identity. In a real browser it is a
  // WindowProxy; in tests it is whatever the injected document.createElement returns.
  const source = iframe.contentWindow;
  const reg = { surfaceId, identity: norm, source };

  function onMessage(ev) {
    if (!ev || ev.source !== source) return; // not this napplet — ignore
    const v = validateEnvelope(ev.data);
    if (!v.ok) return; // malformed — silently drop (forward-compat)
    const out = handlers.dispatch(v.type, v.data, reg.surfaceId, v.id);
    if (out && source && typeof source.postMessage === 'function') {
      source.postMessage(out, '*');
    }
  }

  window.addEventListener('message', onMessage);

  function destroy() {
    window.removeEventListener('message', onMessage);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }

  return { iframe, source, identity: norm, surfaceId, destroy };
}
