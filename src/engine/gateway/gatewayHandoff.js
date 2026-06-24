// engine/gateway/gatewayHandoff.js — gateway portal/handoff shell (CMP-8
// continuation, v0.2.135). Bridges a gateway COMPONENT (its manifest's gateway
// block) to a travel INTENT (GWPROTO-1), so "the player crossed this gate" can be
// turned into a validated, serialisable hop request.
//
// Pure + node-safe: NO Three/Rapier/DOM, NO window/location navigation, NO relay
// I/O, NO signing. Everything here is a RETURN VALUE — planGatewayTravel yields a
// { valid, errors, intent } and gatewayTravelUrl yields a { valid, errors, url }
// STRING. The host decides whether to act on it (actually move the player /
// change the URL); this module never has a side effect. "Component is code,
// protocol is agreement" — the gate is the code, the travel intent is the wire.

import { buildTravelIntent, validateTravelIntent, buildTravelUrl } from './travelIntent.js';

// gatewayDestination(component) → the gateway manifest's destination block
// ({ npub, relay, target, position }) or null if this isn't a gateway component.
export function gatewayDestination(component) {
  const m = component && component.manifest;
  if (!m || m.kind !== 'gateway' || !m.gateway || typeof m.gateway !== 'object') return null;
  return m.gateway;
}

// planGatewayTravel(component, context) → { valid, errors, intent }. Maps a
// gateway's destination onto the travel-intent fields and validates the result.
//
//   gateway.target → intent.to   (the destination world/zone; falls back to the
//                                  destination npub when no explicit target id)
//   gateway.relay  → intent.relays[0]   (discovery hint for the destination)
//
// `context` supplies the TRAVELLER's side of the hop (all optional except that a
// destination must resolve): { from, player, spawn, return, zoneType, state }.
// Pure — never throws, never navigates.
export function planGatewayTravel(component, context = {}) {
  const dest = gatewayDestination(component);
  if (!dest) {
    return { valid: false, errors: ['component is not a gateway (no manifest.gateway)'], intent: {} };
  }
  const to = dest.target || dest.npub || null;
  const relays = dest.relay ? [dest.relay] : undefined;

  const intent = buildTravelIntent({
    to,
    from: context.from,
    player: context.player,
    spawn: context.spawn,
    return: context.return,
    zoneType: context.zoneType,
    state: context.state,
    relays,
  });
  const { valid, errors } = validateTravelIntent(intent);
  return { valid, errors, intent };
}

// gatewayTravelUrl(component, context, { base }) → { valid, errors, url }. Plans
// the hop then serialises a valid intent to a query string (no base ⇒ just
// `?to=…`; with a base ⇒ `${base}?…`). On an invalid plan, url is '' and the
// errors are passed through. NO browser navigation — this returns a string.
export function gatewayTravelUrl(component, context = {}, { base = '' } = {}) {
  const { valid, errors, intent } = planGatewayTravel(component, context);
  if (!valid) return { valid: false, errors, url: '' };
  return { valid: true, errors: [], url: buildTravelUrl(intent, { base }) };
}
