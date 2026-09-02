// engine/napplets/worldNappletHandlers.js — the nap-torii-world v0 message handlers
// for the Torii Quest shell (ADR-0057). MOSTLY PURE + node-safe: no DOM, no Three,
// no network, no signing, no wallet, no travel navigation, no payment execution.
//
// Implements ONLY the v0 world surface subset:
//   world.attach.get — "where am I mounted?"
//   world.zone.list  — "what surfaces exist in my zone?"
//   world.emit       — shell-mediated action request (allow-listed, fire-and-forget)
// Deferred to later ADRs (return an "unsupported" error so a napplet degrades):
//   world.pose.subscribe / world.pose.unsubscribe
//   world.visit
//
// The dispatcher returns the outbound envelope to post back to the napplet, or null
// if the message is unknown (silently ignored — forward-compat per NIP-5D). Identity
// binding (MessageEvent.source ↔ (dTag, aggregateHash)) is NappletSurface's job, not
// the handlers'; the handlers only reason about the bound surfaceId.

import { splitType, resultEnvelope, errorEnvelope, WORLD_NAMESPACE } from './nappletEnvelope.js';

// createWorldHandlers({ worldNpub, worldLabel, getSurfaceConfig, listSurfaces })
//   → { dispatch(fullType, data, surfaceId, id) } returns outbound envelope | null.
export function createWorldHandlers({
  worldNpub,
  worldLabel,
  getSurfaceConfig,
  listSurfaces,
}) {
  function dispatch(fullType, data, surfaceId, id) {
    const parts = splitType(fullType);
    if (!parts || parts.ns !== WORLD_NAMESPACE) return null; // not our namespace
    const type = fullType; // e.g. "world.attach.get"
    const action = parts.action;

    if (action === 'attach.get') {
      const cfg = getSurfaceConfig(surfaceId);
      if (!cfg) return errorEnvelope(type, id, 'unknown-surface', 'no surface config for this id');
      return resultEnvelope(type, id, {
        worldNpub,
        worldLabel,
        zoneId: cfg.zoneId,
        surfaceId: cfg.surfaceId,
        surfaceKind: cfg.surfaceKind,
        surfaceTransform: cfg.surfaceTransform,
      });
    }

    if (action === 'zone.list') {
      const cfg = getSurfaceConfig(surfaceId);
      const zoneId = cfg ? cfg.zoneId : 'nap';
      const surfaces = (listSurfaces(zoneId) || []).map((c) => ({
        surfaceId: c.surfaceId,
        surfaceKind: c.surfaceKind,
        position: c.surfaceTransform.position,
      }));
      return resultEnvelope(type, id, { zoneId, surfaces });
    }

    if (action === 'emit') {
      const cfg = getSurfaceConfig(surfaceId);
      if (!cfg) return errorEnvelope(type, id, 'unknown-surface', 'no surface config');
      const kind = typeof data?.kind === 'string' ? data.kind : '';
      if (!kind) return resultEnvelope(type, id, { accepted: false, reason: 'unsupported-kind' });
      if (!cfg.allowedEmitKinds.includes(kind)) {
        return resultEnvelope(type, id, { accepted: false, reason: 'wrong-surface' });
      }
      // ADR-0058: no real emit handlers are wired yet (purchase / sticker-place /
      // leaderboard-submit / npc-say land in later ADRs). Be honest — refuse rather
      // than pretending a no-op succeeded. When a real handler exists, it returns
      // { accepted: true, actionId } here.
      return resultEnvelope(type, id, { accepted: false, reason: 'no-handler' });
    }

    if (action === 'pose.subscribe' || action === 'pose.unsubscribe' || action === 'visit') {
      return errorEnvelope(type, id, 'unsupported', `${action} is not implemented in v0`);
    }

    // Unknown action — silently ignore (forward-compat per NIP-5D).
    return null;
  }

  return { dispatch };
}
