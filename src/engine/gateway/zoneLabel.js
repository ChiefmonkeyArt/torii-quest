// engine/gateway/zoneLabel.js — PURE display-label helpers for the GATEWAY portal
// prompt + zone notice (GATEWAY / NAP-zone handoff, v0.2.184, LEAN-2 continuation).
// They turn a same-origin zone slug / `/zone/<slug>` route / title into the short,
// inert strings the HUD shows via `textContent` ONLY, so the player can read which
// travel point they are approaching and which zone they just entered.
//
// This slice is PURE POLISH: it changes NO navigation safety. Proximity still only
// ARMS (v0.2.181), KeyF still CONFIRMS, and the route stays same-origin `/zone/`
// only. These helpers build strings; they never navigate, fetch, sign, or publish.
//
// Constrained by construction:
//   - PURE + node-safe: no THREE/Rapier/DOM/window/location/fs/network. Builds plain
//     strings; never throws; exposes NO navigate/open/reload/goto method.
//   - SAFE TEXT: a derived label is Title-Case ALPHANUMERIC + spaces + single hyphens
//     only (the same shape `humanizeZoneSlug` yields). A free-form title is sanitised
//     to that same safe set, so a label can never carry markup, a `javascript:`/`data:`
//     scheme, or any dangerous token — even though the HUD sink is `textContent`.

import { isValidZoneSlug, humanizeZoneSlug, ZONE_ROUTE_PREFIX } from './zoneRoute.js';

// ZONE_LABEL_VERSION — bumped when the label contract changes.
export const ZONE_LABEL_VERSION = 1;

// Badge for the debug report: a display label, inert + same-origin.
export const ZONE_LABEL_BADGE = 'ZONE LABEL · DISPLAY-ONLY · INERT';

// Default interact key named in the prompt (the host binds KeyF).
export const DEFAULT_PORTAL_KEY = 'F';

// Default notice prefix for a freshly-entered zone.
export const DEFAULT_ENTERED_PREFIX = 'Entered';

// Max label length (well under any line) — keeps the HUD tidy and bounds input.
const LABEL_MAX_LEN = 80;

// _safeTitle(s) → a label limited to letters/digits/space/hyphen, whitespace
// collapsed, trimmed, length-capped. Anything else (markup, punctuation, scheme
// chars, control chars) is replaced with a space, so the result can never carry a
// dangerous token. Pure.
function _safeTitle(s) {
  if (typeof s !== 'string' || s === '') return '';
  return s.replace(/[^A-Za-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX_LEN);
}

// _titleFrom(input) → a safe Title-Case label from a zone slug, a `/zone/<slug>`
// route, or a pre-humanised title string; '' when nothing usable. A valid slug/route
// is resolved via `humanizeZoneSlug` (alnum by construction); a free title is run
// through `_safeTitle`. Pure, never throws.
function _titleFrom(input) {
  if (typeof input !== 'string' || input === '') return '';
  let slug = input;
  if (slug.startsWith(ZONE_ROUTE_PREFIX)) slug = slug.slice(ZONE_ROUTE_PREFIX.length);
  if (isValidZoneSlug(slug)) return humanizeZoneSlug(slug);
  return _safeTitle(input);
}

// portalPromptLabel(opts?) → the in-range portal prompt that NAMES the target zone,
// e.g. "Press F to travel to Plebeian Market Bazaar". Falls back to the generic
// "Press F to travel" when no valid zone label is available. Pure, never throws.
//
//   opts { slug?, route?, title?, key? }  — first of slug/route/title that resolves
//                                           to a label wins; key defaults to 'F'.
export function portalPromptLabel(opts = {}) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const key = typeof o.key === 'string' && o.key ? _safeTitle(o.key) || DEFAULT_PORTAL_KEY : DEFAULT_PORTAL_KEY;
  const base = `Press ${key} to travel`;
  const title = _titleFrom(o.slug || o.route || o.title || '');
  return title ? `${base} to ${title}` : base;
}

// enteredZoneLabel(input, opts?) → a concise inert notice for a zone the player just
// entered, e.g. "Entered: Plebeian Market Bazaar". Returns '' when no valid zone
// label can be derived. Pure, never throws.
//
//   input: slug | `/zone/<slug>` route | title
//   opts { prefix? }  — label prefix, default "Entered" (e.g. "Zone").
export function enteredZoneLabel(input, opts = {}) {
  const title = _titleFrom(input);
  if (!title) return '';
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const prefix = typeof o.prefix === 'string' && o.prefix ? _safeTitle(o.prefix) || DEFAULT_ENTERED_PREFIX : DEFAULT_ENTERED_PREFIX;
  return `${prefix}: ${title}`;
}

// DEMO_ZONE_LABEL_OPTS — deterministic sample for the debug shell ONLY (mirrors the
// live v0.2.181 trigger target). Not used by gameplay.
export const DEMO_ZONE_LABEL_OPTS = Object.freeze({ slug: 'plebeian-market-bazaar', key: 'F' });
