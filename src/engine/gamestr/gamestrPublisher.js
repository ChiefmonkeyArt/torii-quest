// engine/gamestr/gamestrPublisher.js — gamestr.io LIVE score publish wiring
// (Phase 0f, v0.2.601-alpha). Promotes the kind 30762 score write to a REAL NIP-07
// sign + relay fan-out, BUT only ever behind the existing gates: the player's
// explicit consent AND the operator's GAMESTR_ENABLED opt-in (off by default).
//
// This is SEPARATE from the in-app NIP-78 leaderboard (kind 30000 via
// leaderboard/livePublish.js): gamestr is a distinct destination (gamestr relay +
// a few public relays) with its own event format + toggle. The actual signing +
// socket I/O live in src/nostr.js (window.nostr.signEvent + fanoutPublish over
// GAMESTR_RELAYS); this module reuses those seams rather than inventing a new
// relay client, mirroring livePublish.js's shape so the caller can report relay
// results. A gamestr failure must NEVER block the in-app leaderboard publish —
// the caller invokes this best-effort, after (or regardless of) the in-app write.
//
// Node-safe: NO DOM, NO socket, NO key handling, NO setTimeout here. The signer +
// publisher are INJECTED so the path is unit-testable at the seam (a mocked NIP-07
// signer + relay pool). Never throws into the game loop — every failure is
// captured into the structured result.
//
//   sign(template)         → { ok, event, error }   (nostr.js signEvent / NIP-07)
//   publish(relays, event) → { accepted, used, failed } (nostr.js fanoutPublish)

import { buildGamestrScoreEvent, GAMESTR_RELAYS } from './gamestrScore.js';

const HEX64 = /^[0-9a-f]{64}$/;

// createGamestrPublisher({ sign, publish, relays }) → { publishGameScore }.
// Wraps the injected nostr.js seams into a sign+publish path for the kind 30762
// gamestr score. `sign` is the nostr.js signEvent ({ ok, event, error }) shape;
// `publish` is the nostr.js fanoutPublish ({ accepted, used, failed }) shape.
// `relays` defaults to GAMESTR_RELAYS (frozen in gamestrScore.js).
//
// Mirrors createLiveLeaderboardPublisher's shape so the caller can report relay
// results, but WITHOUT a SEC-1 publishGate — gamestr.io is a third-party service
// with its own (player-signed) attribution model; the consent + opt-in gates are
// the boundary here (the player's pubkey is both the signer AND the p tag, so the
// score can only ever attribute to the consenting player).
export function createGamestrPublisher({ sign, publish, relays = GAMESTR_RELAYS } = {}) {
  const relayList = Array.isArray(relays) ? relays : (relays ? [relays] : []);
  const _sign = typeof sign === 'function' ? sign : null;
  const _publish = typeof publish === 'function' ? publish : null;

  // publishGameScore(stats, { signerPubkey, consent }) →
  //   { ok, signed, published, event, relay, errors }.
  //
  // Fails closed BEFORE any signing when:
  //   - no hex64 signer pubkey (login required), or
  //   - consent !== true (the explicit "PUBLISH MY SCORE" action).
  // A zero-accept fan-out is a publish FAILURE (ok:false) but does not throw.
  // A sign or publish throw is caught and captured into errors (never into the
  // game loop). `relay` carries the fan-out summary (or null on a pre-publish
  // block) so the caller can report which relays accepted.
  async function publishGameScore(stats, ctx = {}) {
    const c = ctx && typeof ctx === 'object' && !Array.isArray(ctx) ? ctx : {};
    const signerPubkey = typeof c.signerPubkey === 'string'
      ? c.signerPubkey.trim().toLowerCase()
      : '';

    const result = { ok: false, signed: false, published: false, event: null, relay: null, errors: [] };

    // Fail closed before signing: no hex64 signer → the score can only ever
    // attribute to the logged-in player.
    if (!HEX64.test(signerPubkey)) {
      result.errors.push('not logged in: a hex64 signer pubkey is required to publish a gamestr score');
      return result;
    }
    // Fail closed before signing: no explicit consent → never publish silently.
    // The consent is the player's explicit "PUBLISH MY SCORE" action (first
    // publish = NIP-07 signer prompt; the wallet may auto-allow thereafter).
    if (c.consent !== true) {
      result.errors.push('consent required: gamestr publish is gated by the explicit PUBLISH MY SCORE action');
      return result;
    }
    if (_sign === null) {
      result.errors.push('no signer wired (build-only path)');
      return result;
    }

    // Build the unsigned kind 30762 template (pure, never throws).
    const built = buildGamestrScoreEvent(stats, { signerPubkey, now: Date.now() });
    if (!built.ok || !built.event) {
      result.errors.push(...(built.errors.length ? built.errors : ['gamestr event build failed']));
      return result;
    }
    const template = built.event;

    // Sign via the injected NIP-07 seam. nostr.js signEvent returns { ok, event,
    // error }; a failure (extension rejection / unavailable) is captured, not
    // thrown. Never throws into the game loop.
    let signedEvent = null;
    try {
      const r = await _sign(template);
      if (!r || r.ok !== true || !r.event) {
        result.errors.push('sign failed: ' + ((r && r.error) || 'nip-07-sign-failed'));
        return result;
      }
      signedEvent = r.event;
      result.signed = true;
      result.event = signedEvent;
    } catch (e) {
      result.errors.push('sign failed: ' + (e?.message || String(e)));
      return result;
    }

    if (_publish === null) {
      // Signed but not shipped (build-only caller wired a signer but no pool).
      result.ok = true;
      return result;
    }

    // Fan-out publish via the injected relay pool. Capture the fan-out result so
    // the caller can report which relays accepted. A zero-accept fan-out is a
    // publish FAILURE (ok:false) but does not throw.
    let fanout = null;
    try {
      fanout = await _publish(relayList, signedEvent);
      result.relay = fanout || null;
      if (!fanout || !(fanout.accepted > 0)) {
        const failed = fanout && Array.isArray(fanout.failed) && fanout.failed.length
          ? ' (' + fanout.failed.join(', ') + ')'
          : '';
        result.errors.push('no relay accepted the gamestr event' + failed);
        return result;
      }
      result.published = true;
      result.ok = true;
    } catch (e) {
      result.relay = fanout;
      result.errors.push('publish failed: ' + (e?.message || String(e)));
    }
    return result;
  }

  return { publishGameScore };
}
