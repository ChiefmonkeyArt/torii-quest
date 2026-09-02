// engine/napplets/productNappletHost.js — ADR-0058. Browser-only, DI of window/document.
// Mounts the product-stall-panel napplet surface into #auction-panel-body when the
// surface is enabled, pushes serialized auction snapshots to it, and destroys on close.
// Falls back to the legacy renderAuctionPanel() path when the surface is disabled, the
// body container is missing, or the mount throws — so the panel always works.

import { createNappletSurface } from './NappletSurface.js';
import { createWorldHandlers } from './worldNappletHandlers.js';
import { getWorldSurfaceConfig, listWorldSurfaces } from './worldNappletSurfaceConfig.js';
import { PRODUCT_NAPPLET_EXTRA_SCRIPT } from './productPanelNappletSrcdoc.js';
import { buildSurfaceUpdatePayload } from './productNappletSnapshot.js';

const SURFACE_ID = 'product-stall-panel';
// Built-in local napplet identity (NOT an external NIP-5A manifest — see ADR-0058).
const IDENTITY = Object.freeze({ dTag: SURFACE_ID, aggregateHash: 'builtin-product-v1' });
const IFRAME_STYLE = 'width:100%;height:100%;min-height:240px;border:0;background:transparent';

// createProductNappletHost({ window, document, getSurfaceConfig?, listSurfaces?,
//   bodyId?, worldNpub?, worldLabel? }) → { mount(), push(), isMounted(), destroy() }.
// `mount(container?)` returns true if the napplet is live, false on fallback. When
// `container` is omitted it looks up #auction-panel-body (the default).
export function createProductNappletHost({
  window,
  document,
  getSurfaceConfig = getWorldSurfaceConfig,
  listSurfaces = listWorldSurfaces,
  bodyId = 'auction-panel-body',
  worldNpub = 'npub1shellhost',
  worldLabel = 'Cornish Torii',
} = {}) {
  let surface = null;
  let seq = 0;
  let iframeLoaded = false;
  let pendingPayload = null; // latest world.surface.update payload; replayed once the iframe boots
  const handlers = createWorldHandlers({
    worldNpub, worldLabel, getSurfaceConfig, listSurfaces,
  });

  // ADR-0058 first-update race fix: the iframe script registers its
  // world.on('world.surface.update') handler during boot (before the load event).
  // A push() that lands before boot completes would be dropped and the body would
  // stay empty until the next relay event. So queue the latest payload and replay it
  // on the iframe's load event (by which point the handler is registered).
  function _replayIfPending() {
    if (pendingPayload && surface) {
      surface.post('world.surface.update', pendingPayload);
      pendingPayload = null;
    }
  }

  function mount(container) {
    if (surface) return true; // already mounted
    const cfg = getSurfaceConfig(SURFACE_ID);
    if (!cfg || !cfg.enabled) return false; // disabled → caller falls back to legacy
    const host = container || (document && document.getElementById(bodyId));
    if (!host) return false; // no body container → fallback
    // ADR-0061: the body starts with static placeholder markup (e.g. the
    // "Waiting for relay…" empty state baked into index.html). NappletSurface
    // appends the iframe rather than replacing content, so without this the
    // placeholder and the iframe would coexist. Clear it once, right before
    // the iframe is created, so the napplet fully owns the body from here on.
    if (typeof host.textContent !== 'undefined') host.textContent = '';
    try {
      surface = createNappletSurface({
        window, document, container: host, surfaceId: SURFACE_ID,
        handlers, identity: IDENTITY, extraScript: PRODUCT_NAPPLET_EXTRA_SCRIPT,
      });
      if (surface.iframe && typeof surface.iframe.setAttribute === 'function') {
        surface.iframe.setAttribute('style', IFRAME_STYLE);
      }
      if (surface.iframe && typeof surface.iframe.addEventListener === 'function') {
        surface.iframe.addEventListener('load', () => {
          iframeLoaded = true;
          _replayIfPending();
        });
      } else {
        // No load listener available (e.g. a test stub without addEventListener) —
        // assume ready immediately so pushes are never queued forever.
        iframeLoaded = true;
      }
      return true;
    } catch (e) {
      surface = null;
      return false; // any mount failure → legacy fallback
    }
  }

  /** Push a serialized auction snapshot (output of serializeBidList) + relay status. */
  function push(snapshot, status) {
    if (!surface) return;
    const payload = buildSurfaceUpdatePayload(snapshot, status, ++seq);
    if (!iframeLoaded) { pendingPayload = payload; return; } // hold latest; replay on load
    surface.post('world.surface.update', payload);
  }

  function isMounted() { return !!surface; }

  function destroy() {
    if (surface) { try { surface.destroy(); } catch { /* best-effort */ } surface = null; }
    iframeLoaded = false;
    pendingPayload = null;
    seq = 0;
  }

  return { mount, push, isMounted, destroy };
}
