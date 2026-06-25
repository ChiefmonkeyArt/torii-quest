// engine/nostr/readHealth.js — READ-ONLY Nostr read-path HEALTH model (NOSTR-READ
// continuation, v0.2.194). Folds the shipped read-path proofs (relayRead,
// profileRead, leaderboardRelayRead) and the consent gate into ONE read-only
// health report that an operator / dashboard / AI handoff can inspect to confirm,
// at a glance, that the Nostr surface is still READ-ONLY at the MVP stage and that
// every live-write path stays gated behind explicit consent (SEC-1).
//
// Pure + node-safe: NO Nostr client, NO WebSocket, NO relay I/O, NO signing, NO
// publishing, NO NIP-07, NO key handling, NO DOM, NO network, NO auto-connect.
// This module NEVER opens a socket and exposes NO publish/sign/send/connect
// surface. It only EXERCISES the already-pure read helpers over deterministic
// LOCAL sample events (the shape a host's read-only transport WOULD return) and
// reads the consent registry — so importing or running it can never touch the wire.
// Every signal degrades safely on malformed input and never throws on event data;
// every report pins signed:false / published:false / readOnly:true.

import { RELAY_READ_VERBS, createReadOnlyRelayAdapter } from './relayRead.js';
import { readProfiles } from './profileRead.js';
import { readLeaderboardEvents } from './leaderboardRelayRead.js';
import { CONSENT_ACTIONS, evaluateConsent } from '../consent/consentGate.js';

// Badge shown on the report — states the read-only guarantee up front.
export const READ_HEALTH_BADGE = 'NOSTR READ-PATH · READ-ONLY · NO WRITE/SIGN/PUBLISH';

// The NIP-01 publish verb. Its DELIBERATE ABSENCE from RELAY_READ_VERBS is the
// core read-only invariant of the relay adapter — surfaced as its own signal.
export const PUBLISH_VERB = 'EVENT';

// The future-gated security tiers. SEC-1 is the NIP-07 signer + relay publish
// write path that will consume consent decisions; SEC-2/SEC-3 follow. They remain
// DEFERRED at the MVP stage — this model asserts the write path is still gated.
export const FUTURE_GATED_TIERS = Object.freeze(['SEC-1', 'SEC-2', 'SEC-3']);

// A deterministic LOCAL sample kind:0 profile event — the shape a read-only
// transport WOULD return — so the profile read-path signal can prove the kind:0
// READ path without ever touching a relay. Display-only; no network/sign/publish.
export const SAMPLE_PROFILE_EVENTS = Object.freeze([
  {
    id: '1'.repeat(64), pubkey: 'a'.repeat(64), created_at: 2000, kind: 0,
    tags: [],
    content: JSON.stringify({ name: 'nostrich', display_name: 'Nostrich', about: 'freedom tech' }),
    sig: 'f'.repeat(128),
  },
]);

// A deterministic LOCAL sample kind-30000 leaderboard score event — the shape a
// read-only transport WOULD return — so the leaderboard read-path signal can prove
// the READ→rank path without ever touching a relay. Display-only; no network.
export const SAMPLE_SCORE_EVENTS = Object.freeze([
  {
    id: '2'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1500, kind: 30000,
    tags: [['d', 'run-x'], ['t', 'torii-quest']],
    content: JSON.stringify({ runId: 'run-x', score: 240, kills: 20, headshots: 11, accuracy: 0.71, version: 'v0.2.194-alpha' }),
    sig: 'e'.repeat(128),
  },
]);

function _signal(id, label, status, detail, extra = {}) {
  return { id, label, status, detail, ...extra };
}

// checkRelayReadModel() → the relay-read FOUNDATION signal. Verifies the injected-
// transport adapter is read-only BY CONSTRUCTION: it exposes a `read` method and
// `readOnly:true`, and exposes NO publish/sign/send/connect/close method that could
// touch the wire. The adapter is built WITHOUT a transport (no request injected) so
// nothing can fetch. Pure; never opens a socket.
export function checkRelayReadModel() {
  const adapter = createReadOnlyRelayAdapter();
  const hasRead = typeof adapter.read === 'function';
  const readOnly = adapter.readOnly === true;
  const writeMethods = ['publish', 'sign', 'send', 'connect', 'close', 'write'];
  const exposed = writeMethods.filter((m) => typeof adapter[m] === 'function');
  if (!hasRead || !readOnly || exposed.length > 0) {
    return _signal('relay-read-model', 'relay read model present', 'fail',
      exposed.length > 0
        ? `relay adapter exposes write surface: ${exposed.join(', ')}`
        : 'relay adapter is not a read-only { read } surface',
      { exposedWriteMethods: exposed });
  }
  return _signal('relay-read-model', 'relay read model present', 'ok',
    'read-only adapter exposes read() only; no publish/sign/send/connect/close',
    { exposedWriteMethods: [] });
}

// checkNoPublishVerb() → the no-EVENT-frame signal. The relay read verbs are exactly
// REQ + CLOSE (open + tear down a subscription); the EVENT publish verb is
// DELIBERATELY ABSENT, so the read foundation can never construct a write frame.
export function checkNoPublishVerb() {
  const verbs = Array.isArray(RELAY_READ_VERBS) ? RELAY_READ_VERBS : [];
  const hasPublish = verbs.includes(PUBLISH_VERB);
  const expected = verbs.length === 2 && verbs.includes('REQ') && verbs.includes('CLOSE');
  if (hasPublish || !expected) {
    return _signal('no-publish-verb', `no ${PUBLISH_VERB} publish verb in relay read path`, 'fail',
      hasPublish
        ? `relay read verbs include the ${PUBLISH_VERB} publish verb`
        : `relay read verbs are not the expected REQ/CLOSE pair: [${verbs.join(', ')}]`,
      { verbs });
  }
  return _signal('no-publish-verb', `no ${PUBLISH_VERB} publish verb in relay read path`, 'ok',
    `read verbs are [${verbs.join(', ')}] — no ${PUBLISH_VERB} publish frame`,
    { verbs });
}

// checkProfileReadPath(events) → the kind:0 profile read-path signal. Exercises
// readProfiles over a deterministic LOCAL sample and confirms it returns a usable,
// read-only report (ok, at least one profile, signed:false/published:false/
// readOnly:true). FAILs if the path is broken or any write flag is set.
export function checkProfileReadPath(events = SAMPLE_PROFILE_EVENTS) {
  const r = readProfiles(events);
  const inert = r.signed === false && r.published === false && r.readOnly === true;
  if (!r.ok || r.count < 1 || !inert) {
    return _signal('profile-read-path', 'profile read path present', 'fail',
      !inert ? 'profile read report is not read-only (signed/published/readOnly mismatch)'
        : 'profile read path returned no usable profile',
      { count: r.count, signed: r.signed, published: r.published, readOnly: r.readOnly });
  }
  return _signal('profile-read-path', 'profile read path present', 'ok',
    `kind:0 READ→sanitise proven (${r.count} profile); signed:false published:false`,
    { count: r.count, signed: r.signed, published: r.published, readOnly: r.readOnly });
}

// checkLeaderboardReadPath(events) → the kind-30000 leaderboard read-path signal.
// Exercises readLeaderboardEvents over a deterministic LOCAL sample and confirms it
// returns a usable, read-only ranked report (ok, at least one row, signed:false/
// published:false/readOnly:true). FAILs if the path is broken or any write flag set.
export function checkLeaderboardReadPath(events = SAMPLE_SCORE_EVENTS) {
  const r = readLeaderboardEvents(events);
  const inert = r.signed === false && r.published === false && r.readOnly === true;
  if (!r.ok || r.count < 1 || !inert) {
    return _signal('leaderboard-read-path', 'leaderboard read path present', 'fail',
      !inert ? 'leaderboard read report is not read-only (signed/published/readOnly mismatch)'
        : 'leaderboard read path returned no usable row',
      { count: r.count, signed: r.signed, published: r.published, readOnly: r.readOnly });
  }
  return _signal('leaderboard-read-path', 'leaderboard read path present', 'ok',
    `kind-30000 READ→rank proven (${r.count} row); signed:false published:false`,
    { count: r.count, signed: r.signed, published: r.published, readOnly: r.readOnly });
}

// checkWritePathsGated() → the consent-gate signal. Walks the known-action registry
// and confirms the gate's two tiers behave: every READ action is allowed with NO
// grant, and every WRITE/sign/publish/update/travel action is BLOCKED with no grant.
// A single read blocked or write allowed-by-default FAILs the signal. Pure + inert —
// the gate never acts; these are decisions only.
export function checkWritePathsGated() {
  const ids = Object.keys(CONSENT_ACTIONS);
  const readIds = ids.filter((id) => !CONSENT_ACTIONS[id].requiresConsent);
  const writeIds = ids.filter((id) => CONSENT_ACTIONS[id].requiresConsent);

  const readBlocked = readIds.filter((id) => evaluateConsent(id, null).blocked === true);
  const writeAllowed = writeIds.filter((id) => evaluateConsent(id, null).allowed === true);

  if (readBlocked.length > 0 || writeAllowed.length > 0) {
    return _signal('write-paths-gated', 'write paths disabled / consent gated', 'fail',
      writeAllowed.length > 0
        ? `write action(s) allowed without a grant: ${writeAllowed.join(', ')}`
        : `read action(s) wrongly blocked: ${readBlocked.join(', ')}`,
      { readActions: readIds.length, writeActions: writeIds.length, writeAllowedByDefault: writeAllowed });
  }
  return _signal('write-paths-gated', 'write paths disabled / consent gated', 'ok',
    `${readIds.length} read action(s) allowed; ${writeIds.length} write action(s) blocked without explicit consent`,
    { readActions: readIds.length, writeActions: writeIds.length, writeAllowedByDefault: [] });
}

// checkFutureGatedTiers() → the SEC-tier signal. The live-write path (NIP-07 signer +
// relay publish, SEC-1) and its follow-ups (SEC-2/SEC-3) are DEFERRED at the MVP
// stage. This signal confirms the write actions that the SEC-1 path would consume
// exist in the registry and still require consent — i.e. the gate is in place AHEAD
// of the deferred write tier, so promoting SEC-1 is a conscious future step. The
// signed/publish tier actions back this assertion with live registry data.
export function checkFutureGatedTiers() {
  const signedWriteIds = Object.keys(CONSENT_ACTIONS)
    .filter((id) => CONSENT_ACTIONS[id].signed === true && CONSENT_ACTIONS[id].requiresConsent === true);
  // Every signed write action must be blocked without a grant for the SEC-1 tier to
  // be genuinely future-gated rather than already open.
  const open = signedWriteIds.filter((id) => evaluateConsent(id, null).allowed === true);
  if (signedWriteIds.length === 0 || open.length > 0) {
    return _signal('future-gated-tiers', `${FUTURE_GATED_TIERS.join(' / ')} still future-gated`, 'fail',
      open.length > 0
        ? `signed write action(s) open without a grant: ${open.join(', ')}`
        : 'no signed write action present to gate (SEC-1 anchor missing)',
      { tiers: FUTURE_GATED_TIERS, signedWriteActions: signedWriteIds });
  }
  return _signal('future-gated-tiers', `${FUTURE_GATED_TIERS.join(' / ')} still future-gated`, 'ok',
    `SEC-1 signer/publish write path deferred; ${signedWriteIds.length} signed write action(s) gated`,
    { tiers: FUTURE_GATED_TIERS, signedWriteActions: signedWriteIds });
}

// runReadHealth({ profileEvents, scoreEvents }) → the folded read-only Nostr
// read-path health report:
//
//   {
//     ok:        boolean,            // true iff NO signal FAILED
//     badge:     READ_HEALTH_BADGE,
//     signals:   [{ id, label, status, detail, ... }],
//     summary:   { total, ok, fail },
//     readOnly:  true,              // ALWAYS — this model never writes
//     signed:    false,             // ALWAYS — this model never signs
//     published: false,             // ALWAYS — this model never publishes
//     errors:    [string],          // details of any FAILED signal
//   }
//
// Folds the six read-path signals (relay read model, no-EVENT verb, profile read,
// leaderboard read, write-paths gated, SEC tiers future-gated). Pure + inert: it
// exercises only the read helpers over deterministic LOCAL sample events and reads
// the consent registry — NO network/relay/sign/publish — and NEVER throws.
export function runReadHealth(input = {}) {
  const { profileEvents = SAMPLE_PROFILE_EVENTS, scoreEvents = SAMPLE_SCORE_EVENTS } =
    (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};

  const signals = [
    checkRelayReadModel(),
    checkNoPublishVerb(),
    checkProfileReadPath(profileEvents),
    checkLeaderboardReadPath(scoreEvents),
    checkWritePathsGated(),
    checkFutureGatedTiers(),
  ];

  const fails = signals.filter((s) => s.status === 'fail');
  return {
    ok: fails.length === 0,
    badge: READ_HEALTH_BADGE,
    signals,
    summary: { total: signals.length, ok: signals.filter((s) => s.status === 'ok').length, fail: fails.length },
    readOnly: true,
    signed: false,
    published: false,
    errors: fails.map((s) => `${s.label}: ${s.detail}`),
  };
}

// formatReadHealth(result) → a compact human-readable text block. Pure; safe on a
// null/malformed result. Mirrors the dry-run text style: badge, per-signal lines,
// and a one-line summary verdict.
export function formatReadHealth(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.signals)) {
    return 'Nostr read-path health — no result.';
  }
  const mark = (s) => (s === 'ok' ? '✓' : s === 'fail' ? '✗' : '•');
  const lines = result.signals.map((s) => `  ${mark(s.status)} ${s.label} — ${s.detail}`);
  const sum = result.summary || { total: 0, ok: 0, fail: 0 };
  const verdict = result.ok ? 'READ-ONLY OK' : 'ATTENTION';
  return [
    `Nostr read-path health  [${result.badge}]`,
    ...lines,
    `  summary: ${sum.ok}/${sum.total} ok · ${sum.fail} fail → ${verdict}`,
  ].join('\n');
}
