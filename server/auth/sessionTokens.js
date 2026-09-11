// server/auth/sessionTokens.js — server-issued session tokens (v0.2.375-alpha).
//
// GOAL: "1 sign at login, 0 signs in-game." The arena's NIP-42 challenge
// (kind:22242) is per-session + anti-replay, so it CANNOT be cached — every
// arena entry / reconnect re-prompts the NIP-07 signer. This module lets the
// client sign ONCE at login (a NIP-98 kind:27235 HTTP-auth event) in exchange
// for an opaque bearer token the arena WS reuses with no further signing.
//
// PURE + node-safe: no THREE, no DOM, no socket. The clock, RNG, and the two
// storage Maps are all injectable so the whole lifecycle is unit-testable with
// a fake clock. The only hard dependencies are the project's existing pure
// crypto (schnorr verify + sha256), which run identically in node and browser.
//
// SECURITY INVARIANTS:
//   * The RAW token is returned to the caller exactly once (issueToken) and is
//     NEVER stored or logged anywhere — only sha256(token) is persisted, so a
//     leak of the store cannot reveal a usable token.
//   * Challenges are one-time-use: verifyLoginEvent deletes on consume, so a
//     captured login event cannot be replayed for a second token.
//   * Both challenges and tokens carry a TTL and are purged by cleanup().

import { randomBytes } from 'crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { verifyNostrEventSig } from '../../src/engine/crypto/nostrSig.js';

export const CHALLENGE_TTL_MS = 60_000;      // login challenge freshness window
export const TOKEN_TTL_MS     = 8 * 60 * 60 * 1000; // 8h session lifetime
export const LOGIN_EVENT_KIND = 27235;       // NIP-98 HTTP Auth
export const TOKEN_BYTES      = 32;           // opaque bearer token entropy
// F08 — bound auth-issuance Maps by COUNT, not just TTL, so login churn can't grow
// them unbounded between cleanup sweeps. Both stores are cheap Maps of tiny records;
// 10k outstanding is far past any legitimate fleet while still capping memory.
export const MAX_CHALLENGES = 10_000;
export const MAX_TOKENS     = 10_000;

// F09 — the login event's `u` tag must name THIS service (audience), not just be
// nonempty. The /mp mount is always at the domain ROOT in every deployment target
// (Caddy `handle /mp`, bare-metal nginx `location = /mp/session`), so the canonical
// login URL is <origin>/mp/session.
export const LOGIN_PATH = '/mp/session';

/**
 * Resolve the canonical login audience URL. Prefer the explicit
 * LOGIN_AUDIENCE_URL (operators who mount /mp off-root); otherwise derive it
 * from QUEST_PUBLIC_URL's ORIGIN (that var points at the static app base, e.g.
 * https://host/quest/, but /mp lives at the root). Returns '' when unconfigured
 * (the caller skips the audience/ fresh checks — sandbox + dynamic origins).
 * Never trusts a forwarded Host header.
 */
export function defaultLoginAudienceUrl(env = process.env) {
  const explicit = (env && env.LOGIN_AUDIENCE_URL ? String(env.LOGIN_AUDIENCE_URL).trim() : '');
  if (explicit) return explicit;
  const base = (env && env.QUEST_PUBLIC_URL ? String(env.QUEST_PUBLIC_URL).trim() : '');
  if (!base) return '';
  let origin;
  try { origin = new URL(base).origin; } catch { return ''; }
  return `${origin}${LOGIN_PATH}`;
}

const HEX64 = /^[0-9a-f]{64}$/;

function sha256Hex(str) {
  const bytes = sha256(new TextEncoder().encode(str));
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * Create a session-token authority.
 *
 * @param {object} [deps]
 * @param {() => number} [deps.now]                 ms clock (default Date.now)
 * @param {(n:number) => Buffer|Uint8Array} [deps.randomBytesFn] entropy source;
 *        must return >= n bytes. Injected so tests can be deterministic.
 * @param {(evt:object) => boolean} [deps.verifyEventSig] schnorr verifier
 *        (default: the project's verifyNostrEventSig). Injected for tests.
 * @param {number} [deps.challengeTtlMs]
 * @param {number} [deps.tokenTtlMs]
 * @param {Map} [deps.challengeStore]  nonce -> { expiresAt }
 * @param {Map} [deps.tokenStore]      sha256(token) -> { pubkey, expiresAt }
 * @param {number} [deps.maxChallenges] outstanding-challenge count cap (F08)
 * @param {number} [deps.maxTokens]     outstanding-token count cap (F08)
 * @param {string} [deps.loginAudienceUrl] canonical login audience URL (F09);
 *        default resolves from LOGIN_AUDIENCE_URL / QUEST_PUBLIC_URL via
 *        defaultLoginAudienceUrl(). Empty string disables the audience+
 *        freshness checks (sandbox / dynamic-origin previews).
 */
export function createSessionTokens(deps = {}) {
  const {
    now = () => Date.now(),
    randomBytesFn = randomBytes,
    verifyEventSig = verifyNostrEventSig,
    challengeTtlMs = CHALLENGE_TTL_MS,
    tokenTtlMs = TOKEN_TTL_MS,
    challengeStore = new Map(),
    tokenStore = new Map(),
    maxChallenges = MAX_CHALLENGES,
    maxTokens = MAX_TOKENS,
    loginAudienceUrl = defaultLoginAudienceUrl(),
  } = deps;

  function randHex(nBytes) {
    const buf = randomBytesFn(nBytes);
    let hex = '';
    for (let i = 0; i < nBytes; i++) hex += buf[i].toString(16).padStart(2, '0');
    return hex;
  }

  /**
   * Issue a fresh one-time login challenge. Returns { challenge, ttl } (ttl in
   * seconds), or null when outstanding challenges are at their F08 count cap
   * (the caller should return 429 — login churn must not grow this Map unbounded).
   */
  function issueChallenge() {
    if (challengeStore.size >= maxChallenges) return null;
    const challenge = randHex(32);
    challengeStore.set(challenge, { expiresAt: now() + challengeTtlMs });
    return { challenge, ttl: Math.floor(challengeTtlMs / 1000) };
  }

  /**
   * Verify a NIP-98 (kind:27235) login event bound to a previously-issued
   * challenge. Consumes the challenge (one-time-use). Returns the signer's hex
   * pubkey on success, or null on any failure (fail-closed).
   *
   * @param {{ event:object, challenge:string }} args
   */
  function verifyLoginEvent({ event, challenge } = {}) {
    if (typeof challenge !== 'string' || !challenge) return null;
    const rec = challengeStore.get(challenge);
    // One-time-use: delete regardless of outcome so a captured event can't be
    // replayed against the same challenge.
    challengeStore.delete(challenge);
    if (!rec || rec.expiresAt <= now()) return null;
    if (!event || typeof event !== 'object') return null;
    if (event.kind !== LOGIN_EVENT_KIND) return null;
    if (!HEX64.test(event.pubkey || '')) return null;
    if (!Array.isArray(event.tags)) return null;
    const chalTag = event.tags.find((t) => Array.isArray(t) && t[0] === 'challenge');
    if (!chalTag || chalTag[1] !== challenge) return null;
    // NIP-98 also carries the URL + method; require they are present (defence in
    // depth — the event was scoped to this endpoint by the signer).
    const uTag = event.tags.find((t) => Array.isArray(t) && (t[0] === 'u' || t[0] === 'url'));
    const mTag = event.tags.find((t) => Array.isArray(t) && (t[0] === 'method'));
    if (!uTag || !uTag[1]) return null;
    if (!mTag || String(mTag[1]).toUpperCase() !== 'POST') return null;
    // F09 — audience: when configured, the signer must have scoped the event to
    // THIS service's canonical login URL (exact string match). Never compare
    // against a forwarded Host header — a relayer could spoof it.
    if (loginAudienceUrl && uTag[1] !== loginAudienceUrl) return null;
    // F09 — freshness: created_at must be a finite unix-seconds timestamp within
    // the challenge TTL of "now" (symmetric, tolerating signer clock skew). A
    // pre-signed event can't be relaid once it has aged out of this window.
    const createdAt = event.created_at;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
    if (Math.abs(now() / 1000 - createdAt) > Math.ceil(challengeTtlMs / 1000)) return null;
    if (!verifyEventSig(event)) return null;
    return event.pubkey;
  }

  /**
   * Issue an opaque bearer token for a verified hex pubkey. Only sha256(token)
   * is persisted; the raw token is returned once and never stored/logged.
   * @param {string} pubkey hex64
   * @returns {string|null} raw token, or null if pubkey malformed / token store at cap.
   */
  function issueToken(pubkey) {
    if (!HEX64.test(pubkey || '')) return null;
    if (tokenStore.size >= maxTokens) return null; // F08: bound outstanding tokens
    const token = randHex(TOKEN_BYTES);
    tokenStore.set(sha256Hex(token), { pubkey, expiresAt: now() + tokenTtlMs });
    return token;
  }

  /**
   * Verify a bearer token. Returns the bound hex pubkey, or null if unknown /
   * expired. Never logs the raw token.
   * @param {string} token
   */
  function verifyToken(token) {
    if (typeof token !== 'string' || !token) return null;
    const rec = tokenStore.get(sha256Hex(token));
    if (!rec) return null;
    if (rec.expiresAt <= now()) { tokenStore.delete(sha256Hex(token)); return null; }
    return rec.pubkey;
  }

  /** Purge expired challenges + tokens. Cheap; call on a timer. */
  function cleanup() {
    const t = now();
    for (const [k, v] of challengeStore) if (v.expiresAt <= t) challengeStore.delete(k);
    for (const [k, v] of tokenStore) if (v.expiresAt <= t) tokenStore.delete(k);
  }

  return {
    issueChallenge,
    verifyLoginEvent,
    issueToken,
    verifyToken,
    cleanup,
    // Exposed for observability/tests only — never contains raw tokens.
    _challengeStore: challengeStore,
    _tokenStore: tokenStore,
  };
}
