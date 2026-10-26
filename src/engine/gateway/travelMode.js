// engine/gateway/travelMode.js — how 入 travels to a peeked world (ADR-0147 M3.3,
// v0.2.935). PURE + node-safe: no DOM, no navigation, no network.
//
//   enter — the world has a signed, hash-verified Torii world description: Quest
//           builds it in place (no page load; identity and multiplayer carry over).
//   visit — the world publishes no Torii description (another engine), or Quest could
//           not build it here: hand off to its website (Gate v1 §4), only after the
//           player confirms "Leave Torii Quest for <host>?".
//   none  — refuse. A reference that fails its signature or hash check is a forgery
//           or tampering signal: never offered as anything.

import { buildVisitUrl } from './openVisit.js';
import { gateHostLabel } from './gateNapplet.js';
import { isValidZoneSlug } from './zoneRoute.js';

// Resolver outcomes that mean "fine world, just not one we can build here".
const OTHER_ENGINE = new Set(['no-reference']);
const COULD_NOT_BUILD = new Set(['fetch-failed', 'bad-json', 'invalid-world', 'resolve-error', 'enter-failed']);

/** A directory row → { url, host } for a Gate v1 hand-off, or null. */
export function visitPlanFor(row, { ourHex = '', allowPrivate = false } = {}) {
  if (!row || typeof row !== 'object') return null;
  const zoneSlug = row.zoneType === 'nap' && isValidZoneSlug(row.zoneId) ? row.zoneId : null;
  const v = buildVisitUrl(row, { ourHex: /^[0-9a-f]{64}$/.test(ourHex) ? ourHex : '', allowPrivate, zoneSlug });
  if (!v.ok || !v.url) return null;
  const host = gateHostLabel(v.url);
  return host ? { url: v.url, host } : null;
}

/**
 * The resolver's answer for a row → { mode: 'enter' } | { mode: 'visit', url, host, note }
 * | { mode: 'none', reason }.
 */
export function chooseTravelMode(resolved, row, opts = {}) {
  if (resolved && resolved.ok && resolved.world) return { mode: 'enter' };
  const reason = (resolved && typeof resolved.reason === 'string' && resolved.reason) || 'unresolved';
  const note = OTHER_ENGINE.has(reason) ? 'other-engine' : COULD_NOT_BUILD.has(reason) ? 'enter-failed' : '';
  if (!note) return { mode: 'none', reason };
  const plan = visitPlanFor(row, opts);
  return plan ? { mode: 'visit', url: plan.url, host: plan.host, note } : { mode: 'none', reason: `${reason}+no-website` };
}
