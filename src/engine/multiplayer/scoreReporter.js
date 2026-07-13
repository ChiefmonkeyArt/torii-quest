// src/engine/multiplayer/scoreReporter.js
// MP-3 (v0.2.366-alpha) — client-signs the local peer's row from a SCORE frame
// and publishes it to Nostr relays as kind:30078#d=torii-quest.
//
// Design (Option A — client-signed):
//   • Server broadcasts an authoritative SCORE tally to all peers.
//   • Each peer signs and publishes ONLY their own row.
//   • kind:30078 is a NIP-33 parameterized replaceable event, so each pubkey
//     has one canonical current entry keyed by `d`.
//   • A parallel kind:1 event with tag `t=torii-quest-score` is published to
//     retain lifetime history (relay-dependent).
//
// This module is intentionally I/O-agnostic — the `signer` and `publisher`
// dependencies are injected so tests can drive it without a browser / nostr
// extension. Production wiring binds signer to window.nostr (nip07) and
// publisher to the existing relay pool used elsewhere.
//
// SPDX-License-Identifier: MIT

import { nostrEventId } from '../crypto/nostrSig.js';

/** Canonical `d`-tag used across the leaderboard. */
export const SCORE_D_TAG = 'torii-quest';
/** Canonical `t`-tag on the history kind:1 event. */
export const SCORE_HISTORY_T_TAG = 'torii-quest-score';
/** NIP-33 parameterized replaceable event kind. */
export const SCORE_KIND_ADDRESSABLE = 30078;
/** Regular note kind used for durable history. */
export const SCORE_KIND_HISTORY     = 1;

/** LocalStorage key prefix for dedupe memoisation. */
const DEDUPE_KEY_PREFIX = 'tq.mp3.published:';

/**
 * Pick the local peer's row out of a SCORE.tallies array.
 * @param {{id:string, npub:string, kills:number, deaths:number, damage:number}[]} tallies
 * @param {{ selfId?: string, selfPubkey?: string }} self
 * @returns row or null
 */
export function pickSelfRow(tallies, self) {
  if (!Array.isArray(tallies) || !self) return null;
  const byId    = self.selfId     ? tallies.find((r) => r.id   === self.selfId)     : null;
  if (byId) return byId;
  const byNpub  = self.selfPubkey ? tallies.find((r) => r.npub === self.selfPubkey) : null;
  return byNpub || null;
}

/**
 * Build an unsigned NIP-33 kind:30078 event body for a score row.
 * Deterministic — same inputs produce the same event (modulo created_at).
 * @param {object} args
 * @param {string} args.pubkey       hex64
 * @param {string} args.sessionId    16-hex arena session id
 * @param {number} args.endedAt      ms epoch
 * @param {{kills:number, deaths:number, damage:number}} args.row
 * @param {number} args.createdAt    unix seconds
 * @param {string} args.clientTag    e.g. 'torii-quest/v0.2.368-alpha'
 * @returns unsigned event object (missing id, sig)
 */
export function buildAddressableEvent(args) {
  const { pubkey, sessionId, endedAt, row, createdAt, clientTag } = args;
  const content = JSON.stringify({
    kills:     row.kills,
    deaths:    row.deaths,
    damage:    row.damage,
    sessionId,
    endedAt,
  });
  return {
    pubkey,
    created_at: createdAt,
    kind:       SCORE_KIND_ADDRESSABLE,
    tags: [
      ['d',       SCORE_D_TAG],
      ['session', sessionId],
      ['k',       String(row.kills)],
      ['dth',     String(row.deaths)],
      ['dmg',     String(row.damage)],
      ['ended',   String(endedAt)],
      ['client',  clientTag],
    ],
    content,
  };
}

/**
 * Build an unsigned kind:1 history event for the same score row.
 * Uses tag `t=torii-quest-score` to make aggregation filterable.
 * @param {object} args (same shape as buildAddressableEvent)
 */
export function buildHistoryEvent(args) {
  const base = buildAddressableEvent(args);
  return {
    ...base,
    kind: SCORE_KIND_HISTORY,
    tags: [
      ['t',       SCORE_HISTORY_T_TAG],
      ...base.tags.filter((t) => t[0] !== 'd'), // d-tag only meaningful on addressable
    ],
  };
}

/**
 * Compute a dedupe key for a (session, endedAt) tuple.
 */
export function dedupeKey(sessionId, endedAt) {
  return `${DEDUPE_KEY_PREFIX}${sessionId}:${endedAt}`;
}

/**
 * Create a score reporter bound to the given signer + publisher + storage.
 *
 * @param {object} deps
 * @param {(evt: object) => Promise<{ id: string, sig: string, pubkey: string }>} deps.signer
 *   Signs an unsigned event and returns the signed shape. Prefer window.nostr.
 * @param {(signed: object) => Promise<{ published: number, tried: number }>} deps.publisher
 *   Publishes to configured relays. Return counts for observability.
 * @param {{ get:(k:string)=>string|null, set:(k:string, v:string)=>void }} [deps.storage]
 *   Dedupe store. Defaults to localStorage in-browser, in-memory otherwise.
 * @param {() => number} [deps.now] unix ms clock
 * @param {string} [deps.clientTag] version string tag
 * @param {(msg: string, err?: Error) => void} [deps.log]
 * @param {{ selfId?: string, selfPubkey?: string }} deps.self
 */
export function createScoreReporter(deps) {
  const {
    signer, publisher, self,
    storage = defaultStorage(),
    now = () => Date.now(),
    clientTag = 'torii-quest/v0.2.368-alpha',
    log = () => {},
  } = deps || {};

  if (typeof signer    !== 'function') throw new TypeError('scoreReporter: signer required');
  if (typeof publisher !== 'function') throw new TypeError('scoreReporter: publisher required');
  if (!self)                            throw new TypeError('scoreReporter: self required');

  return {
    /**
     * Handle a SCORE frame from the server. Signs and publishes the local
     * peer's row exactly once per (sessionId, endedAt).
     * @param {{sessionId:string, endedAt:number, tallies: any[]}} scoreMsg
     * @returns {Promise<{ published: boolean, reason?: string, addressable?: object, history?: object }>}
     */
    async report(scoreMsg) {
      if (!scoreMsg || scoreMsg.t && scoreMsg.t !== 'SCORE') {
        return { published: false, reason: 'not-score' };
      }
      const { sessionId, endedAt, tallies } = scoreMsg;
      if (typeof sessionId !== 'string' || !Array.isArray(tallies)) {
        return { published: false, reason: 'bad-frame' };
      }
      const key = dedupeKey(sessionId, endedAt);
      if (storage.get(key)) return { published: false, reason: 'dedupe' };

      const row = pickSelfRow(tallies, self);
      if (!row) return { published: false, reason: 'no-self-row' };
      // Do not publish empty scores — nothing to boast about, cheaper for relays.
      if (row.kills === 0 && row.deaths === 0 && row.damage === 0) {
        storage.set(key, '1'); // mark dedupe anyway so we don't retry
        return { published: false, reason: 'empty-row' };
      }

      const createdAt = Math.floor(now() / 1000);
      const addressable = buildAddressableEvent({
        pubkey: self.selfPubkey, sessionId, endedAt, row, createdAt, clientTag,
      });
      const history = buildHistoryEvent({
        pubkey: self.selfPubkey, sessionId, endedAt, row, createdAt, clientTag,
      });

      try {
        const signedA = await signer(addressable);
        const signedH = await signer(history);
        // Sanity: the signer MUST return an id that matches our recomputed id.
        if (nostrEventId(signedA) !== signedA.id) {
          log('scoreReporter: signer returned mismatched id (addressable)');
          return { published: false, reason: 'sig-id-mismatch' };
        }
        await publisher(signedA);
        await publisher(signedH);
        storage.set(key, '1');
        return { published: true, addressable: signedA, history: signedH };
      } catch (err) {
        log('scoreReporter: publish failed', err);
        return { published: false, reason: 'signer-or-publisher-threw' };
      }
    },
  };
}

/**
 * Default storage: localStorage if available, else a per-tab in-memory Map.
 */
function defaultStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      const ls = globalThis.localStorage;
      return {
        get: (k) => ls.getItem(k),
        set: (k, v) => { try { ls.setItem(k, v); } catch { /* quota — ignore */ } },
      };
    }
  } catch { /* SecurityError under strict cookie policy — fall through */ }
  const mem = new Map();
  return {
    get: (k) => (mem.has(k) ? mem.get(k) : null),
    set: (k, v) => { mem.set(k, v); },
  };
}
