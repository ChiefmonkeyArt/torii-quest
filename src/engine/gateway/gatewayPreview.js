// engine/gateway/gatewayPreview.js — visible-but-inert gateway/NAP-to-NAP
// PREVIEW block (LEAN-2, v0.2.139). Flattens the gatewayPortal VIEW shell into a
// render-ready block of label/value rows that a title-screen or HUD card can draw
// directly — destination, status, relay hint, travel intent, and a URL PREVIEW —
// all framed with an explicit "PREVIEW · SAFE · INERT" badge.
//
// Pure + node-safe: NO Three/Rapier/DOM, NO window/location navigation, NO relay
// I/O, NO signing, NO fetch. This is the presentation layer over gatewayPortal:
// it only re-shapes that shell's pure return value into display strings. Every
// block carries `actionable: false`; crossing the gate / changing location stays
// the host's deferred decision (see GATEWAY_PROTOCOL.md).

import { gatewayPortalView, shortKey } from './gatewayPortal.js';

// Badge shown on every preview block so a viewer can never mistake it for a live,
// clickable travel affordance. The preview describes a hop; it never performs one.
export const GATEWAY_PREVIEW_BADGE = 'PREVIEW · SAFE · INERT';

// Human status text for each portal view status. Unknown statuses fall back to
// the raw value upper-cased so the block never renders blank.
export const GATEWAY_STATUS_TEXT = Object.freeze({
  ready: 'READY',
  invalid: 'INVALID',
  'not-a-gateway': 'NO GATEWAY',
});

// statusText(status) → display label for a portal status. Pure.
export function statusText(status) {
  return GATEWAY_STATUS_TEXT[status] || String(status || 'UNKNOWN').toUpperCase();
}

// previewUrl(url, max) → a length-capped display form of the travel-intent URL.
// Display only — this string is NEVER navigated to. Pure; collapses whitespace,
// safe on null/non-strings (returns '').
export function previewUrl(url, max = 48) {
  const flat = String(url || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

// gatewayPreviewBlock(component, context, { base, prompt, urlMax }) → a
// render-ready, INERT preview block for a gateway/NAP-to-NAP card:
//
//   {
//     title:       'GATEWAY PREVIEW',
//     status:      'ready' | 'invalid' | 'not-a-gateway',
//     statusLabel: 'READY' | 'INVALID' | 'NO GATEWAY',
//     armed:       boolean,             // true only when the travel plan validates
//     destination: string,             // human destination label
//     relay:       string | null,      // discovery hint (display only)
//     intent:      { from, to } | null,// resolved hop, only when armed
//     urlPreview:  string,             // capped display URL, '' unless armed
//     prompt:      string,             // '' unless armed
//     badge:       'PREVIEW · SAFE · INERT',
//     lines:       [{ label, value }], // ready-to-draw rows for a DOM/HUD card
//     actionable:  false,              // ALWAYS false — never a live action
//   }
//
// `context` is the traveller side passed straight through to gatewayPortalView.
// Pure — never throws, never navigates.
export function gatewayPreviewBlock(component, context = {}, { base = '', prompt, urlMax = 48 } = {}) {
  const opts = prompt === undefined ? { base } : { base, prompt };
  const view = gatewayPortalView(component, context, opts);
  const intent = (view.plan && view.plan.intent) || {};
  const label = statusText(view.status);
  const url = view.armed ? previewUrl(view.urlPreview, urlMax) : '';
  const hop = view.armed
    ? { from: intent.from || null, to: intent.to || null }
    : null;

  const lines = [
    { label: 'Destination', value: view.destinationLabel },
    { label: 'Status', value: label },
    { label: 'Relay', value: view.relay ? shortKey(view.relay, 18, 6) : '—' },
    { label: 'Intent', value: hop ? `${hop.from || '—'} → ${hop.to || '—'}` : '—' },
    { label: 'URL', value: url || '—' },
  ];

  return {
    title: 'GATEWAY PREVIEW',
    status: view.status,
    statusLabel: label,
    armed: view.armed,
    destination: view.destinationLabel,
    relay: view.relay || null,
    intent: hop,
    urlPreview: url,
    prompt: view.prompt,
    badge: GATEWAY_PREVIEW_BADGE,
    lines,
    actionable: false, // display-only; crossing the gate stays a host decision
  };
}
