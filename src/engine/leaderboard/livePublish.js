// engine/leaderboard/livePublish.js — LIVE leaderboard publish wiring (M2, v0.2.283).
// Promotes the leaderboard relay write from deferred/preview to a REAL NIP-07
// sign + relay fan-out, BUT only ever behind the existing gates: the player's
// explicit consent AND the SEC-1 publishGate verdict `trust: 'crypto-verified'`.
// The actual signing + socket I/O live in src/nostr.js (window.nostr.signEvent +
// fanoutPublish over the configured RELAYS); this module reuses those seams
// rather than inventing a new relay client, and threads them through the same
// createLeaderboardPublisher adapter the SEC-1 gate is wired into. The relay
// write therefore goes THROUGH the gate, never around it.
//
// Node-safe: NO DOM, NO socket, NO key handling here. The signer + publisher +
// gate are INJECTED so the path is unit-testable at the seam (a mocked NIP-07
// signer + relay pool + gate verdict). Default `gate` is verifyPublishGate.
//
//   sign(template)        → { ok, event, error }   (nostr.js signEvent / NIP-07)
//   publish(relays, event) → { accepted, used, failed } (nostr.js fanoutPublish)
//   gate(event, ctx)      → { trusted, trust, errors } (publishGate)

import { createLeaderboardPublisher } from '../nostr/leaderboardPublisher.js';
import { verifyPublishGate } from './publishGate.js';

const HEX64 = /^[0-9a-f]{64}$/;

// buildFinalRunScore(snapshot) → a normalised, validateScore-safe stats object for
// buildScoreEventTemplate. Pure, never throws. Maps a finalised run snapshot
// ({ kills, hits, shots, headshots, score, runId }) into clean non-negative
// integer counters, clamps headshots to kills (the leaderboard invariant), and
// derives accuracy = hits/shots in [0,1]. A missing runId becomes a stable
// time-seeded id so a finalised score is always publishable.
export function buildFinalRunScore(snapshot = {}) {
  const s = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
  const kills = Number.isInteger(s.kills) && s.kills >= 0 ? s.kills : 0;
  let headshots = Number.isInteger(s.headshots) && s.headshots >= 0 ? s.headshots : 0;
  if (headshots > kills) headshots = kills;
  const hits = Number.isInteger(s.hits) && s.hits >= 0 ? s.hits : 0;
  const shots = Number.isInteger(s.shots) && s.shots > 0 ? s.shots : 0;
  let accuracy = shots > 0 ? hits / shots : 0;
  if (!(accuracy >= 0 && accuracy <= 1)) accuracy = 0;
  const score = Number.isInteger(s.score) && s.score >= 0 ? s.score : kills;
  const runId = typeof s.runId === 'string' && s.runId.trim() !== ''
    ? s.runId.trim()
    : 'run-' + Date.now().toString(36);
  return { runId, score, kills, headshots, accuracy };
}

// createLiveLeaderboardPublisher({ sign, publish, relays, gate }) → { publishFinalScore }.
// Wraps the injected nostr.js seams into the shape createLeaderboardPublisher
// expects (sign throws on a NIP-07 failure so the adapter captures it; publish
// throws when NO relay accepts the event so a silent drop becomes a failure the
// UX can show). The SEC-1 gate is always wired — there is no ungated path.
export function createLiveLeaderboardPublisher({ sign, publish, relays = [], gate = verifyPublishGate } = {}) {
  const relayList = Array.isArray(relays) ? relays : (relays ? [relays] : []);

  // NIP-07 signer adapter: nostr.js signEvent returns { ok, event, error }; the
  // publisher wants a thrown error on failure (it captures it into result.errors).
  const _sign = async (template) => {
    const r = await sign(template);
    if (!r || r.ok !== true || !r.event) throw new Error((r && r.error) || 'nip-07-sign-failed');
    return r.event;
  };

  // Relay fan-out adapter. Capture the last fan-out result so publishFinalScore can
  // report which relays accepted (UX). A zero-accept fan-out is a publish FAILURE.
  let _lastFanout = null;
  const _publish = async (event) => {
    const r = await publish(relayList, event);
    _lastFanout = r || null;
    if (!r || !(r.accepted > 0)) {
      const failed = r && Array.isArray(r.failed) && r.failed.length ? ' (' + r.failed.join(', ') + ')' : '';
      throw new Error('no relay accepted the event' + failed);
    }
    return r;
  };

  const base = createLeaderboardPublisher({ sign: _sign, publish: _publish, gate });

  // publishFinalScore(stats, { signerPubkey, consent }) → the publisher result with
  // an extra `relay` field (the fan-out summary, or null on a pre-publish block).
  // Fails closed before any signing when there is no hex64 signer pubkey (login
  // required) — the relay write can only ever attribute to the logged-in player.
  async function publishFinalScore(stats, ctx = {}) {
    const c = ctx && typeof ctx === 'object' && !Array.isArray(ctx) ? ctx : {};
    const signerPubkey = typeof c.signerPubkey === 'string' ? c.signerPubkey.trim().toLowerCase() : '';
    if (!HEX64.test(signerPubkey)) {
      return { ok: false, signed: false, published: false, event: null, relay: null, errors: ['not logged in: a hex64 signer pubkey is required to publish'] };
    }
    _lastFanout = null;
    const res = await base.publishScore(stats, { signerPubkey, consent: c.consent === true });
    res.relay = _lastFanout;
    return res;
  }

  return { publishFinalScore };
}
