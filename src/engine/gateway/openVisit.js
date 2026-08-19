// engine/gateway/openVisit.js — the OPEN-VISIT travel path (Phase 0,
// open-world foundation). A pure leaf that turns a world's https `website` into a
// hardened, traveller-tagged visit URL — the unsigned, direct-navigate n2n hop.
//
// This replaces the signed-handshake hop as the DEFAULT travel mode: instead of
// a SEC-2 signed request/response round-trip per jump, the player simply visits
// the destination world's website, with the URL hardened (SEC-3) and their pubkey
// appended as a `?torii-traveller=` param so the host can identify the arrival.
// The signed-handshake code (handshakeController / travelRequest) stays in place
// but UNUSED — reserved for an optional future "private/invite-only travel mode".
//
// PURE + node-safe: NO DOM, NO window/location, NO browser navigation, NO relay
// I/O, NO signing. It composes two existing pure leaves — hardenSpawnUrl (SEC-3
// scheme/host hardening) + appendTraveller (hex64 pubkey tag) — into one
// data-only step. The host (main.js) performs the actual navigation, and ONLY
// when buildVisitUrl returns ok:true. Uses only plain JS + the WHATWG URL global
// (node 18+ + browsers), so it is importable in vitest's node env.
//
// Constrained by construction: buildVisitUrl(world, { ourHex, allowPrivate, zoneSlug })
// → { ok, url, errors }. Never throws. A failure never yields a url. The caller
// treats !ok as "do not visit" and surfaces the error. When `zoneSlug` is a
// valid zone slug (isValidZoneSlug), the canonical NAP-zone hash route
// `#/zone/<slug>` is appended to the hardened URL so the destination's
// parseZoneRoute resolves the NAP zone the traveller lands in.

import { hardenSpawnUrl, appendTraveller } from './urlHarden.js';
import { isValidZoneSlug } from './zoneRoute.js';

// buildVisitUrl(world, { ourHex, allowPrivate, zoneSlug }) → { ok, url, errors }.
//   world        — a gateway preview object carrying `.website` (an https URL, as
//                 surfaced by gatewayRead.extractGatewayFromEvent via
//                 safeProfileUrl). Non-https / blank → ok:false.
//   ourHex       — optional; the traveller's hex64 pubkey. If present, it is
//                 appended as ?torii-traveller=<hex64>. If absent/blank, the
//                 visit URL is still returned (anonymous hop).
//   allowPrivate — boolean; passed through to hardenSpawnUrl so a dev/staging
//                 host (localhost / *.chiefmonkey.art) can visit private-range worlds.
//                 Default false (production-safe: private hosts rejected).
//   zoneSlug     — optional; a valid zone slug (isValidZoneSlug). When valid,
//                 the canonical hash route `#/zone/<slug>` is appended AFTER
//                 hardening + traveller append, so the destination's
//                 parseZoneRoute resolves the NAP zone. An invalid/absent slug
//                 leaves the URL unchanged (ok:true still). Never throws.
export function buildVisitUrl(world, { ourHex = '', allowPrivate = false, zoneSlug = null } = {}) {
  const errors = [];
  const out = { ok: false, url: null, errors };
  if (!world || typeof world !== 'object') {
    errors.push('world-required');
    return out;
  }
  const raw = typeof world.website === 'string' ? world.website.trim() : '';
  if (raw === '') {
    errors.push('world-website-required');
    return out;
  }
  // SEC-3: harden the spawn URL (https-only, reject private/loopback unless
  // allowPrivate, reject credentials, reject non-default ports).
  const hardened = hardenSpawnUrl(raw, { allowPrivate });
  if (!hardened.ok) {
    errors.push(...(hardened.errors || ['harden-failed']));
    return out;
  }
  // Append the traveller pubkey if provided (anonymous hop without it is fine).
  if (ourHex) {
    const tagged = appendTraveller(hardened.url, ourHex);
    if (!tagged.ok) {
      errors.push(tagged.error || 'traveller-append-failed');
      return out;
    }
    out.url = tagged.url;
  } else {
    out.url = hardened.url;
  }
  // NAP-zone routing (Phase 0c): when a valid zoneSlug is provided, append the
  // canonical hash route `#/zone/<slug>` so the destination's parseZoneRoute
  // resolves the NAP zone and the traveller lands there. The hash fragment is
  // never sent to the server, so the destination's root shell still serves.
  // An invalid/absent slug leaves the URL unchanged (ok:true still). Never
  // throws — a malformed URL here is unreachable (it just passed hardenSpawnUrl).
  if (isValidZoneSlug(zoneSlug)) {
    try {
      const u = new URL(out.url);
      u.hash = `/zone/${zoneSlug}`;
      out.url = u.href;
    } catch {
      /* unreachable: out.url already hardened — keep the pre-hash URL */
    }
  }
  out.ok = true;
  return out;
}
