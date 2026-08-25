// engine/napplets/NappletSurface.js — the browser-only trusted-shell mounter for one
// in-world surface napplet (ADR-0057 + ADR-0058). Creates a sandboxed srcdoc iframe,
// binds its contentWindow to a napplet identity, and routes only source-validated
// postMessages through the world handlers. This is the nap-torii-world host surface.
//
// TRUST BOUNDARY (per NIP-5D): every inbound message is validated by
// MessageEvent.source — a napplet cannot spoof another's identity because only the
// iframe whose contentWindow matches event.source is dispatched. event.origin is
// never trusted (sandboxed iframes run at an opaque origin).
//
// ADR-0058 nonce (channelId): when the surface builds the srcdoc itself (no `srcdoc`
// override), it injects a per-mount nonce and rejects any inbound message whose
// `channelId` does not match. The nonce is also stamped on every outbound result/push.
// When `srcdoc` is overridden (test/debug escape hatch), the caller owns the nonce.
//
// Browser dependencies (window, document) are injected so the surface is unit-testable
// with plain stubs and never touches jsdom. No live relay, Blossom, signing, wallet,
// or travel — data is brokered by the caller via post().

import { validateEnvelope } from './nappletEnvelope.js';
import { normalizeIdentity } from './nappletIdentity.js';
import { buildWorldSrcdoc, generateChannelId } from './nappletSrcdoc.js';

// createNappletSurface({ window, document, container, surfaceId, handlers, identity,
//   srcdoc?, extraScript?, channelId? }) → { iframe, source, identity, surfaceId,
//   channelId, post, destroy }.
// `identity` is { dTag, aggregateHash } (normalized here). `handlers` is the output
// of createWorldHandlers(). `srcdoc` overrides the shell-built bootstrap (skips nonce
// injection — caller's responsibility). `extraScript` is spliced into the shell-built
// bootstrap (e.g. a product renderer). `channelId` overrides the generated nonce.
export function createNappletSurface({
  window,
  document,
  container,
  surfaceId,
  handlers,
  identity,
  srcdoc,
  extraScript,
  channelId,
}) {
  const norm = normalizeIdentity(identity);
  const cid = channelId || generateChannelId();
  // If the caller overrides the srcdoc they own the nonce; otherwise the shell injects
  // it and enforces it on every inbound message.
  const builtSrcdoc = srcdoc === undefined;
  const html = builtSrcdoc
    ? buildWorldSrcdoc({ channelId: cid, extraScript })
    : srcdoc;

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
  const reg = { surfaceId, identity: norm, source, channelId: cid };

  function onMessage(ev) {
    if (!ev || ev.source !== source) return; // not this napplet — ignore
    // Nonce check — enforced only when the shell built the srcdoc (injected the nonce).
    if (builtSrcdoc) {
      if (!ev.data || ev.data.channelId !== cid) return;
    }
    const v = validateEnvelope(ev.data);
    if (!v.ok) return; // malformed — silently drop (forward-compat)
    const out = handlers.dispatch(v.type, v.data, reg.surfaceId, v.id);
    if (out && source && typeof source.postMessage === 'function') {
      source.postMessage({ ...out, channelId: cid }, '*');
    }
  }

  window.addEventListener('message', onMessage);

  /** Push a shell→napplet event envelope (e.g. world.surface.update) carrying the
   *  channelId nonce. No-op if the iframe is gone. */
  function post(type, data) {
    if (source && typeof source.postMessage === 'function') {
      source.postMessage({ type, channelId: cid, data: data || {} }, '*');
    }
  }

  function destroy() {
    window.removeEventListener('message', onMessage);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }

  return { iframe, source, identity: norm, surfaceId, channelId: cid, post, destroy };
}
