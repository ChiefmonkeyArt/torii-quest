// engine/gamestr/gamestrScore.js — PURE gamestr.io kind 30762 score-event builder
// (Phase 0f, v0.2.602-alpha). Shapes an UNSIGNED gamestr.io-format score event so a
// finalised run can appear on gamestr.io leaderboards. This is SEPARATE from the
// in-app NIP-78 leaderboard (kind 30000 via leaderboard/livePublish.js): gamestr is a
// distinct destination (gamestr relays + a few public relays) with its own event
// format, off by default and gated by player consent at the publish site.
//
// Pure + node-safe: NO Nostr client, NO relay I/O, NO signing, NO publishing,
// NO DOM, NO sockets, NO timers (src/engine is NOT on the regression-check
// timer allowlist). This module shapes the *unsigned event template* only —
// the host (with the player's NIP-07 signer) signs and publishes it via the
// injected seams in gamestrPublisher.js, mirroring livePublish.js. Keeping the
// shape pure means it is node-testable and the signing/relay layer can be added
// without touching the schema.
//
// gamestr.io live format (https://gamestr.io/developers): kind 30762, addressable
// replaceable. Tags: d = `<game-id>:<player-pubkey>` (unique), game = game id
// (lowercase hyphenated), score = numeric string, p = player pubkey; optional
// t (genre) + duration. Player-signed: the player's pubkey is both the event
// pubkey (signer) AND the p tag. NOTE: the older NIP-133 spec (kind 33334) is
// superseded by the live kind 30762 service — target 30762 so scores actually
// appear on gamestr.io.

export const GAMESTR_KIND = 30762;
export const GAMESTR_GAME_ID = 'torii-quest';

// GAMESTR_RELAYS — the gamestr relay (authoritative for kind 30762 reads/writes)
// + nos.lol as a write-fanout companion. Frozen so a caller can't mutate the
// publish target at runtime.
//
// v0.2.699-alpha (ADR-0067): trimmed from 5 relays to 2 after empirical testing
// (REQ for kind:30762 + #game:torii-quest, tested from both the sandbox and the
// VPS) showed the other 3 were actively harmful to the leaderboard, not just
// redundant:
//   - wss://relay.nostr.band  → TIMEOUT (~8s, both networks) — relay is down.
//   - wss://relay.damus.io    → 503 Service Unavailable on this exact REQ.
//   - wss://relay.primal.net  → NOTICE "bad req: unindexed tag filter" (rejects #game).
// Only main.relay.gamestr.io returned real leaderboard events (5/5). nos.lol
// accepted the REQ (0 events for this query, since it doesn't index the #game
// tag either) but is kept as a write-fanout target and because it resolved
// instantly rather than erroring. See ADR-0067 for the full test matrix and
// the plan to eventually self-host a strfry relay as the sole authoritative
// leaderboard source.
export const GAMESTR_RELAYS = Object.freeze([
  'wss://main.relay.gamestr.io',
  'wss://nos.lol',
]);

const HEX64 = /^[0-9a-f]{64}$/;

// _nonNegInt(v) → a non-negative integer, else null. Pure.
function _nonNegInt(v) {
  return Number.isInteger(v) && v >= 0 ? v : null;
}

// _finiteNum(v) → a finite number, else null. Pure.
function _finiteNum(v) {
  return Number.isFinite(v) ? v : null;
}

// buildGamestrScoreEvent(stats, { signerPubkey, now }) → { ok, event, errors }.
// Builds an UNSIGNED kind 30762 template (no id/sig; the signer adds those). Pure,
// NEVER throws — every failure is captured into `errors` with ok:false + event:null
// so a bad input can never propagate a malformed event to a relay.
//
//   stats:        { score, kills, duration? }  (score defaults to kills when invalid)
//   signerPubkey: hex64 player pubkey (the signer AND the p tag)
//   now:          epoch ms used for created_at (defaults to Date.now())
//
// Validation (fail-closed, never throws):
//   - signerPubkey MUST be hex64, else ok:false (login required — the score can
//     only ever attribute to the logged-in player).
//   - score MUST be a non-negative integer; when it isn't, it falls back to
//     `kills` (mirroring buildFinalRunScore's score-defaults-to-kills invariant),
//     and `kills` itself defaults to 0 when invalid. A recovered score is NOT an
//     error — the run is still publishable; only a missing signer blocks.
export function buildGamestrScoreEvent(stats = {}, opts = {}) {
  const errors = [];
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};

  // Signer pubkey: hex64, lowercased. A missing/invalid signer is a hard block —
  // never build an event that can't be attributed to the player.
  const signerPubkey = typeof o.signerPubkey === 'string'
    ? o.signerPubkey.trim().toLowerCase()
    : '';
  if (!HEX64.test(signerPubkey)) {
    return {
      ok: false,
      event: null,
      errors: ['not logged in: a hex64 signer pubkey is required to build a gamestr score event'],
    };
  }

  const s = stats && typeof stats === 'object' && !Array.isArray(stats) ? stats : {};

  // kills defaults to 0 when invalid; score defaults to kills when invalid (the
  // leaderboard invariant: a run with no explicit score is ranked by kills).
  const kills = _nonNegInt(s.kills) ?? 0;
  const score = _nonNegInt(s.score) ?? kills;

  // created_at: floor(now/1000). `now` is epoch ms; default to Date.now() when
  // the caller omits it (Date.now() is node-safe — not a socket/timer/DOM seam).
  const nowMs = _finiteNum(o.now) ?? Date.now();
  const createdAt = Math.floor(nowMs / 1000);

  // Tags: d (unique per player+game), game, score, p (player = signer), genre
  // tags (arcade + shooter — torii-quest is an arcade shooter), and duration
  // when a finite value is supplied.
  const tags = [
    ['d', `${GAMESTR_GAME_ID}:${signerPubkey}`],
    ['game', GAMESTR_GAME_ID],
    ['score', String(score)],
    ['p', signerPubkey],
    ['t', 'arcade'],
    ['t', 'shooter'],
  ];
  const durationSec = _finiteNum(s.duration);
  if (durationSec !== null) {
    tags.push(['duration', String(durationSec)]);
  }

  // content: a short text message (gamestr.io uses a text message alongside the
  // structured score tag).
  const content = `Torii Quest score: ${score}`;

  return {
    ok: true,
    event: {
      kind: GAMESTR_KIND,
      pubkey: signerPubkey,
      created_at: createdAt,
      content,
      tags,
    },
    errors,
  };
}
